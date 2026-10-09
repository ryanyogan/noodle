import type {
	AmountBand,
	Cents,
	DayKey,
	DayRange,
	ForCell,
	Grouping,
	MonthKey,
	SpendCell,
	Target,
} from "@noodle/domain";
import {
	displayMerchant,
	merchantGroup,
	monthOfDay,
	periodKey,
	shareFor,
	THRESHOLD_STOPS,
} from "@noodle/domain";
import {
	type AnyColumn,
	and,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	lt,
	type SQL,
	sql,
} from "drizzle-orm";
import { counts, incomeCounts, incomeCountsOn } from "./counting";
import type { Db } from "./index";
import { loadPaidBackCharges, loadPaidBackSpending } from "./owed-back";
import {
	partlyPrivate,
	privateTotalId,
	privateTotals,
	type Viewer,
	visibleSplit,
	visibleTo,
} from "./privacy";
import { income, splitFor, splits, transactionFor, transactions } from "./schema";

// Reports aggregate in D1 (GROUP BY), so no Report ever sends a Household's Transactions to the
// browser in bulk: only sums per period and Target, and at most a page of items to drill into.
// Spending is read in parts: whole Transactions that aren't split, and the Splits of those that
// are, each as `viewer` may see them (privacy.ts, ADR-0003). Another Parent's Personal Allowance
// only ever adds its monthly totals (`privateTotals`), and only to figures a total can honestly
// be part of: never to merchants, Accounts, For, or amounts, which would say what it was.

/** What a Report is narrowed to. Targets are Target keys (see @noodle/domain). */
export type ReportFilters = {
	targets?: string[];
	/** A Member's ID, or "everyone" for spending For the whole Household. */
	member?: string;
	account?: string;
	/** A merchant as Reports group them (merchantGroup in @noodle/domain), or one exact note. */
	merchant?: string;
	/** The spellings (`merchantKey`s) `merchant` stands for, once found (resolveMerchant). */
	merchantKeys?: string[];
	/** Only parts of at least this many cents. */
	min?: Cents;
	/** Only one-off spending: leaves out parts that pay a Commitment. */
	oneOff?: boolean;
};

export type ReportScope = { viewer: Viewer; range: DayRange; filters: ReportFilters };

/** One of the two shapes spending is read in, with the columns every Report query needs. */
type Parts = {
	from: "whole" | "split";
	amount: AnyColumn;
	bucketId: AnyColumn;
	commitmentId: AnyColumn;
	goalId: AnyColumn;
	/** The part's For rows exist, optionally For one Member. */
	hasFor: (memberId?: string) => SQL;
	/** The part's For, as a comma-separated, sorted list of Member IDs ("" for the Household). */
	forKey: SQL<string>;
	where: SQL;
};

const isSplit = sql`exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`;

/**
 * The spending a Report counts, by the one rule every spending total uses (counting.ts): not the
 * imported copy in a Match, nor either side of a Transfer. Refunds are spending with a negative
 * amount in their purchase's Bucket, so they net against it in every sum.
 */
const counted = (): SQL => counts(transactions.id);

/** What a merchant is called: its clean name once named (ADR-0027), else the note. */
const called = () => sql`coalesce(${transactions.merchant}, ${transactions.note}, '')`;

/** A merchant, as a Report groups them: its name, trimmed and lower-cased ("" when there's none). */
const merchantKey = (viewer: Viewer, from: Parts["from"]) =>
	from === "whole"
		? sql<string>`lower(trim(${called()}))`
		: // A split Transaction partly in the other Parent's Personal Allowance shows them no note.
			sql<string>`case when ${partlyPrivate(viewer)} then '' else lower(trim(${called()})) end`;

/** The name a merchant is shown by (any one of its spellings). */
const merchantName = (viewer: Viewer, from: Parts["from"]) =>
	from === "whole"
		? sql<string>`max(trim(${called()}))`
		: sql<string>`max(case when ${partlyPrivate(viewer)} then '' else trim(${called()}) end)`;

const targetOf = (parts: Pick<Parts, "bucketId" | "commitmentId" | "goalId">) =>
	sql<Target>`case when ${parts.bucketId} is not null then 'bucket:' || ${parts.bucketId} when ${parts.commitmentId} is not null then 'commitment:' || ${parts.commitmentId} when ${parts.goalId} is not null then 'goal:' || ${parts.goalId} else 'unassigned' end`;

