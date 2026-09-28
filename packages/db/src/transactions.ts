import type { AttributedSpend, BucketUse, Cents, DayKey, MonthKey } from "@noodle/domain";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "./index";
import { buckets, members, transactionFor, transactions } from "./schema";

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
