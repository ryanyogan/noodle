import {
	type Assignment,
	type AttributedSpend,
	addDays,
	type BucketUse,
	type CategorizationMethod,
	type Cents,
	type DayKey,
	hourAt,
	MATCH_WINDOW,
	type MonthKey,
	merchantKey,
	type SplitAssignment,
	splitsBalance,
} from "@noodle/domain";
import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	notInArray,
	or,
	type SQL,
	type SQLWrapper,
	sql,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { accountLabelSql } from "./account-label";
import { counts } from "./counting";
import { endedBefore, purchaseEndedRestores } from "./ended-months";
import { setAsideSql } from "./goals";
import type { Db } from "./index";
import { matchImported } from "./matches";
import { loadPaidBackSpending } from "./owed-back";
import {
	asPrivateSpending,
	assignableBy,
	changeableBy,
	partlyPrivate,
	privateTotals,
	type Viewer,
	visibleSplit,
	visibleSplitsSum,
	visibleTo,
} from "./privacy";
import {
	accounts,
	buckets,
	categorizations,
	commitments,
	deletedBankLines,
	goals,
	households,
	matches,
	members,
	monthCloses,
	owedBack,
	paidBackMatches,
	receipts,
	refundLinks,
	refunds,
	splitFor,
	splits,
	transactionFor,
	transactions,
	transfers,
} from "./schema";

export type { Assignment, SplitAssignment };

// Transactions for a Household. Every query is scoped by household_id; IDs from the client are
// only ever used together with it (ADR-0004: rows are appended, never read-modify-written).
// Reads are made for a Viewer through privacy.ts, so another Parent's Personal Allowance
// spending, whole or split, never leaves the server (ADR-0003).

/**
 * Spending recorded against a Bucket, with who it was For and the Transaction's ID: a whole
 * Transaction, or one of its Splits (a split Transaction has one of these per Split in a Bucket).
 */
export type BucketSpend = AttributedSpend & { id: string };

/**
 * Spending assigned to Buckets on days from `from` up to, not including, `until`: whole
 * Transactions, and the Splits of split ones, as `viewer` may see them: another Parent's
 * Personal Allowance only as its monthly totals.
 */
export async function loadSpendingBetween(
	db: Db,
	viewer: Viewer,
	from: DayKey,
	until: DayKey,
): Promise<BucketSpend[]> {
	const inRange = and(
		visibleTo(viewer),
		counts(),
		gte(transactions.date, from),
		lt(transactions.date, until),
		isNotNull(transactions.bucketId),
	);
	const splitsInRange = and(
		visibleSplit(viewer),
		eq(transactions.householdId, viewer.householdId),
		counts(),
		gte(transactions.date, from),
		lt(transactions.date, until),
		isNotNull(splits.bucketId),
	);
	const [rows, forRows, splitRows, splitForRows, hiddenWhole, hiddenSplits] = await db.batch([
		db
			.select({
				id: transactions.id,
				bucketId: transactions.bucketId,
				amount: transactions.amountCents,
				date: transactions.date,
			})
			.from(transactions)
			.where(inRange),
		db
			.select({ transactionId: transactionFor.transactionId, memberId: transactionFor.memberId })
			.from(transactionFor)
			.innerJoin(transactions, eq(transactions.id, transactionFor.transactionId))
			.where(and(eq(transactionFor.householdId, viewer.householdId), inRange)),
		db
			.select({
				splitId: splits.id,
				id: splits.transactionId,
				bucketId: splits.bucketId,
				amount: splits.amountCents,
				date: transactions.date,
			})
			.from(splits)
			.innerJoin(transactions, eq(transactions.id, splits.transactionId))
			.where(splitsInRange)
			.orderBy(splits.transactionId, splits.position),
		db
			.select({ transactionId: splitFor.splitId, memberId: splitFor.memberId })
			.from(splitFor)
			.innerJoin(splits, eq(splits.id, splitFor.splitId))
			.innerJoin(transactions, eq(transactions.id, splits.transactionId))
			.where(and(eq(splitFor.householdId, viewer.householdId), splitsInRange)),
		...privateTotals(db, viewer, from, until),
	]);
	const forOf = groupFor(forRows);
	const splitForOf = groupFor(splitForRows);
	// bucket_id is filtered to non-null, and dates are always written as DayKeys.
	return [
		...rows.map((row) => ({ ...row, for: forOf.get(row.id) ?? [] }) as BucketSpend),
		...splitRows.map(
			({ splitId, ...row }) => ({ ...row, for: splitForOf.get(splitId) ?? [] }) as BucketSpend,
		),
		...asPrivateSpending(hiddenWhole, hiddenSplits),
		// Paid back gives each purchase's Bucket its money back on the day it arrived (ADR-0058).
		...(await loadPaidBackSpending(db, viewer, from, until)),
	];
}

/**
 * Money out on days from `from` up to, not including, `until` that isn't assigned yet: imported
 * Transactions in no Bucket, Commitment or Goal and not split, so no spending total counts them.
 */