/**
 * The period a part falls in, keyed as periodKey in @noodle/domain: its week's Monday, its month,
 * its quarter, or one period for the whole range ("all").
 */
function periodOf(
	grouping: Grouping | "all",
	date: AnyColumn | SQL = transactions.date,
): SQL<string> {
	switch (grouping) {
		case "all":
			return sql<string>`'all'`;
		case "month":
			return sql<string>`substr(${date}, 1, 7)`;
		case "quarter":
			return sql<string>`substr(${date}, 1, 4) || '-Q' || ((cast(substr(${date}, 6, 2) as integer) + 2) / 3)`;
		case "week":
			return sql<string>`date(${date}, '-6 days', 'weekday 1')`;
	}
}

function filtersFor(scope: ReportScope, parts: Omit<Parts, "where">): SQL | undefined {
	const { viewer, range, filters } = scope;
	return and(
		gte(transactions.date, range.from),
		lt(transactions.date, range.until),
		counted(),
		filters.targets?.length ? inArray(targetOf(parts), filters.targets) : undefined,
		filters.account ? eq(transactions.accountId, filters.account) : undefined,
		filters.merchant !== undefined
			? inArray(merchantKey(viewer, parts.from), filters.merchantKeys ?? [filters.merchant])
			: undefined,
		filters.min ? gte(parts.amount, filters.min) : undefined,
		filters.oneOff ? isNull(parts.commitmentId) : undefined,
		filters.member === "everyone"
			? sql`not ${parts.hasFor()}`
			: filters.member
				? parts.hasFor(filters.member)
				: undefined,
	);
}

/** Whole Transactions that aren't split, and Splits, as `scope.viewer` may see them. */
function partsOf(scope: ReportScope): [Parts, Parts] {
	const { viewer } = scope;
	const whole: Omit<Parts, "where"> = {
		from: "whole",
		amount: transactions.amountCents,
		bucketId: transactions.bucketId,
		commitmentId: transactions.commitmentId,
		goalId: transactions.goalId,
		hasFor: (memberId) =>
			sql`exists (select 1 from ${transactionFor} where ${transactionFor.transactionId} = ${transactions.id}${
				memberId ? sql` and ${transactionFor.memberId} = ${memberId}` : sql``
			})`,
		forKey: sql<string>`coalesce((select group_concat(member_id, ',') from (select ${transactionFor.memberId} as member_id from ${transactionFor} where ${transactionFor.transactionId} = ${transactions.id} order by 1)), '')`,
	};
	const split: Omit<Parts, "where"> = {
		from: "split",
		amount: splits.amountCents,
		bucketId: splits.bucketId,
		commitmentId: splits.commitmentId,
		goalId: splits.goalId,
		hasFor: (memberId) =>
			sql`exists (select 1 from ${splitFor} where ${splitFor.splitId} = ${splits.id}${
				memberId ? sql` and ${splitFor.memberId} = ${memberId}` : sql``
			})`,
		forKey: sql<string>`coalesce((select group_concat(member_id, ',') from (select ${splitFor.memberId} as member_id from ${splitFor} where ${splitFor.splitId} = ${splits.id} order by 1)), '')`,
	};
	return [
		{
			...whole,
			where: and(visibleTo(viewer), sql`not ${isSplit}`, filtersFor(scope, whole)) as SQL,
		},
		{
			...split,
			where: and(
				visibleSplit(viewer),
				eq(transactions.householdId, viewer.householdId),
				filtersFor(scope, split),
			) as SQL,
		},
	];
}

/** Selects from a shape's tables: `transactions`, joined to `splits` for Splits. */
function fromParts<T extends Record<string, unknown>>(db: Db, parts: Parts, fields: T) {
	const query = db.select(fields as never);
	return parts.from === "whole"
		? query.from(transactions)
		: query.from(splits).innerJoin(transactions, eq(transactions.id, splits.transactionId));
}

/**
 * Whether another Parent's Personal Allowance totals belong in a Report so narrowed: only when it
 * filters by nothing a total can't honestly be split by (merchant, Account, For, amount).
 */
export const privateTotalsFit = (filters: ReportFilters) =>
	filters.member === undefined &&
	filters.account === undefined &&
	filters.merchant === undefined &&
	!filters.min;

