import type { AttributedSpend, BucketUse, Cents, DayKey, MonthKey } from "@noodle/domain";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "./index";
import { buckets, commitments, members, transactionFor, transactions } from "./schema";

// Transactions for a Household. Every query is scoped by household_id; IDs from the client are
// only ever used together with it (ADR-0004: rows are appended, never read-modify-written).

/** Spending recorded against a Bucket, with who it was For and the Transaction's ID. */
export type BucketSpend = AttributedSpend & { id: string };

/** Spending assigned to Buckets on days from `from` up to, not including, `until`. */
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
	const [rows, forRows] = await db.batch([
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
	]);
	const forOf = groupFor(forRows);
	// bucket_id is filtered to non-null, and dates are always written as DayKeys.
	return rows.map((row) => ({ ...row, for: forOf.get(row.id) ?? [] }) as BucketSpend);
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

/** Which Buckets spending went into since `since`, newest first, for likelyBucketOrder. */
export async function loadBucketUses(
	db: Db,
	householdId: string,
	since: DayKey,
): Promise<BucketUse[]> {
	const rows = await db
		.select({ bucketId: transactions.bucketId, date: transactions.date })
		.from(transactions)
		.where(
			and(
				eq(transactions.householdId, householdId),
				gte(transactions.date, since),
				isNotNull(transactions.bucketId),
			),
		)
		.orderBy(desc(transactions.date))
		.limit(500);
	return rows as BucketUse[];
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

/** A Transaction as the Transactions list shows it. */
export type TransactionRow = {
	id: string;
	date: DayKey;
	amountCents: Cents;
	/** What it's assigned to as a whole: a Bucket, a Commitment, or neither while unassigned. */
	bucketId: string | null;
	commitmentId: string | null;
	note: string | null;
	for: string[];
};

/** Where a page of the list starts: after this Transaction, going back in time. */
export type TransactionCursor = { date: DayKey; id: string };

/** Transactions with For rows, optionally only those For one Member. */
const hasForRows = (memberId?: string) =>
	sql`exists (select 1 from ${transactionFor} where ${transactionFor.transactionId} = ${transactions.id}${
		memberId ? sql` and ${transactionFor.memberId} = ${memberId}` : sql``
	})`;

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
				query.bucketId ? eq(transactions.bucketId, query.bucketId) : undefined,
				query.forMember === "everyone"
					? sql`not ${hasForRows()}`
					: query.forMember
						? hasForRows(query.forMember)
						: undefined,
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
	const forRows =
		page.length === 0
			? []
			: await db
					.select({
						transactionId: transactionFor.transactionId,
						memberId: transactionFor.memberId,
					})
					.from(transactionFor)
					.where(
						and(
							eq(transactionFor.householdId, householdId),
							inArray(
								transactionFor.transactionId,
								page.map((row) => row.id),
							),
						),
					);
	const forOf = groupFor(forRows);
	const last = page.at(-1);
	return {
		// Dates are always written as DayKeys.
		transactions: page.map((row) => ({ ...row, for: forOf.get(row.id) ?? [] }) as TransactionRow),
		next: rows.length > query.limit && last ? { date: last.date as DayKey, id: last.id } : null,
	};
}

/** A Transaction's assignment: a Bucket or a Commitment, each in the Plan for its month. */
export type Assignment = { bucketId: string } | { commitmentId: string };

export type TransactionEditResult = { ok: true } | { ok: false; reason: "not-in-plan" };

/**
 * Changes a Transaction's amount, assignment, note, and For, all at once. Idempotent: it sets
 * values, so a retry lands the same. The Transaction only changes if, at write time, it is the
 * Household's and what it's assigned to is in the Plan for its month; its For only changes
 * together with it, in the same batch.
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
	const assignable = bucketId
		? sql`exists (select 1 from ${buckets} where ${bucketInPlan(input.householdId, bucketId, month)})`
		: sql`exists (select 1 from ${commitments} where ${and(
				eq(commitments.id, commitmentId ?? ""),
				eq(commitments.householdId, input.householdId),
				lte(commitments.fromMonth, month),
				or(isNull(commitments.endedFromMonth), sql`${commitments.endedFromMonth} > ${month}`),
			)})`;
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
		.where(and(theTransaction, assignable));
	const clearFor = db
		.delete(transactionFor)
		.where(
			and(
				eq(transactionFor.transactionId, input.transactionId),
				eq(transactionFor.householdId, input.householdId),
				edited,
			),
		);
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
		await db.batch([update, clearFor, setFor]);
	} else {
		await db.batch([update, clearFor]);
	}
	const [landed] = await db
		.select({ id: transactions.id })
		.from(transactions)
		.where(and(theTransaction, edited));
	return landed ? { ok: true } : { ok: false, reason: "not-in-plan" };
}

/** Deletes a Transaction and its For. Idempotent: deleting it again changes nothing. */
export async function deleteTransaction(
	db: Db,
	input: { householdId: string; transactionId: string },
): Promise<void> {
	await db.batch([
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
