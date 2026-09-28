import type { BucketUse, Cents, DayKey, MonthKey, Spend } from "@noodle/domain";
import { and, desc, eq, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "./index";
import { buckets, transactions } from "./schema";

// Transactions for a Household. Every query is scoped by household_id; IDs from the client are
// only ever used together with it (ADR-0004: rows are appended, never read-modify-written).

/** Spending recorded against a Bucket, with the Transaction's ID. */
export type BucketSpend = Spend & { id: string };

/** The month's spending assigned to Buckets. */
export async function loadSpending(
	db: Db,
	householdId: string,
	month: MonthKey,
): Promise<BucketSpend[]> {
	const rows = await db
		.select({
			id: transactions.id,
			bucketId: transactions.bucketId,
			amount: transactions.amountCents,
			date: transactions.date,
		})
		.from(transactions)
		.where(
			and(
				eq(transactions.householdId, householdId),
				gte(transactions.date, `${month}-01`),
				lte(transactions.date, `${month}-31`),
				isNotNull(transactions.bucketId),
			),
		);
	// bucket_id is filtered to non-null, and dates are always written as DayKeys.
	return rows as BucketSpend[];
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

export type QuickAddResult = { ok: true } | { ok: false; reason: "bucket-not-in-plan" };

/**
 * Records a Quick Add: `amountCents` spent today into a Bucket. Idempotent per `transactionId`,
 * so a retried or double-tapped Quick Add is recorded once. It is only written if, at write
 * time, the Bucket belongs to the Household and is in the Plan for `date`'s month.
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
		createdByMemberId: string;
	},
): Promise<QuickAddResult> {
	const month = input.date.slice(0, 7);
	await db
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
				})
				.from(buckets)
				.where(
					and(
						eq(buckets.id, input.bucketId),
						eq(buckets.householdId, input.householdId),
						lte(buckets.fromMonth, month),
						or(isNull(buckets.archivedFromMonth), sql`${buckets.archivedFromMonth} > ${month}`),
					),
				),
		)
		.onConflictDoNothing({ target: transactions.id });
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
