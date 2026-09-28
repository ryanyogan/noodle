import {
	type Assignment,
	type AttributedSpend,
	type BucketUse,
	type Cents,
	type DayKey,
	type MonthKey,
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
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import type { Db } from "./index";
import {
	buckets,
	commitments,
	members,
	splitFor,
	splits,
	transactionFor,
	transactions,
} from "./schema";

export type { Assignment };

// Transactions for a Household. Every query is scoped by household_id; IDs from the client are
// only ever used together with it (ADR-0004: rows are appended, never read-modify-written).

/**
 * Spending recorded against a Bucket, with who it was For and the Transaction's ID: a whole
 * Transaction, or one of its Splits (a split Transaction has one of these per Split in a Bucket).
 */
export type BucketSpend = AttributedSpend & { id: string };

/**
 * Spending assigned to Buckets on days from `from` up to, not including, `until`: whole
 * Transactions, and the Splits of split ones.
 */
async function loadSpendingBetween(
	db: Db,
	householdId: string,
	from: DayKey,
	until: DayKey,
): Promise<BucketSpend[]> {
	const inRange = and(
		eq(transactions.householdId, householdId),
		gte(transactions.date, from),
		lt(transactions.date, until),
		isNotNull(transactions.bucketId),
	);
	const splitsInRange = and(
		eq(splits.householdId, householdId),
		eq(transactions.householdId, householdId),
		gte(transactions.date, from),
		lt(transactions.date, until),
		isNotNull(splits.bucketId),
	);
	const [rows, forRows, splitRows, splitForRows] = await db.batch([
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
			.where(and(eq(transactionFor.householdId, householdId), inRange)),
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
			.where(and(eq(splitFor.householdId, householdId), splitsInRange)),
	]);
	const forOf = groupFor(forRows);
	const splitForOf = groupFor(splitForRows);
	// bucket_id is filtered to non-null, and dates are always written as DayKeys.
	return [
		...rows.map((row) => ({ ...row, for: forOf.get(row.id) ?? [] })),
		...splitRows.map(({ splitId, ...row }) => ({ ...row, for: splitForOf.get(splitId) ?? [] })),
	] as BucketSpend[];
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

/** The month's spending assigned to Buckets. */
export function loadSpending(db: Db, householdId: string, month: MonthKey): Promise<BucketSpend[]> {
	return loadSpendingBetween(db, householdId, `${month}-01` as DayKey, nextMonthStart(month));
}

/** Spending assigned to Buckets in `month`'s year before `month`, for year-to-date totals. */
export function loadSpendingEarlierInYear(
	db: Db,
	householdId: string,
	month: MonthKey,
): Promise<BucketSpend[]> {
	return loadSpendingBetween(
		db,
		householdId,
		`${month.slice(0, 4)}-01-01` as DayKey,
		`${month}-01` as DayKey,
	);
}

/** How many recent uses likelyBucketOrder looks at. */
const USES_LIMIT = 500;

/**
 * Which Buckets spending went into since `since`, newest first, for likelyBucketOrder: whole
 * Transactions and Splits.
 */
export async function loadBucketUses(
	db: Db,
	householdId: string,
	since: DayKey,
): Promise<BucketUse[]> {
	const recent = and(eq(transactions.householdId, householdId), gte(transactions.date, since));
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
			.where(and(recent, eq(splits.householdId, householdId), isNotNull(splits.bucketId)))
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

export type QuickAddResult = { ok: true } | { ok: false; reason: "bucket-not-in-plan" };

/**
 * Records a Quick Add: `amountCents` spent today into a Bucket, For some Members (none for the
 * whole Household). Idempotent per `transactionId`, so a retried or double-tapped Quick Add is
 * recorded once. It is only written if, at write time, the Bucket belongs to the Household and
 * is in the Plan for `date`'s month.
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
				})
				.from(buckets)
				.where(bucketInPlan(input.householdId, input.bucketId, month)),
		)
		.onConflictDoNothing({ target: transactions.id });
	if (input.forMemberIds.length > 0) {
		await db.batch([insertTransaction, insertFor(db, input)]);
	} else {
		await insertTransaction;
	}
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
	return written ? { ok: true } : { ok: false, reason: "bucket-not-in-plan" };
}

/** One of a Transaction's Splits, as the list and the edit sheet show it. */
export type SplitRow = {
	id: string;
	amountCents: Cents;
	/** What it's assigned to: a Bucket or a Commitment. */
	bucketId: string | null;
	commitmentId: string | null;
	for: string[];
};

/** A Transaction as the Transactions list shows it. */
export type TransactionRow = {
	id: string;
	date: DayKey;
	amountCents: Cents;
	/**
	 * What it's assigned to as a whole: a Bucket, a Commitment, or neither while unassigned or
	 * split. A split Transaction is assigned (and For) only through its Splits.
	 */
	bucketId: string | null;
	commitmentId: string | null;
	note: string | null;
	for: string[];
	/** Its Splits in the order they were entered; none unless it's split. */
	splits: SplitRow[];
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
 * or through one Split that is both. Undefined when there's nothing to filter by.
 */
function matching(bucketId?: string, forMember?: string): SQL | undefined {
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
 * One page of a month's Transactions, newest first, optionally only those in a Bucket and only
 * those For a Member (or For the whole Household). `after` continues from a previous page.
 */
export async function loadTransactionsPage(
	db: Db,
	householdId: string,
	query: {
		month: MonthKey;
		bucketId?: string;
		/** A Member's ID, or "everyone" for spending For the whole Household. */
		forMember?: string;
		after?: TransactionCursor;
		limit: number;
	},
): Promise<{ transactions: TransactionRow[]; next: TransactionCursor | null }> {
	const rows = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			amountCents: transactions.amountCents,
			bucketId: transactions.bucketId,
			commitmentId: transactions.commitmentId,
			note: transactions.note,
		})
		.from(transactions)
		.where(
			and(
				eq(transactions.householdId, householdId),
				gte(transactions.date, `${query.month}-01`),
				lt(transactions.date, nextMonthStart(query.month)),
				matching(query.bucketId, query.forMember),
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
						})
						.from(splits)
						.where(and(eq(splits.householdId, householdId), inArray(splits.transactionId, ids)))
						.orderBy(splits.transactionId, splits.position),
					db
						.select({ transactionId: splitFor.splitId, memberId: splitFor.memberId })
						.from(splitFor)
						.innerJoin(splits, eq(splits.id, splitFor.splitId))
						.where(and(eq(splitFor.householdId, householdId), inArray(splits.transactionId, ids))),
				]);
	const forOf = groupFor(forRows);
	const splitForOf = groupFor(splitForRows);
	const splitsOf = new Map<string, SplitRow[]>();
	for (const { transactionId, ...split } of splitRows) {
		splitsOf.set(transactionId, [
			...(splitsOf.get(transactionId) ?? []),
			{ ...split, for: splitForOf.get(split.id) ?? [] },
		]);
	}
	const last = page.at(-1);
	return {
		// Dates are always written as DayKeys.
		transactions: page.map(
			(row) =>
				({
					...row,
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

/** What `assignment` names is the Household's and in the Plan for `month` (a SQL expression). */
const assignable = (householdId: string, assignment: Assignment, month: SQL) =>
	"bucketId" in assignment
		? sql`exists (select 1 from ${buckets} where ${bucketInPlan(householdId, assignment.bucketId, month)})`
		: sql`exists (select 1 from ${commitments} where ${and(
				eq(commitments.id, assignment.commitmentId),
				eq(commitments.householdId, householdId),
				lte(commitments.fromMonth, month),
				or(isNull(commitments.endedFromMonth), sql`${commitments.endedFromMonth} > ${month}`),
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
 * (so any Splits it had are removed). Idempotent: it sets values, so a retry lands the same. The
 * Transaction only changes if, at write time, it is the Household's and what it's assigned to is
 * in the Plan for its month; its For and Splits only change together with it, in the same batch.
 */
export async function updateTransaction(
	db: Db,
	input: {
		householdId: string;
		transactionId: string;
		amountCents: Cents;
		assignment: Assignment;
		note: string | null;
		forMemberIds: string[];
	},
): Promise<TransactionEditResult> {
	const bucketId = "bucketId" in input.assignment ? input.assignment.bucketId : null;
	const commitmentId = "commitmentId" in input.assignment ? input.assignment.commitmentId : null;
	// The month of the Transaction being updated (a correlated reference inside the guards).
	const month = sql`substr(${transactions.date}, 1, 7)`;
	const theTransaction = and(
		eq(transactions.id, input.transactionId),
		eq(transactions.householdId, input.householdId),
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
		.where(and(theTransaction, assignable(input.householdId, input.assignment, month)));
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
	assignment: Assignment;
	forMemberIds: string[];
};

/**
 * Splits a Transaction: sets its amount and note and replaces its whole assignment, its For, and
 * any Splits it had with `splits`, all in one batch. The Splits must add up to the amount.
 * Idempotent by the Splits' client IDs, so a retry lands the same. Nothing changes unless, at
 * write time, the Transaction is the Household's and every Split's Bucket or Commitment is in the
 * Plan for its month; Splits and their For are only written onto that Transaction.
 */
export async function splitTransaction(
	db: Db,
	input: {
		householdId: string;
		transactionId: string;
		amountCents: Cents;
		note: string | null;
		splits: SplitInput[];
	},
): Promise<TransactionEditResult> {
	const { householdId, transactionId } = input;
	if (
		!splitsBalance(
			input.amountCents,
			input.splits.map((split) => ({ amount: split.amountCents })),
		)
	) {
		return { ok: false, reason: "splits-unbalanced" };
	}
	const theTransaction = and(
		eq(transactions.id, transactionId),
		eq(transactions.householdId, householdId),
	);
	const month = sql`(select substr(${transactions.date}, 1, 7) from ${transactions} where ${theTransaction})`;
	const allAssignable = and(
		...input.splits.map((split) => assignable(householdId, split.assignment, month)),
	);
	// True once the Transaction holds the new values as a split one, now or on an earlier try.
	const edited = sql`exists (select 1 from ${transactions} where ${and(
		theTransaction,
		eq(transactions.amountCents, input.amountCents),
		isNull(transactions.bucketId),
		isNull(transactions.commitmentId),
		sql`${transactions.note} is ${input.note}`,
	)})`;
	// Splits are only replaced while every one of them can be assigned.
	const splitNow = and(edited, allAssignable) as SQL;
	const update = db
		.update(transactions)
		.set({ amountCents: input.amountCents, bucketId: null, commitmentId: null, note: input.note })
		.where(and(theTransaction, allAssignable));
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
						bucketId: sql<
							string | null
						>`${"bucketId" in split.assignment ? split.assignment.bucketId : null}`.as("bucket_id"),
						commitmentId: sql<string | null>`${
							"commitmentId" in split.assignment ? split.assignment.commitmentId : null
						}`.as("commitment_id"),
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
		})
		.from(splits)
		.where(
			and(eq(splits.transactionId, transactionId), eq(splits.householdId, householdId), edited),
		);
	// Landed if the Transaction holds exactly these Splits, now or from an earlier try.
	const landed =
		written.length === input.splits.length &&
		input.splits.every((split) =>
			written.some(
				(row) =>
					row.id === split.id &&
					row.amountCents === split.amountCents &&
					row.bucketId === ("bucketId" in split.assignment ? split.assignment.bucketId : null) &&
					row.commitmentId ===
						("commitmentId" in split.assignment ? split.assignment.commitmentId : null),
			),
		);
	return landed ? { ok: true } : { ok: false, reason: "not-in-plan" };
}

/** Deletes a Transaction, its For, and its Splits. Idempotent: deleting it again changes nothing. */
export async function deleteTransaction(
	db: Db,
	input: { householdId: string; transactionId: string },
): Promise<void> {
	await db.batch([
		...clearSplits(db, input.householdId, input.transactionId),
		db
			.delete(transactionFor)
			.where(
				and(
					eq(transactionFor.transactionId, input.transactionId),
					eq(transactionFor.householdId, input.householdId),
				),
			),
		db
			.delete(transactions)
			.where(
				and(
					eq(transactions.id, input.transactionId),
					eq(transactions.householdId, input.householdId),
				),
			),
	]);
}
