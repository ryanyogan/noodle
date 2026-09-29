import { type Categorization, type DayKey, merchantKey, type Rule } from "@noodle/domain";
import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { counts } from "./counting";
import type { Db } from "./index";
import { assignableBy, changeableBy, type Viewer } from "./privacy";
import { buckets, categorizations, rules, splits, transactions } from "./schema";

// Categorization's reads and writes. Everything is read for the Parent who imported (the Viewer),
// so the Buckets categorization chooses among are theirs to assign: Household Buckets and their
// own Personal Allowance, never the other Parent's (ADR-0003). Filing is guarded in SQL the same
// way a Parent's edit is, and never overwrites an assignment made in the meantime.

/** An imported Transaction still waiting to be filed. */
export type Uncategorized = { id: string; date: DayKey; amountCents: number; note: string | null };

/**
 * An Import's Transactions nobody has filed or looked at: unassigned, not split, money spent
 * (money back is a payment or a Refund, which counts nowhere), counted (not a Quick Add's Matched
 * bank copy or a Transfer's side), and not categorized before.
 */
export async function loadUncategorized(
	db: Db,
	householdId: string,
	importId: string,
): Promise<Uncategorized[]> {
	const rows = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			amountCents: transactions.amountCents,
			note: transactions.note,
		})
		.from(transactions)
		.leftJoin(categorizations, eq(categorizations.transactionId, transactions.id))
		.where(
			and(
				eq(transactions.householdId, householdId),
				eq(transactions.importId, importId),
				isNull(transactions.bucketId),
				isNull(transactions.commitmentId),
				isNull(transactions.goalId),
				gt(transactions.amountCents, 0),
				isNull(categorizations.transactionId),
				// A Quick Add's bank copy is assigned through its Quick Add; a Transfer's side nowhere.
				counts(),
				sql`not exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`,
			),
		)
		.orderBy(asc(transactions.date), asc(transactions.id));
	return rows as Uncategorized[];
}

/** A Bucket categorization may file into, for the Parent it's done for. */
export type CategorizableBucket = { id: string; name: string; personal: boolean };

/**
 * The Buckets in the Plan at some point from `fromMonth` to `untilMonth` that `memberId` may
 * assign to, in Plan order: never the other Parent's Personal Allowance.
 */
export async function loadCategorizableBuckets(
	db: Db,
	viewer: Viewer,
	fromMonth: string,
	untilMonth: string,
): Promise<CategorizableBucket[]> {
	const rows = await db
		.select({ id: buckets.id, name: buckets.name, owner: buckets.ownerMemberId })
		.from(buckets)
		.where(
			and(
				eq(buckets.householdId, viewer.householdId),
				assignableBy(viewer.memberId),
				lte(buckets.fromMonth, untilMonth),
				or(isNull(buckets.archivedFromMonth), gt(buckets.archivedFromMonth, fromMonth)),
			),
		)
		.orderBy(asc(buckets.position), asc(buckets.id));
	return rows.map(({ owner, ...bucket }) => ({ ...bucket, personal: owner !== null }));
}

/** The Household's Rules. */
export async function loadRules(db: Db, householdId: string): Promise<Rule[]> {
	return db
		.select({ pattern: rules.pattern, bucketId: rules.bucketId })
		.from(rules)
		.where(eq(rules.householdId, householdId));
}

/**
 * States a Rule: statement lines whose merchant contains `pattern` (made a merchantKey) go to
 * `bucketId`, a Bucket of the Household `memberId` may assign to. Replaces the Household's Rule
 * for the same pattern.
 */
export async function saveRule(
	db: Db,
	input: { id: string; householdId: string; memberId: string; pattern: string; bucketId: string },
): Promise<{ ok: boolean }> {
	const pattern = merchantKey(input.pattern);
	const assignable = sql`exists (select 1 from ${buckets} where ${and(
		eq(buckets.id, input.bucketId),
		eq(buckets.householdId, input.householdId),
		assignableBy(input.memberId),
	)})`;
	await db
		.insert(rules)
		.select(
			db
				.select({
					id: sql<string>`${input.id}`.as("id"),
					householdId: sql<string>`${input.householdId}`.as("household_id"),
					pattern: sql<string>`${pattern}`.as("pattern"),
					bucketId: sql<string>`${input.bucketId}`.as("bucket_id"),
					createdByMemberId: sql<string>`${input.memberId}`.as("created_by_member_id"),
					createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
				})
				.from(sql`(select 1)`)
				.where(assignable),
		)
		.onConflictDoUpdate({
			target: [rules.householdId, rules.pattern],
			set: { bucketId: input.bucketId, createdByMemberId: input.memberId },
		});
	const [saved] = await db
		.select({ bucketId: rules.bucketId })
		.from(rules)
		.where(and(eq(rules.householdId, input.householdId), eq(rules.pattern, pattern)));
	return { ok: saved?.bucketId === input.bucketId };
}

