import {
	type Assignment,
	type AttributedSpend,
	addDays,
	type BucketUse,
	type CategorizationMethod,
	type Cents,
	type DayKey,
	MATCH_WINDOW,
	type MonthKey,
	type SplitAssignment,
	splitsBalance,
} from "@noodle/domain";
import {
	and,
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
	sql,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { counts } from "./counting";
import { earmarkSql } from "./goals";
import type { Db } from "./index";
import { matchImported } from "./matches";
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
	goals,
	matches,
	members,
	receipts,
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
export async function loadBucketUses(db: Db, viewer: Viewer, since: DayKey): Promise<BucketUse[]> {
	const recent = and(visibleTo(viewer), counts(), gte(transactions.date, since));
	const [whole, split] = await db.batch([
		db
			.select({ bucketId: transactions.bucketId, date: transactions.date })
			.from(transactions)
			.where(and(recent, isNotNull(transactions.bucketId)))
			.orderBy(desc(transactions.date))
			.limit(USES_LIMIT),
		db
			.select({ bucketId: splits.bucketId, date: transactions.date })
			.from(splits)
			.innerJoin(transactions, eq(transactions.id, splits.transactionId))
			.where(and(recent, visibleSplit(viewer), isNotNull(splits.bucketId)))
			.orderBy(desc(transactions.date))
			.limit(USES_LIMIT),
	]);
	// Each Split in a Bucket is a use of it, like a whole Transaction.
	return [...whole, ...split]
		.sort((a, b) => b.date.localeCompare(a.date))
		.slice(0, USES_LIMIT) as BucketUse[];
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
					accountId: sql<string | null>`null`.as("account_id"),
					goalId: sql<string | null>`null`.as("goal_id"),
					importId: sql<string | null>`null`.as("import_id"),
					externalId: sql<string | null>`null`.as("external_id"),
					capturedVia: sql<string | null>`null`.as("captured_via"),
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
	/** The name of the Account it was imported from; null unless it came in through an Import. */
	importedFrom: string | null;
	/** For a Quick Add Matched to its bank copy: the Account the copy was imported into. */
	matchedIn: string | null;
	/**
	 * For a side of a Transfer (which counts nowhere): the Accounts the money left and arrived in,
	 * each null when that side isn't imported.
	 */
	transfer: { from: string | null; to: string | null } | null;
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
};

/** Where a page of the list starts: after this Transaction, going back in time. */
export type TransactionCursor = { date: DayKey; id: string };

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
 * One page of a month's Transactions that `viewer` may see, newest first, optionally only those
 * in a Bucket and only those For a Member (or For the whole Household). `after` continues from
 * a previous page. A Transaction split partly into the other Parent's Personal Allowance shows
 * only its other Splits, with their sum as its amount and no note.
 */
export async function loadTransactionsPage(
	db: Db,
	viewer: Viewer,
	query: {
		month: MonthKey;
		bucketId?: string;
		/** A Member's ID, or "everyone" for spending For the whole Household. */
		forMember?: string;
		after?: TransactionCursor;
		limit: number;
	},
): Promise<{ transactions: TransactionRow[]; next: TransactionCursor | null }> {
	const householdId = viewer.householdId;
	const partly = partlyPrivate(viewer);
	const rows = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			amountCents: sql<number>`case when ${partly} then ${visibleSplitsSum(viewer)} else ${transactions.amountCents} end`,
			bucketId: transactions.bucketId,
			commitmentId: transactions.commitmentId,
			goalId: transactions.goalId,
			goalName: goals.name,
			note: sql<string | null>`case when ${partly} then null else ${transactions.note} end`,
			partlyPrivate: sql<boolean>`${partly}`.mapWith(Boolean),
			importedFrom: sql<
				string | null
			>`case when ${transactions.source} = 'import' then ${accounts.name} end`,
			matchedIn: sql<string | null>`(select a.name from matches m
				join transactions c on c.id = m.imported_id join accounts a on a.id = c.account_id
				where m.quick_add_id = ${transactions.id} and m.removed_at is null)`,
			transfer: sql<
				string | null
			>`(select json_object('from', ao.name, 'to', coalesce(ai.name, ic.name))
				from transfers x
				left join transactions o on o.id = x.out_transaction_id left join accounts ao on ao.id = o.account_id
				left join transactions n on n.id = x.in_transaction_id left join accounts ai on ai.id = n.account_id
				left join income i on i.id = x.in_income_id left join accounts ic on ic.id = i.account_id
				where (x.out_transaction_id = ${transactions.id} or x.in_transaction_id = ${transactions.id})
				and x.removed_at is null)`,
			refundOf: sql<string | null>`(select coalesce(o.note, '') from refunds r
				join transactions o on o.id = r.original_transaction_id
				where r.refund_transaction_id = ${transactions.id} and r.removed_at is null)`,
			autoFiled: categorizations.method,
		})
		.from(transactions)
		.leftJoin(goals, eq(goals.id, transactions.goalId))
		.leftJoin(accounts, eq(accounts.id, transactions.accountId))
		.leftJoin(
			categorizations,
			and(
				eq(categorizations.transactionId, transactions.id),
				eq(categorizations.outcome, "filed"),
				eq(categorizations.bucketId, transactions.bucketId),
			),
		)
		.where(
			and(
				visibleTo(viewer),
				gte(transactions.date, `${query.month}-01`),
				lt(transactions.date, nextMonthStart(query.month)),
				matching(viewer, query.bucketId, query.forMember),
				query.after
					? or(
							lt(transactions.date, query.after.date),
							and(eq(transactions.date, query.after.date), lt(transactions.id, query.after.id)),
						)
					: undefined,
			),
		)
		.orderBy(desc(transactions.date), desc(transactions.id))
		// One more than asked for says whether there's another page.
		.limit(query.limit + 1);
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
			({ goalId, goalName, transfer, ...row }) =>
				({
					...row,
					transfer: transfer ? JSON.parse(transfer) : null,
					goal: goalId ? { id: goalId, name: goalName ?? "A Goal" } : null,
					for: forOf.get(row.id) ?? [],
					splits: splitsOf.get(row.id) ?? [],
				}) as TransactionRow,
		),
		next: rows.length > query.limit && last ? { date: last.date as DayKey, id: last.id } : null,
	};
}