type Restore = {
	/** The purchase's Transaction. */
	id: string;
	target: Target;
	day: DayKey;
	amount: Cents;
	private: boolean;
	/** Who the purchase was For; a Commitment's restores have it only from `restoresWithFor`. */
	for: string[];
	/**
	 * No money came in: it is the Owed back part of the purchase, which never counts (ADR-0058,
	 * revised 2026-10-08), on the purchase's own day.
	 */
	owed?: true;
	/** On one that is `owed`: the part of the purchase it is of, a Split's ID or the Transaction's. */
	part?: string;
};

/**
 * What Paid back restores in a Report's range (ADR-0058), as spending in reverse on the day the
 * money counts, in the Bucket or Commitment its purchase is filed in: the third source beside
 * whole Transactions and Splits, read as This Month reads it so the two agree. Into another
 * Parent's Personal Allowance it is a private total for the month. It isn't a purchase, so a
 * Report narrowed by what only a purchase has (merchant, Account, For, amount) has none. The Owed
 * back part of a purchase that never counts comes the same way, on the purchase's day; it is part
 * of a purchase, so a Report so narrowed keeps it wherever it keeps the purchase.
 */
async function loadRestores(db: Db, scope: ReportScope): Promise<Restore[]> {
	const { viewer, range, filters } = scope;
	const [toBuckets, toCommitments] = await Promise.all([
		loadPaidBackSpending(db, viewer, range.from, range.until),
		// One-off spending leaves Commitments out, and so what restores them.
		filters.oneOff ? [] : loadPaidBackCharges(db, viewer, range.from, range.until),
	]);
	const restores: Restore[] = [
		...toBuckets.map((spend) => ({
			id: spend.id,
			target: `bucket:${spend.bucketId}` as Target,
			day: spend.date,
			amount: spend.amount,
			for: spend.for,
			private: spend.id === privateTotalId(spend.bucketId, monthOfDay(spend.date)),
			...(spend.owed ? { owed: true as const, part: spend.splitId ?? spend.id } : {}),
		})),
		...toCommitments
			// Charges are read through their last day; a Report's range stops before `until`.
			.filter((charge) => charge.date < range.until)
			.map((charge) => ({
				id: charge.id,
				target: `commitment:${charge.commitmentId}` as Target,
				day: charge.date,
				amount: charge.amount,
				private: false,
				for: [],
				...(charge.owed ? { owed: true as const, part: charge.splitId ?? charge.id } : {}),
			})),
	];
	const inTargets = restores.filter(
		(restore) => !filters.targets?.length || filters.targets.includes(restore.target),
	);
	if (privateTotalsFit(filters)) return inTargets;
	const owed = inTargets.filter((restore) => restore.owed && !restore.private);
	if (owed.length === 0) return [];
	// The parts the narrowed Report counts, among those something is Owed back on. One JSON
	// parameter: D1 allows 100 bound parameters a statement.
	const ids = JSON.stringify([...new Set(owed.map((restore) => restore.part))]);
	const [whole, split] = partsOf(scope);
	const [wholes, parts] = await db.batch([
		fromParts(db, whole, { id: transactions.id }).where(
			and(whole.where, sql`${transactions.id} in (select value from json_each(${ids}))`),
		),
		fromParts(db, split, { id: splits.id }).where(
			and(split.where, sql`${splits.id} in (select value from json_each(${ids}))`),
		),
	]);
	const counted = new Set(([...wholes, ...parts] as { id: string }[]).map((row) => row.id));
	return owed.filter((restore) => counted.has(restore.part ?? ""));
}

/**
 * The restores a Parent may see one by one, each with who its purchase was For. A Bucket's come
 * with it; a Commitment's take the For of the whole purchase (one filed there by a Split counts
 * For the Household, as nothing says which Split the money went back to).
 */
async function restoresWithFor(db: Db, scope: ReportScope): Promise<Restore[]> {
	const restores = (await loadRestores(db, scope)).filter((restore) => !restore.private);
	const ids = [
		...new Set(restores.filter((r) => r.target.startsWith("commitment:")).map((r) => r.id)),
	];
	if (ids.length === 0) return restores;
	// One JSON parameter: D1 allows 100 bound parameters a statement.
	const rows = await db
		.select({ id: transactionFor.transactionId, memberId: transactionFor.memberId })
		.from(transactionFor)
		.where(
			and(
				eq(transactionFor.householdId, scope.viewer.householdId),
				sql`${transactionFor.transactionId} in (select value from json_each(${JSON.stringify(ids)}))`,
			),
		);
	return restores.map((restore) =>
		restore.target.startsWith("commitment:")
			? {
					...restore,
					for: rows
						.filter((row) => row.id === restore.id)
						.map((row) => row.memberId)
						.sort(),
				}
			: restore,
	);
}