/** What categorization decided for one Transaction, and the merchant it decided it for. */
export type CategorizationDecision = {
	transactionId: string;
	merchant: string;
	categorization: Categorization;
};

/**
 * Files the Transactions categorization was sure of and flags the rest for Review, in one atomic
 * batch, for `viewer` (the Parent who imported). A Transaction is only filed while it is still
 * unassigned and unsplit, and into a Bucket in the Plan for its month that `viewer` may assign
 * to; one that can't be is flagged for Review instead. Idempotent: a Transaction is categorized
 * once.
 */
export async function fileCategorizations(
	db: Db,
	viewer: Viewer,
	decisions: CategorizationDecision[],
): Promise<void> {
	if (decisions.length === 0) return;
	const { householdId, memberId } = viewer;
	// One JSON parameter for all of them: D1 caps a statement's bound parameters at 100.
	const rows = JSON.stringify(
		decisions.map(({ transactionId, merchant, categorization }) => ({
			id: transactionId,
			merchant,
			outcome: categorization.outcome,
			method: categorization.outcome === "filed" ? categorization.method : null,
			bucketId: categorization.bucketId,
			confidence: categorization.confidence,
		})),
	);
	const field = (name: string) => sql`json_extract(value, ${`$.${name}`})`;
	const chosen = sql`(select ${field("bucketId")} from json_each(${rows})
		where ${field("id")} = ${transactions.id} and ${field("outcome")} = 'filed')`;
	const month = sql`substr(${transactions.date}, 1, 7)`;
	const intoBucket = sql`exists (select 1 from ${buckets} where ${and(
		sql`${buckets.id} = ${chosen}`,
		eq(buckets.householdId, householdId),
		assignableBy(memberId),
		lte(buckets.fromMonth, month),
		or(isNull(buckets.archivedFromMonth), sql`${buckets.archivedFromMonth} > ${month}`),
	)})`;
	const filedAsDecided = sql`exists (select 1 from ${transactions} where ${transactions.id} = ${field("id")}
		and ${transactions.bucketId} = ${field("bucketId")})`;
	await db.batch([
		db
			.update(transactions)
			.set({ bucketId: chosen })
			.where(
				and(
					changeableBy(viewer),
					isNull(transactions.bucketId),
					isNull(transactions.commitmentId),
					isNull(transactions.goalId),
					sql`not exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`,
					intoBucket,
				),
			),
		db
			.insert(categorizations)
			.select(
				db
					.select({
						// Selected in the table's column order: insert … select is positional.
						transactionId: sql<string>`${field("id")}`.as("transaction_id"),
						householdId: sql<string>`${householdId}`.as("household_id"),
						memberId: sql<string>`${memberId}`.as("member_id"),
						outcome: sql<"filed" | "review">`case when ${field("outcome")} = 'filed'
							and ${filedAsDecided} then 'filed' else 'review' end`.as("outcome"),
						method: sql<string | null>`case when ${filedAsDecided} then ${field("method")} end`.as(
							"method",
						),
						bucketId: sql<string | null>`${field("bucketId")}`.as("bucket_id"),
						confidence: sql<number | null>`${field("confidence")}`.as("confidence"),
						merchant: sql<string>`${field("merchant")}`.as("merchant"),
						createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
					})
					.from(sql`json_each(${rows})`)
					.where(
						sql`exists (select 1 from ${transactions} where ${transactions.id} = ${field("id")}
							and ${transactions.householdId} = ${householdId})`,
					),
			)
			.onConflictDoNothing(),
	]);
}

/**
 * What a Parent's assignment of an imported Transaction teaches: its merchant (as categorized,
 * else from its note) and the Bucket it's now in. Null unless it's an imported Transaction
 * `viewer` may change, assigned to a Bucket as a whole.
 */
export async function loadCorrection(
	db: Db,
	viewer: Viewer,
	transactionId: string,
): Promise<{ merchant: string; bucketId: string } | null> {
	const [row] = await db
		.select({
			source: transactions.source,
			note: transactions.note,
			bucketId: transactions.bucketId,
			merchant: categorizations.merchant,
		})
		.from(transactions)
		.leftJoin(categorizations, eq(categorizations.transactionId, transactions.id))
		.where(and(eq(transactions.id, transactionId), changeableBy(viewer)));
	if (row?.source !== "import" || !row.bucketId) return null;
	const merchant = row.merchant ?? (row.note ? merchantKey(row.note) : null);
	return merchant ? { merchant, bucketId: row.bucketId } : null;
}

/** A Parent has decided a Transaction's assignment: it's no longer categorization's, nor in Review. */
export async function settleCategorization(
	db: Db,
	householdId: string,
	transactionId: string,
): Promise<void> {
	await db
		.delete(categorizations)
		.where(
			and(
				eq(categorizations.transactionId, transactionId),
				eq(categorizations.householdId, householdId),
			),
		);
}