export type TransactionEditResult =
	| { ok: true }
	| { ok: false; reason: "not-in-plan" | "splits-unbalanced" };

/**
 * What `assignment` names is the Household's and, for a Bucket or Commitment, in the Plan for
 * `month` (a SQL expression), and, if a Bucket, one the Parent `memberId` can assign to (not the
 * other Parent's Personal Allowance). A Goal only needs to be one that isn't archived; its
 * Earmark is checked for all of a Transaction's Splits together (goalPartsFit).
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
 * Every Goal the Splits take from has the Earmark for them, counting what the Transaction's
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
				sql`${earmarkSql(householdId, goalId)} + coalesce((select sum(s.amount_cents) from splits s
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
const editableBy = (householdId: string, memberId: string) =>
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
function clearSplits(db: Db, householdId: string, transactionId: string, when?: SQL) {
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
	)})`;
	const update = db
		.update(transactions)
		.set({ amountCents: input.amountCents, bucketId, commitmentId, note: input.note })
		.where(
			and(
				theTransaction,
				assignable(input.householdId, input.memberId, input.assignment, month),
				input.undecided ? stillUndecided(theTransaction) : undefined,
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
		.select({ id: transactions.id })
		.from(transactions)
		.where(and(theTransaction, edited));
	return landed ? { ok: true } : { ok: false, reason: "not-in-plan" };
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
 * Personal Allowance), and every Split assigned to a Goal fits in its Earmark (a Goal that isn't
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
		.set({ amountCents: input.amountCents, bucketId: null, commitmentId: null, note: input.note })
		.where(and(theTransaction, allAssignable, undecided));
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
	return landed ? { ok: true } : { ok: false, reason: "not-in-plan" };
}

/** Raw SQL: the IDs of money back linked as a Refund of the Transaction `id`. */
const refundedBy = (id: string) =>
	sql`(select r.refund_transaction_id from refunds r where r.original_transaction_id = ${id}
		and r.removed_at is null)`;

/**
 * Deletes a Transaction, its For, and its Splits, for the Parent `memberId`: never one with
 * spending in the other Parent's Personal Allowance, even through a Split, and never Goal spending
 * (that changes only through its Goal). Idempotent: deleting it again changes nothing.
 */
export async function deleteTransaction(
	db: Db,
	input: { householdId: string; memberId: string; transactionId: string },
): Promise<void> {
	const theTransaction = and(
		eq(transactions.id, input.transactionId),
		editableBy(input.householdId, input.memberId),
	);
	const deletable = sql`exists (select 1 from ${transactions} where ${theTransaction})`;
	await db.batch([
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
			.set({ bucketId: null, commitmentId: null, goalId: null })
			.where(
				and(
					eq(transactions.householdId, input.householdId),
					inArray(transactions.id, refundedBy(input.transactionId)),
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
	]);
}