/**
 * Spending per period and Target, with what was Paid back taken off where it restores (a cell
 * with a count of 0). Other Parents' Personal Allowances add their monthly totals
 * (period = month) marked private, for regroupMonthly; the caller regroups and merges them.
 */
export async function loadSpendCells(
	db: Db,
	scope: ReportScope,
	grouping: Grouping | "all",
): Promise<{ cells: SpendCell[]; privateMonths: SpendCell[] }> {
	const period = periodOf(grouping);
	const [whole, split] = partsOf(scope);
	const query = (parts: Parts) => {
		const target = targetOf(parts);
		return fromParts(db, parts, {
			period,
			target,
			amount: sql<number>`sum(${parts.amount})`,
			count: sql<number>`count(*)`,
		})
			.where(parts.where)
			.groupBy(period, target);
	};
	const withPrivate = privateTotalsFit(scope.filters);
	const [wholeRows, splitRows, ...hidden] = await db.batch([
		query(whole),
		query(split),
		...(withPrivate ? privateTotals(db, scope.viewer, scope.range.from, scope.range.until) : []),
	] as const);
	const privateMonths = (hidden as { bucketId: string; month: string; amount: number }[][])
		.flat()
		.map((row) => ({
			period: grouping === "all" ? "all" : row.month,
			target: `bucket:${row.bucketId}` as Target,
			amount: row.amount,
			count: 0,
			private: true,
		}))
		.filter(
			(cell) => !scope.filters.targets?.length || scope.filters.targets.includes(cell.target),
		);
	const restored: SpendCell[] = [];
	for (const restore of await loadRestores(db, scope)) {
		if (restore.private)
			privateMonths.push({
				period: grouping === "all" ? "all" : monthOfDay(restore.day),
				target: restore.target,
				amount: restore.amount,
				count: 0,
				private: true,
			});
		else
			restored.push({
				period: grouping === "all" ? "all" : periodKey(restore.day, grouping),
				target: restore.target,
				amount: restore.amount,
				count: 0,
			});
	}
	return {
		cells: [...(wholeRows as SpendCell[]), ...(splitRows as SpendCell[]), ...restored],
		privateMonths,
	};
}

/**
 * Spending per day (visible spending only: private totals have no days), with what was Paid
 * back taken off on the day it counts.
 */
export async function loadDailySpend(
	db: Db,
	scope: ReportScope,
): Promise<{ day: DayKey; amount: Cents }[]> {
	const [whole, split] = partsOf(scope);
	const query = (parts: Parts) =>
		fromParts(db, parts, { day: transactions.date, amount: sql<number>`sum(${parts.amount})` })
			.where(parts.where)
			.groupBy(transactions.date);
	const [a, b] = await db.batch([query(whole), query(split)]);
	const restores = (await loadRestores(db, scope)).filter((restore) => !restore.private);
	const byDay = new Map<string, number>();
	for (const row of [...a, ...b, ...restores] as { day: string; amount: number }[]) {
		byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.amount);
	}
	return [...byDay]
		.map(([day, amount]) => ({ day: day as DayKey, amount }))
		.sort((x, y) => x.day.localeCompare(y.day));
}

/**
 * Spending per period by who it was For (see spendFor in @noodle/domain), with what was Paid back
 * taken off who its purchase was For, in the period it counts (a cell with a count of 0), so by
 * Member and by Bucket add up to the same.
 */
export async function loadForCells(
	db: Db,
	scope: ReportScope,
	grouping: Grouping,
): Promise<ForCell[]> {
	const period = periodOf(grouping);
	const [whole, split] = partsOf(scope);
	const query = (parts: Parts) =>
		fromParts(db, parts, {
			period,
			forKey: parts.forKey,
			amount: sql<number>`sum(${parts.amount})`,
			count: sql<number>`count(*)`,
		})
			.where(parts.where)
			.groupBy(period, parts.forKey);
	const [a, b] = await db.batch([query(whole), query(split)]);
	const restored = (await restoresWithFor(db, scope)).map((restore) => ({
		period: periodKey(restore.day, grouping),
		amount: restore.amount,
		count: 0,
		for: restore.for,
	}));
	return [
		...([...a, ...b] as { period: string; forKey: string; amount: number; count: number }[]).map(
			({ forKey, ...row }) => ({ ...row, for: forKey ? forKey.split(",") : [] }),
		),
		...restored,
	];
}

