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
import { THRESHOLD_STOPS } from "@noodle/domain";
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
import { counts, incomeCounts } from "./counting";
import type { Db } from "./index";
import { partlyPrivate, privateTotals, type Viewer, visibleSplit, visibleTo } from "./privacy";
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
	/** A merchant key, as `merchantKey` groups them. */
	merchant?: string;
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

/** A merchant, as a Report groups them: the note, trimmed and lower-cased ("" when there's none). */
const merchantKey = (viewer: Viewer, from: Parts["from"]) =>
	from === "whole"
		? sql<string>`lower(trim(coalesce(${transactions.note}, '')))`
		: // A split Transaction partly in the other Parent's Personal Allowance shows them no note.
			sql<string>`case when ${partlyPrivate(viewer)} then '' else lower(trim(coalesce(${transactions.note}, ''))) end`;

/** The note a merchant is shown by (any one of its spellings). */
const merchantName = (viewer: Viewer, from: Parts["from"]) =>
	from === "whole"
		? sql<string>`max(trim(coalesce(${transactions.note}, '')))`
		: sql<string>`max(case when ${partlyPrivate(viewer)} then '' else trim(coalesce(${transactions.note}, '')) end)`;

const targetOf = (parts: Pick<Parts, "bucketId" | "commitmentId" | "goalId">) =>
	sql<Target>`case when ${parts.bucketId} is not null then 'bucket:' || ${parts.bucketId} when ${parts.commitmentId} is not null then 'commitment:' || ${parts.commitmentId} when ${parts.goalId} is not null then 'goal:' || ${parts.goalId} else 'unassigned' end`;

/**
 * The period a part falls in, keyed as periodKey in @noodle/domain: its week's Monday, its month,
 * its quarter, or one period for the whole range ("all").
 */
function periodOf(grouping: Grouping | "all", date: AnyColumn = transactions.date): SQL<string> {
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
			? eq(merchantKey(viewer, parts.from), filters.merchant)
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

/**
 * Spending per period and Target. Other Parents' Personal Allowances add their monthly totals
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
	return { cells: [...(wholeRows as SpendCell[]), ...(splitRows as SpendCell[])], privateMonths };
}

/** Spending per day (visible spending only: private totals have no days). */
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
	const byDay = new Map<string, number>();
	for (const row of [...a, ...b] as { day: string; amount: number }[]) {
		byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.amount);
	}
	return [...byDay]
		.map(([day, amount]) => ({ day: day as DayKey, amount }))
		.sort((x, y) => x.day.localeCompare(y.day));
}

/** Spending per period by who it was For (see spendFor in @noodle/domain). */
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
	return ([...a, ...b] as { period: string; forKey: string; amount: number; count: number }[]).map(
		({ forKey, ...row }) => ({ ...row, for: forKey ? forKey.split(",") : [] }),
	);
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
		return fromParts(db, parts, {
			key,
			name: merchantName(scope.viewer, parts.from),
			amount,
			count,
			targets: sql<number>`count(distinct ${targetOf(parts)})`,
		})
			.where(parts.where)
			.groupBy(key)
			.orderBy(desc(order === "amount" ? amount : count))
			.limit(limit);
	};
	const rows = await db.batch([
		query(whole, "amount"),
		query(split, "amount"),
		query(whole, "count"),
		query(split, "count"),
	]);
	const merge = (lists: MerchantTotal[][]) => {
		const byKey = new Map<string, MerchantTotal>();
		for (const row of lists.flat()) {
			const seen = byKey.get(row.key);
			byKey.set(
				row.key,
				seen
					? {
							...seen,
							name: seen.name || row.name,
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
	target: Target;
	accountId: string | null;
	/** It's one Split of a split Transaction. */
	split: boolean;
};

/**
 * Parts `viewer` may see, newest first or largest first, at most `limit` (and how many there are
 * in all). The deepest level of a drill-down; never another Parent's Personal Allowance.
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
			target: targetOf(parts),
			accountId: transactions.accountId,
			split: sql<number>`${parts.from === "split" ? 1 : 0}`,
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
	const items = ([...a, ...b] as (Omit<ReportItem, "split"> & { split: number })[])
		.map((item) => ({ ...item, split: Boolean(item.split) }))
		.sort((x, y) =>
			order === "amount"
				? y.amount - x.amount || y.date.localeCompare(x.date)
				: y.date.localeCompare(x.date) || y.amount - x.amount,
		)
		.slice(0, limit);
	const total =
		((countA as { count: number } | undefined)?.count ?? 0) +
		((countB as { count: number } | undefined)?.count ?? 0);
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
			.select({ first: sql<string | null>`min(${income.date})` })
			.from(income)
			.where(and(eq(income.householdId, householdId), incomeCounts())),
	]);
	const days = [spent[0]?.first, earned[0]?.first].filter((d): d is string => Boolean(d));
	// Dates are always written as DayKeys.
	return days.length > 0 ? ([...days].sort()[0] as DayKey) : null;
}

/**
 * Income per period and source (its note, lower-cased; "" for none), for a range. Income is the
 * Household's, never private; only an Account filter narrows it.
 */
export async function loadIncomeCells(
	db: Db,
	householdId: string,
	range: DayRange,
	grouping: Grouping | "all",
	accountId?: string,
): Promise<{ period: string; source: string; name: string; amount: Cents; count: number }[]> {
	const periodSql = periodOf(grouping, income.date);
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
				gte(income.date, range.from),
				lt(income.date, range.until),
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