export async function loadUnassignedBetween(
	db: Db,
	viewer: Viewer,
	from: DayKey,
	until: DayKey,
): Promise<{ count: number; amount: Cents }> {
	const [row] = await db
		.select({
			count: sql<number>`count(*)`,
			amount: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`,
		})
		.from(transactions)
		.where(
			and(
				visibleTo(viewer),
				gte(transactions.date, from),
				lt(transactions.date, until),
				sql`${transactions.amountCents} > 0`,
				isNull(transactions.bucketId),
				isNull(transactions.commitmentId),
				isNull(transactions.goalId),
				sql`not exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`,
			),
		);
	return { count: row?.count ?? 0, amount: (row?.amount ?? 0) as Cents };
}

/** Member IDs by Transaction ID, sorted so the same For always reads the same. */
function groupFor(rows: { transactionId: string; memberId: string }[]): Map<string, string[]> {
	const forOf = new Map<string, string[]>();
	for (const { transactionId, memberId } of rows) {
		forOf.set(transactionId, [...(forOf.get(transactionId) ?? []), memberId].sort());
	}
	return forOf;
}

/** The first day of the month after `month`. */
function nextMonthStart(month: MonthKey): DayKey {
	const [year = 1970, m = 1] = month.split("-").map(Number);
	return (
		m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`
	) as DayKey;
}

/** The month's spending assigned to Buckets, as `viewer` may see it. */
export function loadSpending(db: Db, viewer: Viewer, month: MonthKey): Promise<BucketSpend[]> {
	return loadSpendingBetween(db, viewer, `${month}-01` as DayKey, nextMonthStart(month));
}

/**
 * Spending assigned to Buckets in `month`'s year before `month`, for year-to-date totals, as
 * `viewer` may see it.
 */
export function loadSpendingEarlierInYear(
	db: Db,
	viewer: Viewer,
	month: MonthKey,
): Promise<BucketSpend[]> {
	return loadSpendingBetween(
		db,
		viewer,
		`${month.slice(0, 4)}-01-01` as DayKey,
		`${month}-01` as DayKey,
	);
}

/** How many recent uses likelyBucketOrder looks at. */
const USES_LIMIT = 500;

/**
 * Which Buckets spending `viewer` can see went into since `since`, newest first, for
 * likelyBucketOrder: whole Transactions and Splits.
 */
export async function loadBucketUses(
	db: Db,
	viewer: Viewer,
	since: DayKey,
	/** The Household's, for the hour each use was entered in. */
	timeZone = "UTC",
): Promise<BucketUse[]> {
	const entered = {
		date: transactions.date,
		createdAt: transactions.createdAt,
		merchant: transactions.merchant,
		note: transactions.note,
	};
	const recent = and(visibleTo(viewer), counts(), gte(transactions.date, since));
	const [whole, split] = await db.batch([
		db
			.select({ bucketId: transactions.bucketId, ...entered })
			.from(transactions)
			.where(and(recent, isNotNull(transactions.bucketId)))
			.orderBy(desc(transactions.date))
			.limit(USES_LIMIT),
		db
			.select({ bucketId: splits.bucketId, ...entered })
			.from(splits)
			.innerJoin(transactions, eq(transactions.id, splits.transactionId))
			.where(and(recent, visibleSplit(viewer), isNotNull(splits.bucketId)))
			.orderBy(desc(transactions.date))
			.limit(USES_LIMIT),
	]);
	// Each Split in a Bucket is a use of it, like a whole Transaction.
	return [...whole, ...split]
		.sort((a, b) => b.date.localeCompare(a.date))
		.slice(0, USES_LIMIT)
		.map((use) => {
			const named = (use.merchant ?? use.note ?? "").trim();
			return {
				bucketId: use.bucketId as string,
				date: use.date as DayKey,
				hour: use.createdAt ? hourAt(use.createdAt, timeZone) : null,
				// What Quick Add's note is matched against: the merchant's clean name, else the note.
				merchant: named ? merchantKey(named) : null,
			};
		});
}

/** The Bucket is the Household's and in the Plan for `month` (a MonthKey or a SQL expression). */
const bucketInPlan = (
	householdId: string,
	bucketId: string,
	month: string | ReturnType<typeof sql>,
) =>
	and(
		eq(buckets.id, bucketId),
		eq(buckets.householdId, householdId),
		lte(buckets.fromMonth, month),
		or(isNull(buckets.archivedFromMonth), sql`${buckets.archivedFromMonth} > ${month}`),
	);

/**
 * Records who a Transaction was For: one row per Member, written only if the Transaction is the
 * Household's (so it lands in the same batch that wrote the Transaction, never without it).
 */
function insertFor(
	db: Db,
	input: { householdId: string; transactionId: string; forMemberIds: string[] },
) {
	return db
		.insert(transactionFor)
		.select(
			db
				.select({
					transactionId: sql<string>`${input.transactionId}`.as("transaction_id"),
					memberId: members.id,
					householdId: members.householdId,
				})
				.from(members)
				.where(
					and(
						inArray(members.id, input.forMemberIds),
						eq(members.householdId, input.householdId),
						sql`exists (select 1 from ${transactions} where ${transactions.id} = ${input.transactionId} and ${transactions.householdId} = ${input.householdId})`,
					),
				),
		)
		.onConflictDoNothing();
}

export type QuickAddResult =
	| {
			ok: true;
			/** The months whose Quick Adds were Matched with a bank copy already imported. */
			matchedMonths: string[];
	  }
	| { ok: false; reason: "bucket-not-in-plan" };

/**
 * Records a Quick Add: `amountCents` spent on `date` into a Bucket, For some Members (none for
 * the whole Household). Idempotent per `transactionId`, so a retried or double-tapped Quick Add is
 * recorded once. It is only written if, at write time, the Bucket belongs to the Household, is
 * in the Plan for `date`'s month, and isn't the other Parent's Personal Allowance. With a
 * `receipt` the Parent snapped, the Receipt is attached to it in the same batch (while it's theirs
 * and attached to nothing), and a bank copy already imported, dated within the Match window, is
 * Matched right away: a Receipt's date can be days back.
 */
export async function addQuickAdd(
	db: Db,
	input: {
		householdId: string;
		transactionId: string;
		bucketId: string;
		date: DayKey;
		amountCents: Cents;
		note: string | null;
		forMemberIds: string[];
		createdByMemberId: string;
		receipt?: { id: string; newId: () => string };
		/** The Account it was paid from, for a card kept by hand (issue 136); the Household's, in use. */
		accountId?: string | null;
	},
): Promise<QuickAddResult> {
	const month = input.date.slice(0, 7);
	const insertTransaction = db
		.insert(transactions)
		.select(
			db
				.select({
					id: sql<string>`${input.transactionId}`.as("id"),
					householdId: buckets.householdId,
					source: sql<"quick-add">`'quick-add'`.as("source"),
					date: sql<string>`${input.date}`.as("date"),
					amountCents: sql<number>`${input.amountCents}`.as("amount_cents"),
					bucketId: buckets.id,
					note: sql<string | null>`${input.note}`.as("note"),
					createdByMemberId: sql<string>`${input.createdByMemberId}`.as("created_by_member_id"),
					createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
					commitmentId: sql<string | null>`null`.as("commitment_id"),
					accountId: sql<
						string | null
					>`(select qa.id from accounts qa where qa.id = ${input.accountId ?? null}
						and qa.household_id = ${input.householdId} and qa.archived_at is null)`.as(
						"account_id",
					),
					goalId: sql<string | null>`null`.as("goal_id"),
					importId: sql<string | null>`null`.as("import_id"),
					externalId: sql<string | null>`null`.as("external_id"),
					capturedVia: sql<string | null>`null`.as("captured_via"),
					pending: sql<boolean>`0`.as("pending"),
					merchant: sql<string | null>`null`.as("merchant"),
					version: sql<number>`0`.as("version"),
				})
				.from(buckets)
				.where(
					and(
						bucketInPlan(input.householdId, input.bucketId, month),
						assignableBy(input.createdByMemberId),
					),
				),
		)
		.onConflictDoNothing({ target: transactions.id });
	const batch: BatchItem<"sqlite">[] = [insertTransaction];
	if (input.forMemberIds.length > 0) batch.push(insertFor(db, input));
	const { receipt } = input;
	if (receipt) {
		batch.push(
			db
				.update(receipts)
				.set({ transactionId: input.transactionId })
				.where(
					and(
						eq(receipts.id, receipt.id),
						eq(receipts.householdId, input.householdId),
						eq(receipts.memberId, input.createdByMemberId),
						isNull(receipts.transactionId),
						// Only once the Quick Add is written, and never a second Receipt for it.
						sql`exists (select 1 from ${transactions} where ${transactions.id} = ${input.transactionId} and ${transactions.householdId} = ${input.householdId})`,
						sql`not exists (select 1 from ${receipts} as attached where attached.transaction_id = ${input.transactionId})`,
					),
				),
		);
	}
	await db.batch(batch as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
	// Either this call or an earlier attempt with the same ID wrote it, or the Bucket was refused.
	const [written] = await db
		.select({ id: transactions.id })
		.from(transactions)
		.where(
			and(
				eq(transactions.id, input.transactionId),
				eq(transactions.householdId, input.householdId),
			),
		);
	if (!written) return { ok: false, reason: "bucket-not-in-plan" };
	if (!receipt) return { ok: true, matchedMonths: [] };
	// A bank copy imported before the Receipt was snapped, dated within the Match window.
	const matched = await matchImported(
		db,
		input.householdId,
		addDays(input.date, MATCH_WINDOW.from),
		addDays(input.date, MATCH_WINDOW.to),
		receipt.newId,
	);
	return { ok: true, matchedMonths: matched.months };
}

/** One of a Transaction's Splits, as the list and the edit sheet show it. */
export type SplitRow = {
	id: string;
	amountCents: Cents;
	/** What it's assigned to: a Bucket, a Commitment, or a Goal (Goal spending). */
	bucketId: string | null;
	commitmentId: string | null;
	goal: { id: string; name: string } | null;
	for: string[];
};

/** A Transaction as the Transactions list shows it (to a Viewer). */
export type TransactionRow = {
	id: string;
	date: DayKey;
	/** Its amount; the sum of the Splits shown when some are in the other Parent's Personal Allowance. */
	amountCents: Cents;
	/**
	 * What it's assigned to as a whole: a Bucket, a Commitment, or neither while unassigned or
	 * split. A split Transaction is assigned (and For) only through its Splits.
	 */
	bucketId: string | null;
	commitmentId: string | null;
	/**
	 * The Goal it was spent from, when it's Goal spending: then it's neither a Bucket's nor a
	 * Commitment's, and only changes through the Goal.
	 */
	goal: { id: string; name: string } | null;
	/** Its note; none shown when some of its Splits are in the other Parent's Personal Allowance. */
	note: string | null;
	/** Its merchant's clean name, for an imported line once named (ADR-0027); hidden as the note is. */
	merchantName: string | null;
	/** The name of the Account it was imported from; null unless it came in through an Import. */
	importedFrom: string | null;
	/** It's on a card whose purchases are kept by hand: the Quick Add is the record, no bank copy is awaited. */
	byHand?: boolean;
	/** Reported by the bank but not yet posted: it may change, or go, until its posted copy lands. */
	pending: boolean;
	/** For a Quick Add Matched to its bank copy: the Account the copy was imported into. */
	matchedIn: string | null;
	/**
	 * For a side of a Transfer (which counts nowhere): the Accounts the money left and arrived in,
	 * each null when that side isn't imported.
	 */
	transfer: { from: string | null; to: string | null; reason: "between-us" | null } | null;
	/** For money back linked as a Refund: the purchase's note, or "" when it has none. */
	refundOf: string | null;
	for: string[];
	/** Its Splits in the order they were entered, those the Viewer may see; none unless it's split. */
	splits: SplitRow[];
	/**
	 * Some of its Splits are in the other Parent's Personal Allowance, so it's theirs alone to
	 * change (changeableBy). Says nothing about that part: not its amount, Bucket, or how many.
	 */
	partlyPrivate: boolean;
	/**
	 * How categorization filed it into its Bucket, while it's still there and no Parent has
	 * changed or confirmed it; null otherwise. The list marks it so a Parent can check it.
	 */
	autoFiled: CategorizationMethod | null;
	/**
	 * The name of the Bucket or Commitment it's assigned to as a whole, read with the row (issue
	 * 99): a list of more than a month can't name it from one month's Plan. Null when it has none.
	 */
	assignedName?: string | null;
	/** Which version of it this is: sent back with a change, so one made on an old one is refused (ADR-0041). */
	version: number;
};

/**
 * Where a page of the list starts: after this Transaction, in the list's order. `amountCents` is
 * there for a list by amount, and `key` (what the row sorts on, as the Viewer may see it) for one
 * by name, by what it's assigned to or by Account.
 */
export type TransactionCursor = { date: DayKey; id: string; amountCents?: number; key?: string };

/**
 * How a list of Transactions is ordered: by date (newest first by default), by amount, by name,
 * by what it's assigned to, or by Account. Rows the order can't tell apart go by date and then by
 * ID, in the order's own direction, so the other direction is the same list backwards.
 */
export type TransactionSort =
	| "newest"
	| "oldest"
	| "largest"
	| "smallest"
	| "name-az"
	| "name-za"
	| "assigned-az"
	| "assigned-za"
	| "account-az"
	| "account-za";

/**
 * What a list by name, by what it's assigned to or by Account sorts on: lower-case text, never
 * NULL (a keyset comparison never matches NULL), and only ever what `viewer` is shown.
 *
 * - Name: the name the row carries (a Parent's, or the one it was given when it came in), else
 *   its note or the bank's wording. A Transaction split partly into the other Parent's Personal
 *   Allowance shows no name, so it sorts as one with none: where it lands says nothing about it.
 *   Only the first 200 characters count; the date and the ID settle the rest.
 * - Assigned to: the Bucket's, Commitment's or Goal's name. Unassigned ones sort as "" (first
 *   from A to Z) and split ones as " " (straight after them, before every name).
 * - Account: the label the row shows, the Account it came in from or its Matched copy's; a Quick
 *   Add with neither sorts as "".
 */
function textSortKey(viewer: Viewer, by: "name" | "assigned" | "account"): SQL<string> {
	if (by === "name") {
		return sql<string>`case when ${partlyPrivate(viewer)} then '' else substr(lower(coalesce(nullif(trim(${transactions.merchant}), ''), trim(${transactions.note}), '')), 1, 200) end`;
	}
	if (by === "assigned") {
		return sql<string>`case when ${isSplit} then ' ' else lower(coalesce(
			(select ${buckets.name} from ${buckets} where ${buckets.id} = ${transactions.bucketId}),
			(select ${commitments.name} from ${commitments} where ${commitments.id} = ${transactions.commitmentId}),
			${goals.name}, '')) end`;
	}
	return sql<string>`lower(coalesce(
		case when ${transactions.source} = 'import' then ${accountLabelSql} end,
		(select a.name from matches m
			join transactions c on c.id = m.imported_id join accounts a on a.id = c.account_id
			where m.quick_add_id = ${transactions.id} and m.removed_at is null),
		''))`;
}

/** Transactions with For rows, optionally only those For one Member. */
const hasForRows = (memberId?: string) =>
	sql`exists (select 1 from ${transactionFor} where ${transactionFor.transactionId} = ${transactions.id}${
		memberId ? sql` and ${transactionFor.memberId} = ${memberId}` : sql``
	})`;

/** Splits with For rows, optionally only those For one Member. */
const splitHasForRows = (memberId?: string) =>
	sql`exists (select 1 from ${splitFor} where ${splitFor.splitId} = ${splits.id}${
		memberId ? sql` and ${splitFor.memberId} = ${memberId}` : sql``
	})`;

const isSplit = sql`exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`;

/**
 * The enclosing query's Transaction is spending that waits to be filed (issue 134): in no Bucket,
 * Commitment or Goal, not split, not a side of a Transfer or a matched copy, and not money back.
 * The rows the Transactions list calls "Unassigned", and what its "Needs review" filter keeps.
 */
const needsReview = () =>
	and(
		isNull(transactions.bucketId),
		isNull(transactions.commitmentId),
		isNull(transactions.goalId),
		sql`${transactions.amountCents} > 0`,
		counts(),
		sql`not ${isSplit}`,
	) as SQL;

/**
 * Transactions in a Bucket and For a Member (or For the whole Household): assigned so as a whole,
 * or through one Split `viewer` may see that is both. Undefined when there's nothing to filter by.
 */
function matching(viewer: Viewer, bucketId?: string, forMember?: string): SQL | undefined {
	if (bucketId === undefined && forMember === undefined) return undefined;
	const whole = and(
		sql`not ${isSplit}`,
		bucketId ? eq(transactions.bucketId, bucketId) : undefined,
		forMember === "everyone"
			? sql`not ${hasForRows()}`
			: forMember
				? hasForRows(forMember)
				: undefined,
	);
	const aSplit = sql`exists (select 1 from ${splits} where ${and(
		eq(splits.transactionId, transactions.id),
		visibleSplit(viewer),
		bucketId ? eq(splits.bucketId, bucketId) : undefined,
		forMember === "everyone"
			? sql`not ${splitHasForRows()}`
			: forMember
				? splitHasForRows(forMember)
				: undefined,
	)})`;
	return or(whole, aSplit);
}

/**
 * Transactions in an Account: brought in from it, spent from a Goal on it, or a Quick Add Matched
 * with a line brought in from it (the Matched copy itself is never listed).
 */
const inAccount = (accountId: string) =>
	or(
		eq(transactions.accountId, accountId),
		sql`exists (select 1 from matches m join transactions c on c.id = m.imported_id
			where m.quick_add_id = ${transactions.id} and m.removed_at is null
			and c.account_id = ${accountId})`,
	) as SQL;

/** Characters LIKE reads as wildcards, escaped (with "!") so a search finds them as typed. */
const likeEscaped = (text: string) => text.replace(/[!%_]/g, (c) => `!${c}`);

/**
 * One page of the Transactions that `viewer` may see, newest first: in a month (or in every
 * month), optionally only those in a Bucket, those For a Member (or For the whole Household),
 * those in an Account, and those whose note has `search` in it. `after` continues from a
 * previous page. A Transaction split partly into the other Parent's Personal Allowance shows only
 * its other Splits, with their sum as its amount and no note, so a search never finds it by it.
 */
export async function loadTransactionsPage(
	db: Db,
	viewer: Viewer,
	query: {
		/** Left out for every month (an Account's list). */
		month?: MonthKey;
		/**
		 * With `month`, more than a month (issue 99): from this month's first day to the end of
		 * `month`. Left out, the list is `month` alone.
		 */
		fromMonth?: MonthKey;
		/** With `month`: every month up to the end of it. */
		andEarlier?: boolean;
		bucketId?: string;
		/** A Member's ID, or "everyone" for spending For the whole Household. */
		forMember?: string;
		accountId?: string;
		/** Words in the note (the merchant, for imported ones), any case. */
		search?: string;
		/** Only spending that waits to be filed (`needsReview`). */
		review?: boolean;
		/** Newest first when left out. */
		sort?: TransactionSort;
		after?: TransactionCursor;
		/** Only this Transaction (see `loadTransaction`). */
		transactionId?: string;
		limit: number;
	},
): Promise<{
	transactions: TransactionRow[];
	next: TransactionCursor | null;
	/**
	 * What the filtered month (or months) spent, on the first page of a month's list only (null otherwise):
	 * a Transfer's sides count nowhere and money back takes off, as in the day totals.
	 */
	total: number | null;
	/**
	 * The month's summary (issue 134), on the same page as `total`: what the other filters' rows
	 * spent and how many of them wait to be filed, whether or not `review` narrows the list.
	 */
	summary: { outCents: number; needsReview: number } | null;
}> {
	const householdId = viewer.householdId;
	const partly = partlyPrivate(viewer);
	const search = query.search?.trim();
	const sort = query.sort ?? "newest";
	const amount = sql<number>`case when ${partly} then ${visibleSplitsSum(viewer)} else ${transactions.amountCents} end`;
	const base = and(
		visibleTo(viewer),
		query.transactionId ? eq(transactions.id, query.transactionId) : undefined,
		query.month && !query.andEarlier
			? gte(transactions.date, `${query.fromMonth ?? query.month}-01`)
			: undefined,
		query.month ? lt(transactions.date, nextMonthStart(query.month)) : undefined,
		matching(viewer, query.bucketId, query.forMember),
		query.accountId ? inAccount(query.accountId) : undefined,
		search
			? sql`(not ${partly} and (${transactions.note} like ${`%${likeEscaped(search)}%`} escape '!' or ${transactions.merchant} like ${`%${likeEscaped(search)}%`} escape '!'))`
			: undefined,
	);
	const filtered = query.review ? and(base, needsReview()) : base;
	// Keyset paging: past the previous page's last row in the list's order. Rows the order can't
	// tell apart go by date and then by ID, so no page repeats or skips one.
	const byAmount = sort === "largest" || sort === "smallest";
	const byText =
		sort === "name-az" || sort === "name-za"
			? "name"
			: sort === "assigned-az" || sort === "assigned-za"
				? "assigned"
				: sort === "account-az" || sort === "account-za"
					? "account"
					: null;
	const descending = sort === "newest" || sort === "largest" || sort.endsWith("-za");
	const textKey = byText ? textSortKey(viewer, byText) : null;
	const key = textKey ?? (byAmount ? amount : null);
	const past = (column: SQLWrapper, value: unknown) =>
		descending ? sql`${column} < ${value}` : sql`${column} > ${value}`;
	const pastByDate = (from: TransactionCursor) =>
		or(
			past(transactions.date, from.date),
			and(eq(transactions.date, from.date), past(transactions.id, from.id)),
		);
	// A cursor made for another order has nothing to continue from here, so it's left alone.
	const from = textKey ? query.after?.key : byAmount ? query.after?.amountCents : undefined;
	const after = !query.after
		? undefined
		: !key
			? pastByDate(query.after)
			: from === undefined
				? undefined
				: or(past(key, from), and(sql`${key} = ${from}`, pastByDate(query.after)));
	const direction = descending ? desc : asc;
	const order = [
		...(key ? [direction(key)] : []),
		direction(transactions.date),
		direction(transactions.id),
	];
	const isTransfer = sql`exists (select 1 from transfers x where (x.out_transaction_id = ${transactions.id}
		or x.in_transaction_id = ${transactions.id}) and x.removed_at is null)`;
	const totalQuery =
		query.month && !query.after
			? db
					.select({ total: sql<number>`coalesce(sum(${amount}), 0)`.mapWith(Number) })
					.from(transactions)
					.where(and(filtered, sql`not ${isTransfer}`))
			: null;
	const summaryQuery =
		query.month && !query.after
			? db
					.select({
						outCents:
							sql<number>`coalesce(sum(case when ${isTransfer} then 0 else ${amount} end), 0)`.mapWith(
								Number,
							),
						needsReview:
							sql<number>`coalesce(sum(case when ${needsReview()} then 1 else 0 end), 0)`.mapWith(
								Number,
							),
					})
					.from(transactions)
					.where(base)
			: null;
	const rowsQuery = db
		.select({
			id: transactions.id,
			date: transactions.date,
			amountCents: amount,
			bucketId: transactions.bucketId,
			commitmentId: transactions.commitmentId,
			goalId: transactions.goalId,
			goalName: goals.name,
			note: sql<string | null>`case when ${partly} then null else ${transactions.note} end`,
			merchantName: sql<
				string | null
			>`case when ${partly} then null else ${transactions.merchant} end`,
			partlyPrivate: sql<boolean>`${partly}`.mapWith(Boolean),
			pending: transactions.pending,
			byHand:
				sql<boolean>`coalesce(${accounts.purchases} = 'hand' and ${accounts.bankConnectionId} is null, 0)`.mapWith(
					Boolean,
				),
			importedFrom: sql<
				string | null
			>`case when ${transactions.source} = 'import' then ${accountLabelSql} end`,
			matchedIn: sql<string | null>`(select a.name from matches m
				join transactions c on c.id = m.imported_id join accounts a on a.id = c.account_id
				where m.quick_add_id = ${transactions.id} and m.removed_at is null)`,
			transfer: sql<string | null>`(select json_object(
					'from', coalesce(ao.name, case when x.out_transaction_id is null then oa.name end),
					'to', coalesce(ai.name, ic.name,
						case when x.in_transaction_id is null and x.in_income_id is null then oa.name end),
					'reason', x.reason)
				from transfers x
				left join accounts oa on oa.id = x.other_account_id
				left join transactions o on o.id = x.out_transaction_id left join accounts ao on ao.id = o.account_id
				left join transactions n on n.id = x.in_transaction_id left join accounts ai on ai.id = n.account_id
				left join income i on i.id = x.in_income_id left join accounts ic on ic.id = i.account_id
				where (x.out_transaction_id = ${transactions.id} or x.in_transaction_id = ${transactions.id})
				and x.removed_at is null)`,
			refundOf: sql<string | null>`(select coalesce(o.note, '') from refunds r
				join transactions o on o.id = r.original_transaction_id
				where r.refund_transaction_id = ${transactions.id} and r.removed_at is null)`,
			autoFiled: categorizations.method,
			assignedName: sql<string | null>`coalesce(
				(select ${buckets.name} from ${buckets} where ${buckets.id} = ${transactions.bucketId}),
				(select ${commitments.name} from ${commitments} where ${commitments.id} = ${transactions.commitmentId}))`,
			version: transactions.version,
			sortKey: textKey ?? sql<string | null>`null`,
		})
		.from(transactions)
		.leftJoin(goals, eq(goals.id, transactions.goalId))
		.leftJoin(accounts, eq(accounts.id, transactions.accountId))
		.leftJoin(
			categorizations,
			and(
				eq(categorizations.transactionId, transactions.id),
				eq(categorizations.outcome, "filed"),
				// Still where categorization filed it: its Bucket, or a Rule's Commitment (ADR-0030).
				or(
					eq(categorizations.bucketId, transactions.bucketId),
					eq(categorizations.commitmentId, transactions.commitmentId),
				),
			),
		)
		.where(and(filtered, after))
		.orderBy(...order)
		// One more than asked for says whether there's another page.
		.limit(query.limit + 1);
	const [rows, totalRows, summaryRows] = await Promise.all([rowsQuery, totalQuery, summaryQuery]);
	const summary = summaryRows ? (summaryRows[0] ?? { outCents: 0, needsReview: 0 }) : null;
	const total = totalRows ? (totalRows[0]?.total ?? 0) : null;
	const page = rows.slice(0, query.limit);
	const ids = page.map((row) => row.id);
	const [forRows, splitRows, splitForRows] =
		page.length === 0
			? [[], [], []]
			: await db.batch([
					db
						.select({
							transactionId: transactionFor.transactionId,
							memberId: transactionFor.memberId,
						})
						.from(transactionFor)
						.where(
							and(
								eq(transactionFor.householdId, householdId),
								inArray(transactionFor.transactionId, ids),
							),
						),
					db
						.select({
							id: splits.id,
							transactionId: splits.transactionId,
							amountCents: splits.amountCents,
							bucketId: splits.bucketId,
							commitmentId: splits.commitmentId,
							goalId: splits.goalId,
							goalName: goals.name,
						})
						.from(splits)
						.leftJoin(goals, eq(goals.id, splits.goalId))
						.where(and(visibleSplit(viewer), inArray(splits.transactionId, ids)))
						.orderBy(splits.transactionId, splits.position),
					db
						.select({ transactionId: splitFor.splitId, memberId: splitFor.memberId })
						.from(splitFor)
						.innerJoin(splits, eq(splits.id, splitFor.splitId))
						.where(
							and(
								eq(splitFor.householdId, householdId),
								visibleSplit(viewer),
								inArray(splits.transactionId, ids),
							),
						),
				]);
	const forOf = groupFor(forRows);
	const splitForOf = groupFor(splitForRows);
	const splitsOf = new Map<string, SplitRow[]>();
	for (const { transactionId, goalId, goalName, ...split } of splitRows) {
		splitsOf.set(transactionId, [
			...(splitsOf.get(transactionId) ?? []),
			{
				...split,
				goal: goalId ? { id: goalId, name: goalName ?? "A Goal" } : null,
				for: splitForOf.get(split.id) ?? [],
			},
		]);
	}
	const last = page.at(-1);
	return {
		// Dates are always written as DayKeys.
		transactions: page.map(
			({ goalId, goalName, transfer, sortKey: _sortKey, ...row }) =>
				({
					...row,
					transfer: transfer ? JSON.parse(transfer) : null,
					goal: goalId ? { id: goalId, name: goalName ?? "A Goal" } : null,
					for: forOf.get(row.id) ?? [],
					splits: splitsOf.get(row.id) ?? [],
				}) as TransactionRow,
		),
		next:
			rows.length > query.limit && last
				? {
						date: last.date as DayKey,
						id: last.id,
						amountCents: last.amountCents,
						...(last.sortKey === null ? {} : { key: last.sortKey }),
					}
				: null,
		total,
		summary,
	};
}

/**
 * One Transaction as the list would show it to `viewer`, or null when the list never would: it
 * isn't the Household's, it's deleted, or it's in the other Parent's Personal Allowance
 * (ADR-0003). One split partly into theirs comes back as the list has it: only its other Splits.
 */
export async function loadTransaction(
	db: Db,
	viewer: Viewer,
	transactionId: string,
): Promise<TransactionRow | null> {
	const page = await loadTransactionsPage(db, viewer, { transactionId, limit: 1 });
	return page.transactions[0] ?? null;
}

export type TransactionEditResult =
	/** `version` is the Transaction's once the change landed: what the next change is made on. */
	| { ok: true; version: number }
	/** "changed-elsewhere": it is no longer at the version the change was made on, or is gone. */
	| { ok: false; reason: "not-in-plan" | "splits-unbalanced" | "changed-elsewhere" };

/** How a guarded write that sets no new values ended (a delete, a return to Review). */
export type TransactionWriteResult =
	| { ok: true; version: number | null }
	/** `month-ended`: money back on it counted in a month that has ended (ADR-0058). */
	| { ok: false; reason: "changed-elsewhere" | "month-ended" };

/** The guard for a change made on version `expected`: the Transaction is still at it (ADR-0041). */
const atVersion = (expected: number | undefined) =>
	expected === undefined ? undefined : eq(transactions.version, expected);

/** Once a change made on `expected` has landed, the Transaction is one version on. */
const pastVersion = (expected: number | undefined) =>
	expected === undefined ? undefined : eq(transactions.version, expected + 1);

/** The Household's Transaction's version now; undefined once it's gone. */
export async function transactionVersion(db: Db, householdId: string, transactionId: string) {
	const [row] = await db
		.select({ version: transactions.version })
		.from(transactions)
		.where(and(eq(transactions.id, transactionId), eq(transactions.householdId, householdId)));
	return row?.version;
}

/** Why a change didn't land: the Transaction moved on from the version it was made on, or the Plan. */
async function refusal(
	db: Db,
	input: { householdId: string; transactionId: string; expectedVersion?: number },
): Promise<"changed-elsewhere" | "not-in-plan"> {
	if (input.expectedVersion === undefined) return "not-in-plan";
	const version = await transactionVersion(db, input.householdId, input.transactionId);
	return version === input.expectedVersion ? "not-in-plan" : "changed-elsewhere";
}

/**
 * What `assignment` names is the Household's and, for a Bucket or Commitment, in the Plan for
 * `month` (a SQL expression), and, if a Bucket, one the Parent `memberId` can assign to (not the
 * other Parent's Personal Allowance). A Goal only needs to be one that isn't archived; its
 * set-aside money is checked for all of a Transaction's Splits together (goalPartsFit).
 */
const assignable = (
	householdId: string,
	memberId: string,
	assignment: SplitAssignment,
	month: SQL,
) =>
	"bucketId" in assignment
		? sql`exists (select 1 from ${buckets} where ${and(
				bucketInPlan(householdId, assignment.bucketId, month),
				assignableBy(memberId),
			)})`
		: "goalId" in assignment
			? sql`exists (select 1 from ${goals} where ${and(
					eq(goals.id, assignment.goalId),
					eq(goals.householdId, householdId),
					isNull(goals.archivedAt),
				)})`
			: sql`exists (select 1 from ${commitments} where ${and(
					eq(commitments.id, assignment.commitmentId),
					eq(commitments.householdId, householdId),
					lte(commitments.fromMonth, month),
					or(isNull(commitments.endedFromMonth), sql`${commitments.endedFromMonth} > ${month}`),
				)})`;

/** The columns a Split's assignment is written to. */
const assignmentColumns = (assignment: SplitAssignment) => ({
	bucketId: "bucketId" in assignment ? assignment.bucketId : null,
	commitmentId: "commitmentId" in assignment ? assignment.commitmentId : null,
	goalId: "goalId" in assignment ? assignment.goalId : null,
});

/**
 * Every Goal the Splits take from has what's set aside for them, counting what the Transaction's
 * current Splits already take from it (they're replaced), so a retry or a re-split isn't refused
 * for its own earlier Goal spending.
 */
function goalPartsFit(householdId: string, transactionId: string, parts: SplitInput[]) {
	const perGoal = new Map<string, Cents>();
	for (const part of parts) {
		if ("goalId" in part.assignment) {
			const { goalId } = part.assignment;
			perGoal.set(goalId, (perGoal.get(goalId) ?? 0) + part.amountCents);
		}
	}
	return and(
		...[...perGoal].map(
			([goalId, amount]) =>
				sql`${setAsideSql(householdId, goalId)} + coalesce((select sum(s.amount_cents) from splits s
					where s.household_id = ${householdId} and s.transaction_id = ${transactionId}
					and s.goal_id = ${goalId}), 0) >= ${amount}`,
		),
	);
}

/**
 * The Transaction is the Household's and the Parent `memberId`'s to change here: not in the other
 * Parent's Personal Allowance (privacy.ts), and not Goal spending, which changes only through its
 * Goal.
 */
export const editableBy = (householdId: string, memberId: string) =>
	and(changeableBy({ householdId, memberId }), isNull(transactions.goalId)) as SQL;

/**
 * The Transaction `transactionId`, `theTransaction`, is one nobody has decided the assignment of:
 * no Splits (but `ours`, left by an earlier try of the same write), and unassigned or only as
 * categorization filed it. What a Receipt applies on its own is guarded by this.
 */
export const stillUndecided = (theTransaction: SQL | undefined, ours: string[] = []) =>
	sql`exists (select 1 from ${transactions} where ${and(
		theTransaction,
		sql`not exists (select 1 from ${splits} where ${and(
			sql`${splits.transactionId} = ${transactions.id}`,
			ours.length > 0 ? notInArray(splits.id, ours) : undefined,
		)})`,
		or(
			and(
				isNull(transactions.bucketId),
				isNull(transactions.commitmentId),
				isNull(transactions.goalId),
			),
			sql`exists (select 1 from ${categorizations} where ${categorizations.transactionId} = ${transactions.id})`,
		),
	)})`;

/** Deletes a Transaction's Splits and their For, only while `when` holds (in the same batch). */
export function clearSplits(db: Db, householdId: string, transactionId: string, when?: SQL) {
	const ofTheTransaction = and(
		eq(splits.transactionId, transactionId),
		eq(splits.householdId, householdId),
	);
	return [
		db
			.delete(splitFor)
			.where(
				and(
					eq(splitFor.householdId, householdId),
					inArray(
						splitFor.splitId,
						db.select({ id: splits.id }).from(splits).where(ofTheTransaction),
					),
					when,
				),
			),
		db.delete(splits).where(and(ofTheTransaction, when)),
	] as const;
}

/**
 * The merchant's clean name to keep when a note is set to `note`: unchanged while the note is,
 * cleared when it changes, so the next background run names it again from the new note (ADR-0027).
 */
const keptMerchant = (note: string | null) =>
	sql<string | null>`case when ${transactions.note} is ${note} then ${transactions.merchant} end`;

/**
 * An imported line's name once a Parent has changed it to `name` (#95): its note, the bank's own
 * wording, stays as it is. Anything else keeps to keptMerchant: a by-hand one's name is its note.
 */
const namedMerchant = (note: string | null, name: string | undefined) =>
	name === undefined
		? keptMerchant(note)
		: sql<
				string | null
			>`case when ${transactions.source} = 'import' then ${name} else ${keptMerchant(note)} end`;

/** True once an imported line goes by the `name` a change gave it (for the landed check). */
const namedAs = (name: string | undefined) =>
	name === undefined
		? undefined
		: sql`(${transactions.source} <> 'import' or ${transactions.merchant} is ${name})`;

/**
 * Changes a Transaction's amount, assignment, note, and For, all at once, assigning it as a whole
 * (so any Splits it had are removed), for the Parent `memberId`. Idempotent: it sets values, so a
 * retry lands the same. The Transaction only changes if, at write time, it is the Household's and
 * theirs to change (no spending in the other Parent's Personal Allowance, even through a Split,
 * and not Goal spending), and what it's assigned to is in the Plan for its month and, if a
 * Bucket, one they can assign to. Its For and Splits only change together with it, in the same
 * batch.
 */
export async function updateTransaction(
	db: Db,
	input: {
		householdId: string;
		memberId: string;
		transactionId: string;
		amountCents: Cents;
		assignment: Assignment;
		note: string | null;
		forMemberIds: string[];
		/** Only while nobody has decided its assignment (a Receipt applying itself). */
		undecided?: boolean;
		/** The version the Parent made this change on: refused if it has moved on (ADR-0041). */
		expectedVersion?: number;
		/** The name a Parent gave an imported line; its note (the bank's wording) is kept. */
		name?: string;
	},
): Promise<TransactionEditResult> {
	const bucketId = "bucketId" in input.assignment ? input.assignment.bucketId : null;
	const commitmentId = "commitmentId" in input.assignment ? input.assignment.commitmentId : null;
	// The month of the Transaction being updated (a correlated reference inside the guards).
	const month = sql`substr(${transactions.date}, 1, 7)`;
	const theTransaction = and(
		eq(transactions.id, input.transactionId),
		editableBy(input.householdId, input.memberId),
	);
	// True once the Transaction holds the new values: the update landed, now or on an earlier try.
	const edited = sql`exists (select 1 from ${transactions} where ${and(
		theTransaction,
		eq(transactions.amountCents, input.amountCents),
		sql`${transactions.bucketId} is ${bucketId}`,
		sql`${transactions.commitmentId} is ${commitmentId}`,
		sql`${transactions.note} is ${input.note}`,
		namedAs(input.name),
		pastVersion(input.expectedVersion),
	)})`;
	const update = db
		.update(transactions)
		.set({
			amountCents: input.amountCents,
			bucketId,
			commitmentId,
			note: input.note,
			merchant: namedMerchant(input.note, input.name),
			version: sql`${transactions.version} + 1`,
		})
		.where(
			and(
				theTransaction,
				assignable(input.householdId, input.memberId, input.assignment, month),
				input.undecided ? stillUndecided(theTransaction) : undefined,
				atVersion(input.expectedVersion),
			),
		);
	const clearFor = db
		.delete(transactionFor)
		.where(
			and(
				eq(transactionFor.transactionId, input.transactionId),
				eq(transactionFor.householdId, input.householdId),
				edited,
			),
		);
	const cleared = clearSplits(db, input.householdId, input.transactionId, edited);
	if (input.forMemberIds.length > 0) {
		const setFor = db
			.insert(transactionFor)
			.select(
				db
					.select({
						transactionId: sql<string>`${input.transactionId}`.as("transaction_id"),
						memberId: members.id,
						householdId: members.householdId,
					})
					.from(members)
					.where(
						and(
							inArray(members.id, input.forMemberIds),
							eq(members.householdId, input.householdId),
							edited,
						),
					),
			)
			.onConflictDoNothing();
		await db.batch([update, clearFor, ...cleared, setFor]);
	} else {
		await db.batch([update, clearFor, ...cleared]);
	}
	const [landed] = await db
		.select({ version: transactions.version })
		.from(transactions)
		.where(and(theTransaction, edited));
	if (landed) return { ok: true, version: landed.version };
	return { ok: false, reason: await refusal(db, input) };
}

/** How a rename ended. "not-editable": not theirs to change here (or not the Household's). */
export type TransactionRenameResult =
	| { ok: true; version: number }
	| { ok: false; reason: "changed-elsewhere" | "not-editable" };

/**
 * Changes only what a Transaction is called, for the Parent `memberId` (issue 99): its amount,
 * assignment, For and Splits stay as they are, so it also takes the rows a whole-assignment edit
 * can't (unassigned, split, a side of a Transfer, money back). An imported line takes the name
 * and keeps its note, the bank's own wording (#95); a by-hand one's name is its note. Guarded as
 * every change is: the Household's, theirs to change (not Goal spending, nothing in the other
 * Parent's Personal Allowance), and still at the version it was made on (ADR-0041). Idempotent:
 * it sets values, so a retry lands the same.
 */
export async function renameTransaction(
	db: Db,
	input: {
		householdId: string;
		memberId: string;
		transactionId: string;
		name: string;
		/** The version the Parent made this change on: refused if it has moved on (ADR-0041). */
		expectedVersion?: number;
	},
): Promise<TransactionRenameResult> {
	const theTransaction = and(
		eq(transactions.id, input.transactionId),
		editableBy(input.householdId, input.memberId),
	);
	const byBank = sql`${transactions.source} = 'import'`;
	await db
		.update(transactions)
		.set({
			// Before the note changes: keptMerchant reads the note the row has now.
			merchant: sql<
				string | null
			>`case when ${byBank} then ${input.name} else ${keptMerchant(input.name)} end`,
			note: sql<
				string | null
			>`case when ${byBank} then ${transactions.note} else ${input.name} end`,
			version: sql`${transactions.version} + 1`,
		})
		.where(and(theTransaction, atVersion(input.expectedVersion)));
	const [landed] = await db
		.select({ version: transactions.version })
		.from(transactions)
		.where(
			and(
				theTransaction,
				sql`case when ${byBank} then ${transactions.merchant} is ${input.name} else ${transactions.note} is ${input.name} end`,
				pastVersion(input.expectedVersion),
			),
		);
	if (landed) return { ok: true, version: landed.version };
	const reason = await refusal(db, input);
	return { ok: false, reason: reason === "not-in-plan" ? "not-editable" : reason };
}

/** A Split to write: its client ID, amount, assignment, and For (none for the whole Household). */
export type SplitInput = {
	id: string;
	amountCents: Cents;
	assignment: SplitAssignment;
	forMemberIds: string[];
};

/**
 * Splits a Transaction: sets its amount and note and replaces its whole assignment, its For, and
 * any Splits it had with `splits`, all in one batch. The Splits must add up to the amount.
 * Idempotent by the Splits' client IDs, so a retry lands the same. Nothing changes unless, at
 * write time, the Transaction is the Household's and the Parent `memberId`'s to change (no
 * spending in the other Parent's Personal Allowance), and every Split's Bucket or Commitment is in
 * the Plan for its month and, if a Bucket, one they can assign to (so never the other Parent's
 * Personal Allowance), and every Split assigned to a Goal fits in what it has set aside (a Goal that isn't
 * archived); Splits and their For are only written onto that Transaction.
 */
export async function splitTransaction(
	db: Db,
	input: {
		householdId: string;
		memberId: string;
		transactionId: string;
		amountCents: Cents;
		note: string | null;
		splits: SplitInput[];
		/** Only while nobody has decided its assignment (a Receipt applying itself). */
		undecided?: boolean;
		/** The version the Parent made this change on: refused if it has moved on (ADR-0041). */
		expectedVersion?: number;
		/** The name a Parent gave an imported line; its note (the bank's wording) is kept. */
		name?: string;
	},
): Promise<TransactionEditResult> {
	const { householdId, memberId, transactionId } = input;
	if (
		!splitsBalance(
			input.amountCents,
			input.splits.map((split) => ({ amount: split.amountCents })),
		)
	) {
		return { ok: false, reason: "splits-unbalanced" };
	}
	const theTransaction = and(eq(transactions.id, transactionId), editableBy(householdId, memberId));
	const month = sql`(select substr(${transactions.date}, 1, 7) from ${transactions} where ${theTransaction})`;
	const allAssignable = and(
		...input.splits.map((split) => assignable(householdId, memberId, split.assignment, month)),
		goalPartsFit(householdId, transactionId, input.splits),
	);
	// True once the Transaction holds the new values as a split one, now or on an earlier try.
	const edited = sql`exists (select 1 from ${transactions} where ${and(
		theTransaction,
		eq(transactions.amountCents, input.amountCents),
		isNull(transactions.bucketId),
		isNull(transactions.commitmentId),
		sql`${transactions.note} is ${input.note}`,
		namedAs(input.name),
		pastVersion(input.expectedVersion),
	)})`;
	const undecided = input.undecided
		? stillUndecided(
				theTransaction,
				input.splits.map((split) => split.id),
			)
		: undefined;
	// Splits are only replaced while every one of them can be assigned.
	const splitNow = and(edited, allAssignable, undecided) as SQL;
	const update = db
		.update(transactions)
		.set({
			amountCents: input.amountCents,
			bucketId: null,
			commitmentId: null,
			note: input.note,
			merchant: namedMerchant(input.note, input.name),
			version: sql`${transactions.version} + 1`,
		})
		.where(and(theTransaction, allAssignable, undecided, atVersion(input.expectedVersion)));
	const clearFor = db
		.delete(transactionFor)
		.where(
			and(
				eq(transactionFor.transactionId, transactionId),
				eq(transactionFor.householdId, householdId),
				splitNow,
			),
		);
	const writes = input.splits.flatMap((split, position) => {
		const insertSplit = db
			.insert(splits)
			.select(
				// Columns in schema order: insert…select fills them by position.
				db
					.select({
						id: sql<string>`${split.id}`.as("id"),
						householdId: transactions.householdId,
						transactionId: transactions.id,
						position: sql<number>`${position}`.as("position"),
						amountCents: sql<number>`${split.amountCents}`.as("amount_cents"),
						bucketId: sql<string | null>`${assignmentColumns(split.assignment).bucketId}`.as(
							"bucket_id",
						),
						commitmentId: sql<
							string | null
						>`${assignmentColumns(split.assignment).commitmentId}`.as("commitment_id"),
						goalId: sql<string | null>`${assignmentColumns(split.assignment).goalId}`.as("goal_id"),
					})
					.from(transactions)
					.where(and(theTransaction, splitNow)),
			)
			.onConflictDoNothing({ target: splits.id });
		if (split.forMemberIds.length === 0) return [insertSplit];
		const insertSplitFor = db
			.insert(splitFor)
			.select(
				db
					.select({
						splitId: sql<string>`${split.id}`.as("split_id"),
						memberId: members.id,
						householdId: members.householdId,
					})
					.from(members)
					.where(
						and(
							inArray(members.id, split.forMemberIds),
							eq(members.householdId, householdId),
							sql`exists (select 1 from ${splits} where ${and(
								eq(splits.id, split.id),
								eq(splits.transactionId, transactionId),
								eq(splits.householdId, householdId),
							)})`,
						),
					),
			)
			.onConflictDoNothing();
		return [insertSplit, insertSplitFor];
	});
	await db.batch([
		update,
		clearFor,
		...clearSplits(db, householdId, transactionId, splitNow),
		...writes,
	]);
	const written = await db
		.select({
			id: splits.id,
			amountCents: splits.amountCents,
			bucketId: splits.bucketId,
			commitmentId: splits.commitmentId,
			goalId: splits.goalId,
		})
		.from(splits)
		.where(
			and(eq(splits.transactionId, transactionId), eq(splits.householdId, householdId), edited),
		);
	// Landed if the Transaction holds exactly these Splits, now or from an earlier try.
	const landed =
		written.length === input.splits.length &&
		input.splits.every((split) => {
			const columns = assignmentColumns(split.assignment);
			return written.some(
				(row) =>
					row.id === split.id &&
					row.amountCents === split.amountCents &&
					row.bucketId === columns.bucketId &&
					row.commitmentId === columns.commitmentId &&
					row.goalId === columns.goalId,
			);
		});
	if (!landed) return { ok: false, reason: await refusal(db, input) };
	return { ok: true, version: (await transactionVersion(db, householdId, transactionId)) ?? 0 };
}

/** Raw SQL: the IDs of money back linked as a Refund of the Transaction `id`. */
const refundedBy = (id: string) =>
	sql`(select r.refund_transaction_id from refunds r where r.original_transaction_id = ${id}
		and r.removed_at is null)`;

/**
 * Deletes a Transaction, its For, and its Splits, for the Parent `memberId`: never one with
 * spending in the other Parent's Personal Allowance, even through a Split, and never Goal spending
 * (that changes only through its Goal). Idempotent: deleting it again changes nothing. Refused
 * (`month-ended`) once money Paid back on it, or a Refund linked to it, counted in a month that
 * has ended as of `today`: that month's figures stay (ADR-0058).
 */
export async function deleteTransaction(
	db: Db,
	input: {
		householdId: string;
		memberId: string;
		transactionId: string;
		/** The version the Parent saw when they deleted it: left alone if it has moved on (ADR-0041). */
		expectedVersion?: number;
		/** The Household's day; UTC's when left out. */
		today?: DayKey;
	},
): Promise<TransactionWriteResult> {
	const ended = purchaseEndedRestores(endedBefore(input.today));
	const theTransaction = and(
		eq(transactions.id, input.transactionId),
		editableBy(input.householdId, input.memberId),
		atVersion(input.expectedVersion),
		sql`not ${ended}`,
	) as SQL;
	await db.batch([
		// A bank or statement line's ID is remembered, so an Import never brings it back (ADR-0045).
		rememberDeletedLines(db, theTransaction),
		...transactionDeletes(db, { ...input, theTransaction }),
	]);
	const [kept] = await db
		.select({ id: transactions.id })
		.from(transactions)
		.where(
			and(
				eq(transactions.id, input.transactionId),
				editableBy(input.householdId, input.memberId),
				atVersion(input.expectedVersion),
				ended,
			),
		);
	if (kept) return { ok: false, reason: "month-ended" };
	if (input.expectedVersion === undefined) return { ok: true, version: null };
	// Gone is deleted, now or on an earlier try; still there at another version was changed elsewhere.
	const version = await transactionVersion(db, input.householdId, input.transactionId);
	return version === undefined || version === input.expectedVersion
		? { ok: true, version: null }
		: { ok: false, reason: "changed-elsewhere" };
}

/**
 * The writes that delete the Transaction `transactionId` while it's `theTransaction` (a guard on
 * the transactions table, which should name it and its Household): its For, its Splits, its
 * Refunds and Transfers (money back linked as its Refund is unassigned again), and its Matches.
 */
export function transactionDeletes(
	db: Db,
	input: { householdId: string; transactionId: string; theTransaction: SQL },
): BatchItem<"sqlite">[] {
	const { theTransaction } = input;
	const deletable = sql`exists (select 1 from ${transactions} where ${theTransaction})`;
	return [
		...clearSplits(db, input.householdId, input.transactionId, deletable),
		db
			.delete(transactionFor)
			.where(
				and(
					eq(transactionFor.transactionId, input.transactionId),
					eq(transactionFor.householdId, input.householdId),
					deletable,
				),
			),
		// Money back linked to it as a Refund is unassigned again, and its Refunds and Transfers go.
		db
			.delete(transactionFor)
			.where(
				and(
					eq(transactionFor.householdId, input.householdId),
					inArray(transactionFor.transactionId, refundedBy(input.transactionId)),
					deletable,
				),
			),
		db
			.update(transactions)
			.set({
				bucketId: null,
				commitmentId: null,
				goalId: null,
				version: sql`${transactions.version} + 1`,
			})
			.where(
				and(
					eq(transactions.householdId, input.householdId),
					inArray(transactions.id, refundedBy(input.transactionId)),
					deletable,
				),
			),
		// A Refund in checking linked to it is linked to nothing again.
		db
			.delete(refundLinks)
			.where(
				and(
					eq(refundLinks.householdId, input.householdId),
					eq(refundLinks.transactionId, input.transactionId),
					deletable,
				),
			),
		// What was Owed back on it goes with it; money Paid back on it waits unmatched again.
		db.delete(paidBackMatches).where(
			and(
				eq(paidBackMatches.householdId, input.householdId),
				sql`${paidBackMatches.owedBackId} in (select ob.id from owed_back ob
					where ob.transaction_id = ${input.transactionId})`,
				deletable,
			),
		),
		db
			.delete(owedBack)
			.where(
				and(
					eq(owedBack.householdId, input.householdId),
					eq(owedBack.transactionId, input.transactionId),
					deletable,
				),
			),
		db
			.delete(refunds)
			.where(
				and(
					eq(refunds.householdId, input.householdId),
					or(
						eq(refunds.originalTransactionId, input.transactionId),
						eq(refunds.refundTransactionId, input.transactionId),
					),
					deletable,
				),
			),
		db
			.delete(transfers)
			.where(
				and(
					eq(transfers.householdId, input.householdId),
					or(
						eq(transfers.outTransactionId, input.transactionId),
						eq(transfers.inTransactionId, input.transactionId),
					),
					deletable,
				),
			),
		// A deleted Quick Add's bank copy counts again; its Match history goes with it.
		db
			.delete(matches)
			.where(
				and(
					eq(matches.householdId, input.householdId),
					or(
						eq(matches.quickAddId, input.transactionId),
						eq(matches.importedId, input.transactionId),
					),
					deletable,
				),
			),
		db.delete(transactions).where(theTransaction),
	];
}

/**
 * Remembers the line IDs of the imported Transactions `these` (a guard on the transactions table)
 * as deleted from their Accounts, in the batch that deletes them (ADR-0045).
 */
function rememberDeletedLines(db: Db, these: SQL) {
	return db
		.insert(deletedBankLines)
		.select(
			db
				.select({
					// Selected in the table's column order: insert … select is positional.
					householdId: sql<string>`${transactions.householdId}`.as("household_id"),
					accountId: sql<string>`${transactions.accountId}`.as("account_id"),
					externalId: sql<string>`${transactions.externalId}`.as("external_id"),
					deletedAt: sql<Date>`(unixepoch() * 1000)`.as("deleted_at"),
				})
				.from(transactions)
				.where(and(these, isNotNull(transactions.accountId), isNotNull(transactions.externalId))),
		)
		.onConflictDoNothing();
}

/**
 * Transactions picked on the Transactions page: by ID (`ids`), or every one its filters match
 * (`all`: a month, or that month and every month before it) but `except`.
 */
export type TransactionSelection = {
	ids?: string[];
	all?: {
		month: MonthKey;
		/** Every earlier month too: "everything up to the end of <month>". */
		andEarlier?: boolean;
		/** Or from this month's first day to the end of `month` (issue 99): the last 3 months, this year. */
		fromMonth?: MonthKey;
		bucketId?: string;
		forMember?: string;
		accountId?: string;
		search?: string;
		/** Only spending that waits to be filed, as the list's "Needs review" filter. */
		review?: boolean;
	};
	except?: string[];
};

const idList = (ids: string[]) => sql`(select value from json_each(${JSON.stringify(ids)}))`;

/** The selection as the list shows it to `viewer`: the same filters `loadTransactionsPage` applies. */
function selectedBy(viewer: Viewer, selection: TransactionSelection): SQL {
	const { all } = selection;
	if (!all) {
		return and(visibleTo(viewer), inArray(transactions.id, idList(selection.ids ?? []))) as SQL;
	}
	const search = all.search?.trim();
	return and(
		visibleTo(viewer),
		all.andEarlier ? undefined : gte(transactions.date, `${all.fromMonth ?? all.month}-01`),
		lt(transactions.date, nextMonthStart(all.month)),
		matching(viewer, all.bucketId, all.forMember),
		all.accountId ? inAccount(all.accountId) : undefined,
		all.review ? needsReview() : undefined,
		search
			? sql`(not ${partlyPrivate(viewer)} and (${transactions.note} like ${`%${likeEscaped(search)}%`} escape '!' or ${transactions.merchant} like ${`%${likeEscaped(search)}%`} escape '!'))`
			: undefined,
		selection.except?.length ? notInArray(transactions.id, idList(selection.except)) : undefined,
	) as SQL;
}

/** What deleting a selection would do, for the Parent to read before they confirm (ADR-0045). */
export type DeletionSummary = {
	/** How many would be deleted. */
	count: number;
	firstDate: DayKey | null;
	lastDate: DayKey | null;
	totalCents: Cents;
	/** The names of the Accounts they are in. */
	accounts: string[];
	/** Of them: assigned to a Bucket or a Commitment, as a whole or through Splits. */
	filed: number;
	split: number;
	/** One side of a Transfer: the other side stays, as an ordinary Transaction again. */
	transfers: number;
	/** A purchase with a Refund, or the Refund itself. */
	refunds: number;
	/** With a Receipt, which stays, unattached. */
	receipts: number;
	/** In a month that has been closed. */
	closedMonths: number;
	/** Brought in from a bank or a statement: they won't be brought in again. */
	imported: number;
	/** Selected but not this Parent's to delete here: Goal spending. They stay. */
	staying: number;
};

const transferSide = sql`exists (select 1 from transfers x where (x.out_transaction_id = ${transactions.id}
	or x.in_transaction_id = ${transactions.id}) and x.removed_at is null)`;
const refundSide = sql`exists (select 1 from refunds r where (r.original_transaction_id = ${transactions.id}
	or r.refund_transaction_id = ${transactions.id}) and r.removed_at is null)`;
const hasReceipt = sql`exists (select 1 from ${receipts} where ${receipts.transactionId} = ${transactions.id})`;
const inClosedMonth = sql`exists (select 1 from ${monthCloses} where ${monthCloses.householdId} = ${transactions.householdId}
	and ${monthCloses.month} = substr(${transactions.date}, 1, 7))`;

/** The facts about a selection, counted from the rows as they are now. Changes nothing. */
export async function summarizeDeletion(
	db: Db,
	viewer: Viewer,
	selection: TransactionSelection,
): Promise<DeletionSummary> {
	const picked = selectedBy(viewer, selection);
	const editable = editableBy(viewer.householdId, viewer.memberId);
	const deletable = and(picked, editable);
	const n = (when: SQL) =>
		sql<number>`coalesce(sum(case when ${when} then 1 else 0 end), 0)`.mapWith(Number);
	const [[facts], [every], accountRows] = await db.batch([
		db
			.select({
				count: sql<number>`count(*)`.mapWith(Number),
				firstDate: sql<string | null>`min(${transactions.date})`,
				lastDate: sql<string | null>`max(${transactions.date})`,
				totalCents: sql<number>`coalesce(sum(${transactions.amountCents}), 0)`.mapWith(Number),
				filed: n(
					sql`(${transactions.bucketId} is not null or ${transactions.commitmentId} is not null or ${isSplit})`,
				),
				split: n(isSplit),
				transfers: n(transferSide),
				refunds: n(refundSide),
				receipts: n(hasReceipt),
				closedMonths: n(inClosedMonth),
				imported: n(sql`${transactions.importId} is not null`),
			})
			.from(transactions)
			.where(deletable),
		db
			.select({ count: sql<number>`count(*)`.mapWith(Number) })
			.from(transactions)
			.where(picked),
		db
			.selectDistinct({ name: accounts.name })
			.from(transactions)
			.innerJoin(accounts, eq(accounts.id, transactions.accountId))
			.where(deletable)
			.orderBy(asc(accounts.name)),
	]);
	const count = facts?.count ?? 0;
	return {
		count,
		firstDate: (facts?.firstDate ?? null) as DayKey | null,
		lastDate: (facts?.lastDate ?? null) as DayKey | null,
		totalCents: facts?.totalCents ?? 0,
		accounts: accountRows.map((row) => row.name),
		filed: facts?.filed ?? 0,
		split: facts?.split ?? 0,
		transfers: facts?.transfers ?? 0,
		refunds: facts?.refunds ?? 0,
		receipts: facts?.receipts ?? 0,
		closedMonths: facts?.closedMonths ?? 0,
		imported: facts?.imported ?? 0,
		staying: (every?.count ?? 0) - count,
	};
}

/** How many Transactions one batch deletes: their IDs travel as one JSON parameter. */
export const BULK_DELETE_CHUNK = 100;
/** The most one bulk delete takes on; a second run takes the rest. */
export const BULK_DELETE_MAX = 5000;

/**
 * Deletes every Transaction in the selection that is the Parent's to delete, as it is when this
 * runs: with its For, Splits, Refund links, Transfers and Matches, as deleting one does, and the
 * line IDs of imported ones remembered so they never come back (ADR-0045). Goal spending and
 * anything partly in the other Parent's Personal Allowance stay. `beforeDeleting` is told how
 * many are about to go, before any does; if it throws, nothing is deleted. A hundred go per
 * batch, each batch whole or not at all; a retry deletes what is left, so it is safe to run twice.
 */
export async function deleteTransactions(
	db: Db,
	viewer: Viewer,
	selection: TransactionSelection,
	options: {
		beforeDeleting?: (count: number) => Promise<void>;
		/** The Household's day; UTC's when left out. */
		today?: DayKey;
	} = {},
): Promise<{ deleted: number }> {
	const { householdId } = viewer;
	// One whose money back counted in a month that has ended stays, with that money (ADR-0058).
	const editable = and(
		editableBy(householdId, viewer.memberId),
		sql`not ${purchaseEndedRestores(endedBefore(options.today))}`,
	) as SQL;
	const targets = await db
		.select({ id: transactions.id })
		.from(transactions)
		.where(and(selectedBy(viewer, selection), editable))
		.orderBy(asc(transactions.id))
		.limit(BULK_DELETE_MAX);
	if (targets.length === 0) return { deleted: 0 };
	await options.beforeDeleting?.(targets.length);
	let deleted = 0;
	for (let start = 0; start < targets.length; start += BULK_DELETE_CHUNK) {
		const chunk = targets.slice(start, start + BULK_DELETE_CHUNK).map((row) => row.id);
		const these = and(inArray(transactions.id, idList(chunk)), editable) as SQL;
		// Read afresh by every statement: only what is still the Parent's to delete.
		const theirs = () => db.select({ id: transactions.id }).from(transactions).where(these);
		const refunded = () =>
			db
				.select({ id: refunds.refundTransactionId })
				.from(refunds)
				.where(
					and(
						eq(refunds.householdId, householdId),
						isNull(refunds.removedAt),
						inArray(refunds.originalTransactionId, theirs()),
					),
				);
		await db.batch([
			rememberDeletedLines(db, these),
			db.delete(splitFor).where(
				and(
					eq(splitFor.householdId, householdId),
					inArray(
						splitFor.splitId,
						db
							.select({ id: splits.id })
							.from(splits)
							.where(
								and(eq(splits.householdId, householdId), inArray(splits.transactionId, theirs())),
							),
					),
				),
			),
			db
				.delete(splits)
				.where(and(eq(splits.householdId, householdId), inArray(splits.transactionId, theirs()))),
			db
				.delete(transactionFor)
				.where(
					and(
						eq(transactionFor.householdId, householdId),
						inArray(transactionFor.transactionId, theirs()),
					),
				),
			// Money back linked to one as a Refund is unassigned again, as when one is deleted.
			db
				.delete(transactionFor)
				.where(
					and(
						eq(transactionFor.householdId, householdId),
						inArray(transactionFor.transactionId, refunded()),
					),
				),
			db
				.update(transactions)
				.set({
					bucketId: null,
					commitmentId: null,
					goalId: null,
					version: sql`${transactions.version} + 1`,
				})
				.where(
					and(eq(transactions.householdId, householdId), inArray(transactions.id, refunded())),
				),
			db
				.delete(refundLinks)
				.where(
					and(
						eq(refundLinks.householdId, householdId),
						inArray(refundLinks.transactionId, theirs()),
					),
				),
			db
				.delete(paidBackMatches)
				.where(
					and(
						eq(paidBackMatches.householdId, householdId),
						inArray(
							paidBackMatches.owedBackId,
							db
								.select({ id: owedBack.id })
								.from(owedBack)
								.where(inArray(owedBack.transactionId, theirs())),
						),
					),
				),
			db
				.delete(owedBack)
				.where(
					and(eq(owedBack.householdId, householdId), inArray(owedBack.transactionId, theirs())),
				),
			db
				.delete(refunds)
				.where(
					and(
						eq(refunds.householdId, householdId),
						or(
							inArray(refunds.originalTransactionId, theirs()),
							inArray(refunds.refundTransactionId, theirs()),
						),
					),
				),
			// The other side of a Transfer stays, an ordinary Transaction again.
			db
				.delete(transfers)
				.where(
					and(
						eq(transfers.householdId, householdId),
						or(
							inArray(transfers.outTransactionId, theirs()),
							inArray(transfers.inTransactionId, theirs()),
						),
					),
				),
			db
				.delete(matches)
				.where(
					and(
						eq(matches.householdId, householdId),
						or(inArray(matches.quickAddId, theirs()), inArray(matches.importedId, theirs())),
					),
				),
			db.delete(transactions).where(these),
		]);
		const [left] = await db
			.select({ count: sql<number>`count(*)`.mapWith(Number) })
			.from(transactions)
			.where(
				and(eq(transactions.householdId, householdId), inArray(transactions.id, idList(chunk))),
			);
		deleted += chunk.length - (left?.count ?? 0);
	}
	return { deleted };
}

/** The most Transactions one "File in…" takes; a second run takes the rest. */
export const BULK_FILE_MAX = 5000;

/** Selected Transactions "File in…" left as they are, by why (issue 99, ADR-0055). */
export type FilingSkips = {
	split: number;
	/** One side of a Transfer. */
	transfer: number;
	/** Money back, linked as a Refund or not. */
	moneyBack: number;
	/** Goal spending: it changes from its Goal. */
	goal: number;
	/** Partly in the other Parent's Personal Allowance: theirs to change. */
	private: number;
	/** No longer at the version this screen showed (ADR-0041), or changed while this ran. */
	changed: number;
	/** Not in the month being filed in. */
	otherMonth: number;
};

/** A Transaction as it was before "File in…" changed it, and its version after: what Undo needs. */
export type FiledBefore = {
	id: string;
	bucketId: string | null;
	commitmentId: string | null;
	/** Its version once filed: Undo only puts back one still at it. */
	version: number;
	/** Who it was For before, when the filing set a For too (issue 138): Undo puts that back as well. */
	for?: string[];
};

export type FilingResult =
	| {
			ok: true;
			filed: number;
			/** Already assigned, whole, to the same Bucket or Commitment: nothing to do. */
			already: number;
			skipped: FilingSkips;
			undo: FiledBefore[];
	  }
	| { ok: false; reason: "not-in-plan" | "more-than-a-month" };

/** Money back linked as a Refund (the purchase it refunds is an ordinary Transaction here). */
const refundMoney = sql`exists (select 1 from refunds r where r.refund_transaction_id = ${transactions.id}
	and r.removed_at is null)`;
const hasSplits = sql`exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`;

/** One Bucket or Commitment can take it whole: what a cell of the table refiles too (`cellEdits`). */
const fileableWhole = sql`(not ${hasSplits} and not ${transferSide} and not ${refundMoney} and ${transactions.amountCents} >= 1)`;

/** The Transaction is in `pairs` ([id, version, …] rows of JSON), `ahead` versions past the one there. */
const inPairs = (pairs: string, ahead: 0 | 1) =>
	sql`exists (select 1 from json_each(${pairs}) j where json_extract(j.value, '$[0]') = ${transactions.id}
		and json_extract(j.value, '$[1]') + ${ahead} = ${transactions.version})`;

/**
 * Files every selected Transaction that one Bucket or Commitment can take whole in `assignment`,
 * for the Parent `viewer` (issue 99, ADR-0055): "File in…" on the Transactions page. Only inside
 * `month`, whose Plan the target must be in. Left as they are, and counted: Splits, sides of a
 * Transfer, money back, Goal spending, anything partly in the other Parent's Personal Allowance,
 * and any whose version is not the one in `versions` (the rows the screen had loaded; others are
 * filed as they are). Only the assignment changes: amount and name stay, and so does For unless
 * `forMemberIds` is given (issue 138): then each one filed is For those Members (none: Everyone),
 * one already in the target included when its For differs. A Transaction filed here leaves
 * categorization, as one filed by hand does; no merchant is learned from it.
 *
 * Each is written only while still at the version read here, so a change made meanwhile is left
 * alone. Safe to retry: what is already there is counted as `already` and not touched.
 */
export async function fileTransactions(
	db: Db,
	viewer: Viewer,
	input: {
		selection: TransactionSelection;
		month: MonthKey;
		assignment: Assignment;
		versions?: Record<string, number>;
		/** Who they are For from now on; left out, For stays as it is. */
		forMemberIds?: string[];
	},
): Promise<FilingResult> {
	const { householdId, memberId } = viewer;
	const { selection, month, assignment } = input;
	const wider = selection.all?.fromMonth !== undefined && selection.all.fromMonth !== month;
	if (selection.all && (selection.all.andEarlier || wider || selection.all.month !== month)) {
		return { ok: false, reason: "more-than-a-month" };
	}
	const bucketId = "bucketId" in assignment ? assignment.bucketId : null;
	const commitmentId = "commitmentId" in assignment ? assignment.commitmentId : null;
	const target = assignable(householdId, memberId, assignment, sql`${month}`);
	const [inPlan] = await db
		.select({ id: households.id })
		.from(households)
		.where(and(eq(households.id, householdId), target));
	if (!inPlan) return { ok: false, reason: "not-in-plan" };

	const editable = editableBy(householdId, memberId);
	const flag = (when: SQL) => sql<boolean>`(${when})`.mapWith(Boolean);
	const rows = await db
		.select({
			id: transactions.id,
			version: transactions.version,
			date: transactions.date,
			bucketId: transactions.bucketId,
			commitmentId: transactions.commitmentId,
			goalId: transactions.goalId,
			amountCents: transactions.amountCents,
			editable: flag(editable),
			split: flag(hasSplits),
			transfer: flag(transferSide),
			refund: flag(refundMoney),
		})
		.from(transactions)
		.where(selectedBy(viewer, selection))
		.orderBy(asc(transactions.id))
		.limit(BULK_FILE_MAX);

	// With a For given: who each is For now, to tell what is already so and what Undo puts back.
	const forNow = new Map<string, string[]>();
	let forNext: string[] | null = null;
	if (input.forMemberIds) {
		const [theirs, current] = await Promise.all([
			input.forMemberIds.length === 0
				? []
				: db
						.select({ id: members.id })
						.from(members)
						.where(
							and(eq(members.householdId, householdId), inArray(members.id, input.forMemberIds)),
						),
			db
				.select({ transactionId: transactionFor.transactionId, memberId: transactionFor.memberId })
				.from(transactionFor)
				.where(
					and(
						eq(transactionFor.householdId, householdId),
						inArray(
							transactionFor.transactionId,
							db
								.select({ id: transactions.id })
								.from(transactions)
								.where(selectedBy(viewer, selection)),
						),
					),
				)
				.orderBy(asc(transactionFor.memberId)),
		]);
		forNext = theirs.map((member) => member.id).sort();
		for (const row of current) {
			forNow.set(row.transactionId, [...(forNow.get(row.transactionId) ?? []), row.memberId]);
		}
	}
	const sameFor = (id: string) =>
		forNext === null || (forNow.get(id) ?? []).join() === forNext.join();

	const skipped: FilingSkips = {
		split: 0,
		transfer: 0,
		moneyBack: 0,
		goal: 0,
		private: 0,
		changed: 0,
		otherMonth: 0,
	};
	let already = 0;
	const toFile: typeof rows = [];
	for (const row of rows) {
		const sent = input.versions?.[row.id];
		if (row.goalId) skipped.goal++;
		else if (!row.editable) skipped.private++;
		else if (row.date.slice(0, 7) !== month) skipped.otherMonth++;
		else if (row.transfer) skipped.transfer++;
		else if (row.refund || row.amountCents < 1) skipped.moneyBack++;
		else if (row.split) skipped.split++;
		else if (row.bucketId === bucketId && row.commitmentId === commitmentId && sameFor(row.id))
			already++;
		else if (sent !== undefined && sent !== row.version) skipped.changed++;
		else toFile.push(row);
	}

	const inMonth = and(
		gte(transactions.date, `${month}-01`),
		lt(transactions.date, nextMonthStart(month)),
	);
	const undo: FiledBefore[] = [];
	for (let start = 0; start < toFile.length; start += BULK_DELETE_CHUNK) {
		const chunk = toFile.slice(start, start + BULK_DELETE_CHUNK);
		const pairs = JSON.stringify(chunk.map((row) => [row.id, row.version]));
		// Filed by this write (or an earlier try of it): one version on, and in the target.
		const landed = and(
			eq(transactions.householdId, householdId),
			inPairs(pairs, 1),
			sql`${transactions.bucketId} is ${bucketId}`,
			sql`${transactions.commitmentId} is ${commitmentId}`,
		);
		await db.batch([
			db
				.update(transactions)
				.set({ bucketId, commitmentId, version: sql`${transactions.version} + 1` })
				.where(and(editable, inMonth, fileableWhole, target, inPairs(pairs, 0))),
			// A Parent has decided these now: categorization's marker goes, as when one is filed by hand.
			db
				.delete(categorizations)
				.where(
					and(
						eq(categorizations.householdId, householdId),
						inArray(
							categorizations.transactionId,
							db.select({ id: transactions.id }).from(transactions).where(landed),
						),
					),
				),
			...(forNext === null ? [] : forWrites(db, householdId, landed, forNext)),
		]);
		const done = new Set(
			(await db.select({ id: transactions.id }).from(transactions).where(landed)).map(
				(row) => row.id,
			),
		);
		for (const row of chunk) {
			if (!done.has(row.id)) skipped.changed++;
			else {
				undo.push({
					id: row.id,
					bucketId: row.bucketId,
					commitmentId: row.commitmentId,
					version: row.version + 1,
					...(forNext === null ? {} : { for: forNow.get(row.id) ?? [] }),
				});
			}
		}
	}
	return { ok: true, filed: undo.length, already, skipped, undo };
}

/** Every one of `these` Transactions is For `memberIds` (none: Everyone) from now on. */
function forWrites(db: Db, householdId: string, these: SQL | undefined, memberIds: string[]) {
	const clear = db
		.delete(transactionFor)
		.where(
			and(
				eq(transactionFor.householdId, householdId),
				inArray(
					transactionFor.transactionId,
					db.select({ id: transactions.id }).from(transactions).where(these),
				),
			),
		);
	if (memberIds.length === 0) return [clear];
	const set = db
		.insert(transactionFor)
		.select(
			db
				.select({
					transactionId: sql<string>`${transactions.id}`.as("transaction_id"),
					memberId: sql<string>`${members.id}`.as("member_id"),
					householdId: sql<string>`${members.householdId}`.as("household_id"),
				})
				.from(members)
				.innerJoin(transactions, and(these) as SQL)
				.where(and(eq(members.householdId, householdId), inArray(members.id, memberIds))),
		)
		.onConflictDoNothing();
	return [clear, set];
}

/**
 * Undo for "File in…" (ADR-0055): puts each Transaction back in the Bucket or Commitment it had
 * (or none), only while it is still at the version the filing left it at, still the Parent's to
 * change, and what it goes back to is the Household's and theirs to assign to. Says how many went
 * back. One whose filing set a For too goes back to who it was For before. Safe to retry: one
 * already put back is one version on and is not touched again.
 */
export async function unfileTransactions(
	db: Db,
	viewer: Viewer,
	entries: FiledBefore[],
): Promise<{ restored: number }> {
	const { householdId, memberId } = viewer;
	const editable = editableBy(householdId, memberId);
	let restored = 0;
	for (let start = 0; start < entries.length; start += BULK_DELETE_CHUNK) {
		const chunk = entries.slice(start, start + BULK_DELETE_CHUNK);
		const pairs = JSON.stringify(
			chunk.map((entry) => [entry.id, entry.version, entry.bucketId, entry.commitmentId]),
		);
		const was = (index: 2 | 3) =>
			sql<string | null>`(select json_extract(j.value, ${`$[${index}]`}) from json_each(${pairs}) j
				where json_extract(j.value, '$[0]') = ${transactions.id})`;
		// What it goes back to is still the Household's, and a Bucket this Parent can assign to.
		const theirs = sql`(${was(2)} is null or exists (select 1 from buckets b where b.id = ${was(2)}
			and b.household_id = ${householdId} and (b.owner_member_id is null or b.owner_member_id = ${memberId})))
			and (${was(3)} is null or exists (select 1 from commitments c where c.id = ${was(3)}
			and c.household_id = ${householdId}))`;
		const going = await db
			.select({ id: transactions.id })
			.from(transactions)
			.where(and(editable, fileableWhole, inPairs(pairs, 0), theirs));
		// For goes back in the same write, only on those this very write puts back: they were at the
		// filing's version just now and are one on after it.
		const versions = new Map(chunk.map((entry) => [entry.id, entry.version]));
		const withFor = chunk.filter(
			(entry) => entry.for !== undefined && going.some((row) => row.id === entry.id),
		);
		const back = and(
			eq(transactions.householdId, householdId),
			inPairs(JSON.stringify(withFor.map((entry) => [entry.id, versions.get(entry.id)])), 1),
		);
		const whose = JSON.stringify(
			withFor.flatMap((entry) => (entry.for ?? []).map((memberId) => [entry.id, memberId])),
		);
		const update = db
			.update(transactions)
			.set({
				bucketId: was(2),
				commitmentId: was(3),
				version: sql`${transactions.version} + 1`,
			})
			.where(and(editable, fileableWhole, inPairs(pairs, 0), theirs));
		if (withFor.length === 0) await update;
		else {
			await db.batch([
				update,
				db
					.delete(transactionFor)
					.where(
						and(
							eq(transactionFor.householdId, householdId),
							inArray(
								transactionFor.transactionId,
								db.select({ id: transactions.id }).from(transactions).where(back),
							),
						),
					),
				db
					.insert(transactionFor)
					.select(
						db
							.select({
								transactionId: sql<string>`${transactions.id}`.as("transaction_id"),
								memberId: sql<string>`${members.id}`.as("member_id"),
								householdId: sql<string>`${members.householdId}`.as("household_id"),
							})
							.from(members)
							.innerJoin(
								transactions,
								and(
									back,
									sql`exists (select 1 from json_each(${whose}) f
										where json_extract(f.value, '$[0]') = ${transactions.id}
										and json_extract(f.value, '$[1]') = ${members.id})`,
								) as SQL,
							)
							.where(eq(members.householdId, householdId)),
					)
					.onConflictDoNothing(),
			]);
		}
		const [after] = await db
			.select({ count: sql<number>`count(*)`.mapWith(Number) })
			.from(transactions)
			.where(and(editable, fileableWhole, inPairs(pairs, 0), theirs));
		restored += Math.max(0, going.length - (after?.count ?? 0));
	}
	return { restored };
}