export type MerchantTotal = {
	key: string;
	name: string;
	amount: Cents;
	count: number;
	/** How many Targets (Buckets, Commitments…) its spending went to. */
	targets: number;
};

/**
 * The top merchants by what was spent there and by how often, `limit` of each (they overlap).
 * Spending with no note groups as the merchant "".
 */
export async function loadMerchants(
	db: Db,
	scope: ReportScope,
	limit = 40,
): Promise<{ byAmount: MerchantTotal[]; byCount: MerchantTotal[] }> {
	const [whole, split] = partsOf(scope);
	const query = (parts: Parts, order: "amount" | "count") => {
		const key = merchantKey(scope.viewer, parts.from);
		const amount = sql<number>`sum(${parts.amount})`;
		const count = sql<number>`count(*)`;
		return (
			fromParts(db, parts, {
				key,
				name: merchantName(scope.viewer, parts.from),
				amount,
				count,
				targets: sql<number>`count(distinct ${targetOf(parts)})`,
			})
				.where(parts.where)
				.groupBy(key)
				.orderBy(desc(order === "amount" ? amount : count))
				// Spellings merge below by the name they're shown by, so read enough of them to merge.
				.limit(limit * 25)
		);
	};
	const rows = await db.batch([
		query(whole, "amount"),
		query(split, "amount"),
		query(whole, "count"),
		query(split, "count"),
	]);
	const merge = (lists: MerchantTotal[][]) => {
		const byKey = new Map<string, MerchantTotal>();
		for (const spelling of lists.flat()) {
			// "COSTCO WHSE #1042" and "Costco" are one merchant, shown as "Costco" (#51).
			const row = {
				...spelling,
				key: merchantGroup(spelling.name || spelling.key),
				name: spelling.name ? displayMerchant(spelling.name) : "",
			};
			const seen = byKey.get(row.key);
			byKey.set(
				row.key,
				seen
					? {
							...seen,
							// A name with capitals ("Costco") over one typed all lower case.
							name: /[A-Z]/.test(seen.name) ? seen.name : row.name || seen.name,
							amount: seen.amount + row.amount,
							count: seen.count + row.count,
							targets: Math.max(seen.targets, row.targets),
						}
					: row,
			);
		}
		return [...byKey.values()];
	};
	const [a, b, c, d] = rows as unknown as MerchantTotal[][];
	return {
		byAmount: merge([a ?? [], b ?? []])
			.sort((x, y) => y.amount - x.amount)
			.slice(0, limit),
		byCount: merge([c ?? [], d ?? []])
			.sort((x, y) => y.count - x.count || y.amount - x.amount)
			.slice(0, limit),
	};
}

/**
 * The scope with its merchant filter covering every spelling Reports group under it: "costco"
 * stands for "COSTCO WHSE #1042 SEATTLE WA" and "Costco" alike (#51). It looks across all time,
 * so a comparison period finds its spellings too.
 */
export async function resolveMerchant(db: Db, scope: ReportScope): Promise<ReportScope> {
	const wanted = scope.filters.merchant;
	if (!wanted) return scope;
	const [whole, split] = partsOf({
		...scope,
		range: { from: "0000-01-01" as DayKey, until: "9999-12-31" as DayKey },
		filters: {},
	});
	const query = (parts: Parts) => {
		const key = merchantKey(scope.viewer, parts.from);
		return fromParts(db, parts, { key, name: merchantName(scope.viewer, parts.from) })
			.where(parts.where)
			.groupBy(key);
	};
	const rows = (await db.batch([query(whole), query(split)])) as unknown as {
		key: string;
		name: string;
	}[][];
	const keys = new Set([wanted]);
	for (const row of rows.flat()) {
		if (merchantGroup(row.name || row.key) === wanted) keys.add(row.key);
	}
	return { ...scope, filters: { ...scope.filters, merchantKeys: [...keys] } };
}

/** Spending per merchant and Target, for one merchant's drill-down (where it lands). */
export async function loadTargetsByMerchant(db: Db, scope: ReportScope) {
	const [whole, split] = partsOf(scope);
	const query = (parts: Parts) => {
		const target = targetOf(parts);
		return fromParts(db, parts, { target, amount: sql<number>`sum(${parts.amount})` })
			.where(parts.where)
			.groupBy(target);
	};
	const [a, b] = await db.batch([query(whole), query(split)]);
	return [...a, ...b] as { target: Target; amount: Cents }[];
}

/** How many parts, and how much, fell in each band between THRESHOLD_STOPS. */
export async function loadAmountBands(db: Db, scope: ReportScope): Promise<AmountBand[]> {
	const [whole, split] = partsOf(scope);
	const query = (parts: Parts) => {
		const stops = [...THRESHOLD_STOPS].reverse();
		const floor = sql<number>`case ${sql.join(
			stops.map((stop) => sql`when ${parts.amount} >= ${stop} then ${stop}`),
			sql` `,
		)} else 0 end`;
		return fromParts(db, parts, {
			floor,
			count: sql<number>`count(*)`,
			amount: sql<number>`sum(${parts.amount})`,
		})
			.where(parts.where)
			.groupBy(floor);
	};
	const [a, b] = await db.batch([query(whole), query(split)]);
	const byFloor = new Map<number, AmountBand>();
	for (const band of [...a, ...b] as AmountBand[]) {
		const seen = byFloor.get(band.floor);
		byFloor.set(
			band.floor,
			seen ? { ...seen, count: seen.count + band.count, amount: seen.amount + band.amount } : band,
		);
	}
	return [...byFloor.values()].sort((x, y) => x.floor - y.floor);
}

/** One part of a Transaction as a Report lists it: a whole Transaction, or one Split of it. */
export type ReportItem = {
	/** The Transaction's ID. */
	id: string;
	date: DayKey;
	amount: Cents;
	note: string | null;
	/** Its merchant's clean name, for an imported line once named (ADR-0027); hidden as the note is. */
	merchantName: string | null;
	target: Target;
	accountId: string | null;
	/** It's one Split of a split Transaction. */
	split: boolean;
	/**
	 * Listed For one Member, `amount` is that Member's share, as the figure it is behind counts it
	 * (`shareFor`); this is the whole of it, when it was For others too.
	 */
	whole?: Cents;
	/**
	 * Not a purchase: money Paid back on the Transaction `id`, a negative amount on the day it
	 * counts (ADR-0058). It has no note, merchant or Account of its own.
	 */
	paidBack?: true;
	/**
	 * On one that is `paidBack`: no money came in. It is the Owed back part of the Transaction
	 * `id`, which never counts as spending (ADR-0058, revised 2026-10-08), on the purchase's day.
	 */
	owedBack?: true;
};

/**
 * Parts `viewer` may see, newest first or largest first, at most `limit` (and how many there are
 * in all). The deepest level of a drill-down; never another Parent's Personal Allowance. What
 * was Paid back is listed with them, so the list adds up to the Bucket's or Commitment's total.
 */
export async function loadReportItems(
	db: Db,
	scope: ReportScope,
	order: "date" | "amount",
	limit: number,
): Promise<{ items: ReportItem[]; total: number }> {
	const [whole, split] = partsOf(scope);
	const query = (parts: Parts) =>
		fromParts(db, parts, {
			id: transactions.id,
			date: transactions.date,
			amount: parts.amount,
			note:
				parts.from === "whole"
					? transactions.note
					: sql<
							string | null
						>`case when ${partlyPrivate(scope.viewer)} then null else ${transactions.note} end`,
			merchantName:
				parts.from === "whole"
					? transactions.merchant
					: sql<
							string | null
						>`case when ${partlyPrivate(scope.viewer)} then null else ${transactions.merchant} end`,
			target: targetOf(parts),
			accountId: transactions.accountId,
			split: sql<number>`${parts.from === "split" ? 1 : 0}`,
			forKey: parts.forKey,
		})
			.where(parts.where)
			.orderBy(
				...(order === "amount"
					? [desc(parts.amount), desc(transactions.date)]
					: [desc(transactions.date), desc(parts.amount)]),
			)
			.limit(limit);
	const count = (parts: Parts) =>
		fromParts(db, parts, { count: sql<number>`count(*)` }).where(parts.where);
	const [a, b, [countA], [countB]] = await db.batch([
		query(whole),
		query(split),
		count(whole),
		count(split),
	]);
	const restored = (await loadRestores(db, scope))
		.filter((restore) => !restore.private)
		.map(
			(restore): ReportItem => ({
				id: restore.id,
				date: restore.day,
				amount: restore.amount,
				note: null,
				merchantName: null,
				target: restore.target,
				accountId: null,
				split: false,
				paidBack: true,
				...(restore.owed ? { owedBack: true as const } : {}),
			}),
		);
	// For one Member, each is that Member's share, as the figure the rows are behind counts it.
	const member = scope.filters.member;
	const sharer = member && member !== "everyone" ? member : null;
	const items = [
		...([...a, ...b] as (Omit<ReportItem, "split"> & { split: number; forKey: string })[]).map(
			({ forKey, ...item }): ReportItem => {
				const share = sharer
					? shareFor({ amount: item.amount, for: forKey ? forKey.split(",") : [] }, sharer)
					: item.amount;
				return {
					...item,
					amount: share,
					split: Boolean(item.split),
					...(share === item.amount ? {} : { whole: item.amount }),
				};
			},
		),
		...restored,
	]
		.sort((x, y) =>
			order === "amount"
				? y.amount - x.amount || y.date.localeCompare(x.date)
				: y.date.localeCompare(x.date) || y.amount - x.amount,
		)
		.slice(0, limit);
	const total =
		((countA as { count: number } | undefined)?.count ?? 0) +
		((countB as { count: number } | undefined)?.count ?? 0) +
		restored.length;
	return { items, total };
}

/**
 * The first day the Household has any spending or income recorded, or null when it has none: a
 * Report's period and comparison can't reach usefully before it.
 */
export async function loadHistoryStart(db: Db, householdId: string): Promise<DayKey | null> {
	const [spent, earned] = await Promise.all([
		db
			.select({ first: sql<string | null>`min(${transactions.date})` })
			.from(transactions)
			.where(and(eq(transactions.householdId, householdId), counts())),
		db
			.select({ first: sql<string | null>`min(${incomeCountsOn})` })
			.from(income)
			.where(and(eq(income.householdId, householdId), incomeCounts())),
	]);
	const days = [spent[0]?.first, earned[0]?.first].filter((d): d is string => Boolean(d));
	// Dates are always written as DayKeys.
	return days.length > 0 ? ([...days].sort()[0] as DayKey) : null;
}

/**
 * Income per period and source (its note, lower-cased; "" for none), for a range, each line in
 * the period of the day it counts on (its pay day, else the day it landed). Income is the
 * Household's, never private; only an Account filter narrows it.
 */
export async function loadIncomeCells(
	db: Db,
	householdId: string,
	range: DayRange,
	grouping: Grouping | "all",
	accountId?: string,
): Promise<{ period: string; source: string; name: string; amount: Cents; count: number }[]> {
	const periodSql = periodOf(grouping, incomeCountsOn);
	const source = sql<string>`lower(trim(coalesce(${income.note}, '')))`;
	return (await db
		.select({
			period: periodSql,
			source,
			name: sql<string>`max(trim(coalesce(${income.note}, '')))`,
			amount: sql<number>`sum(${income.amountCents})`,
			count: sql<number>`count(*)`,
		})
		.from(income)
		.where(
			and(
				eq(income.householdId, householdId),
				incomeCounts(),
				gte(incomeCountsOn, range.from),
				lt(incomeCountsOn, range.until),
				accountId ? eq(income.accountId, accountId) : undefined,
			),
		)
		.groupBy(periodSql, source)) as {
		period: string;
		source: string;
		name: string;
		amount: Cents;
		count: number;
	}[];
}

/**
 * Monthly spending per Bucket over whole months, private totals included (Plan vs actual,
 * rollover), optionally only in `bucketIds`.
 */
export async function loadBucketMonths(
	db: Db,
	viewer: Viewer,
	from: MonthKey,
	until: MonthKey,
	bucketIds?: string[],
): Promise<{ bucketId: string; month: MonthKey; amount: Cents }[]> {
	const { cells, privateMonths } = await loadSpendCells(
		db,
		{
			viewer,
			range: { from: `${from}-01` as DayKey, until: `${until}-01` as DayKey },
			filters: bucketIds ? { targets: bucketIds.map((id) => `bucket:${id}`) } : {},
		},
		"month",
	);
	return [...cells, ...privateMonths]
		.filter((cell) => cell.target.startsWith("bucket:"))
		.map((cell) => ({
			bucketId: cell.target.slice("bucket:".length),
			month: cell.period as MonthKey,
			amount: cell.amount,
		}));
}
