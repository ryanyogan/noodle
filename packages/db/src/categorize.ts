import { type Categorization, type DayKey, merchantKey } from "@noodle/domain";
import { and, asc, eq, gt, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { counts } from "./counting";
import { purchaseMayMove } from "./ended-months";
import type { Db } from "./index";
import { applyOwedBackRules } from "./owed-back-rules";
import { assignableBy, changeableBy, type Viewer } from "./privacy";
import {
	buckets,
	categorizations,
	commitments,
	members,
	rules,
	splits,
	transactionFor,
	transactions,
} from "./schema";

// Categorization's reads and writes. Everything is read for the Parent who imported (the Viewer),
// so the Buckets categorization chooses among are theirs to assign: Household Buckets and their
// own Personal Allowance, never the other Parent's (ADR-0003). Filing is guarded in SQL the same
// way a Parent's edit is, and never overwrites an assignment made in the meantime.

/** A Transaction (imported, or a captured Quick Add) still waiting to be filed. */
export type Uncategorized = {
	id: string;
	date: DayKey;
	amountCents: number;
	note: string | null;
	/** Its merchant's clean name, once named (merchant-run.ts). */
	merchant?: string | null;
};

/**
 * An Import's Transactions nobody has filed or looked at: unassigned, not split, money spent
 * (money back is a payment or a Refund, which counts nowhere), counted (not a Quick Add's Matched
 * bank copy or a Transfer's side), and not categorized before.
 */
export function loadUncategorized(
	db: Db,
	householdId: string,
	importId: string,
): Promise<Uncategorized[]> {
	return uncategorized(db, householdId, eq(transactions.importId, importId));
}

/** One Transaction, by the same test: a single row when it's still waiting to be filed. */
export function loadUncategorizedTransaction(
	db: Db,
	householdId: string,
	transactionId: string,
): Promise<Uncategorized[]> {
	return uncategorized(db, householdId, eq(transactions.id, transactionId));
}

async function uncategorized(db: Db, householdId: string, which: SQL): Promise<Uncategorized[]> {
	const rows = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			amountCents: transactions.amountCents,
			note: transactions.note,
			merchant: transactions.merchant,
		})
		.from(transactions)
		.leftJoin(categorizations, eq(categorizations.transactionId, transactions.id))
		.where(
			and(
				eq(transactions.householdId, householdId),
				which,
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

/** What categorization decided for one Transaction, and the merchant it decided it for. */
export type CategorizationDecision = {
	transactionId: string;
	merchant: string;
	categorization: Categorization;
	/** The Rule that filed it, if one did: it counts the Transaction as one it matched. */
	ruleId?: string;
};

/**
 * Files the Transactions categorization was sure of and flags the rest for Review, in one atomic
 * batch, for `viewer` (the Parent who imported). A Transaction is only filed while it is still
 * unassigned and unsplit, and into a Bucket in the Plan for its month that `viewer` may assign
 * to; one that can't be is flagged for Review instead. A Rule's For lands with it, unless it's
 * already For someone. Idempotent: a Transaction is categorized once, though one waiting in
 * Review can still be filed (a Rule applied to what's unassigned) or given a new guess (looked at
 * again once the Plan has changed).
 */
export async function fileCategorizations(
	db: Db,
	viewer: Viewer,
	decisions: CategorizationDecision[],
	/** The Household's day; UTC's when left out. */
	today?: DayKey,
): Promise<void> {
	if (decisions.length === 0) return;
	const batch: BatchItem<"sqlite">[] = [];
	for (let i = 0; i < decisions.length; i += FILED_PER_STATEMENT)
		batch.push(...filingStatements(db, viewer, decisions.slice(i, i + FILED_PER_STATEMENT), today));
	await db.batch(batch as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
	// A Rule that remembers who pays part back says it on what it just filed (ADR-0058).
	await applyOwedBackRules(db, viewer, decisions);
}

/**
 * How many decisions one statement carries. They travel as one JSON value, and D1 caps a bound
 * value at 2 MB: a decision is some 200 bytes, more with a long reason, so a thousand stay well
 * under it however many a Rule files at once (issue 88).
 */
export const FILED_PER_STATEMENT = 1_000;

/**
 * The statements that file one lot of decisions, in the order they must run: a lot's own
 * categorizations are written last, since "newly filed" is read from their absence.
 */
function filingStatements(
	db: Db,
	viewer: Viewer,
	decisions: CategorizationDecision[],
	today?: DayKey,
): BatchItem<"sqlite">[] {
	const { householdId, memberId } = viewer;
	// One JSON parameter for all of them: D1 caps a statement's bound parameters at 100.
	const rows = JSON.stringify(
		decisions.map(({ transactionId, merchant, categorization, ruleId }) => ({
			id: transactionId,
			merchant,
			outcome: categorization.outcome,
			method: categorization.method,
			reason: categorization.reason ?? null,
			bucketId: categorization.bucketId,
			commitmentId:
				categorization.outcome === "filed" ? (categorization.commitmentId ?? null) : null,
			confidence: categorization.confidence,
			for: categorization.outcome === "filed" ? (categorization.for ?? []) : [],
			rule: ruleId ?? null,
		})),
	);
	const field = (name: string) => sql`json_extract(value, ${`$.${name}`})`;
	// The Transactions bound for one Bucket (or Commitment), as a JSON list of IDs. Each update
	// names its target outright and finds its Transactions in that list, which SQLite reads once.
	// Looking every unassigned Transaction's decision up in the JSON instead made the work grow
	// with the square of how many were filed: a Rule over 4,000 took a minute (issue 88).
	const bound = (target: "bucketId" | "commitmentId") => {
		const ids = new Map<string, string[]>();
		for (const { transactionId, categorization } of decisions) {
			const to = categorization.outcome === "filed" ? categorization[target] : null;
			if (to) ids.set(to, [...(ids.get(to) ?? []), transactionId]);
		}
		return [...ids].map(([to, list]) => ({
			to,
			among: sql`${transactions.id} in (select value from json_each(${JSON.stringify(list)}))`,
		}));
	};
	const month = sql`substr(${transactions.date}, 1, 7)`;
	const intoBucket = (bucketId: string) =>
		sql`exists (select 1 from ${buckets} where ${and(
			eq(buckets.id, bucketId),
			eq(buckets.householdId, householdId),
			assignableBy(memberId),
			lte(buckets.fromMonth, month),
			or(isNull(buckets.archivedFromMonth), sql`${buckets.archivedFromMonth} > ${month}`),
		)})`;
	// A Rule's Commitment (ADR-0030): one of the Household's, in the Plan for that month.
	const intoCommitment = (commitmentId: string) =>
		sql`exists (select 1 from ${commitments} where ${and(
			eq(commitments.id, commitmentId),
			eq(commitments.householdId, householdId),
			lte(commitments.fromMonth, month),
			or(isNull(commitments.endedFromMonth), sql`${commitments.endedFromMonth} > ${month}`),
		)})`;
	const filedAsDecided = sql`exists (select 1 from ${transactions} where ${transactions.id} = ${field("id")}
		and (${transactions.bucketId} = ${field("bucketId")} or ${transactions.commitmentId} = ${field("commitmentId")}))`;
	// Filed by this batch: in its Bucket (or Commitment) now, and not categorized as filed before.
	const newlyFiled = (
		id: SQL,
		bucketId: SQL,
		commitmentId: SQL,
	) => sql`exists (select 1 from ${transactions}
		where ${transactions.id} = ${id} and (${transactions.bucketId} = ${bucketId}
			or ${transactions.commitmentId} = ${commitmentId}))
		and not exists (select 1 from ${categorizations} where ${categorizations.transactionId} = ${id}
		and ${categorizations.outcome} = 'filed')`;
	const byRule = decisions.some((decision) => decision.ruleId);
	const withFor = decisions.some(
		({ categorization }) => categorization.outcome === "filed" && categorization.for?.length,
	);
	const unassigned = and(
		changeableBy(viewer),
		isNull(transactions.bucketId),
		isNull(transactions.commitmentId),
		isNull(transactions.goalId),
		sql`not exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`,
		// Money back on it counted in a month that has ended: it stays unassigned (ADR-0058).
		purchaseMayMove(today),
	);
	// Buckets first: a decision naming both lands in its Bucket, and in its Commitment only when
	// the Bucket wouldn't take it.
	const batch: BatchItem<"sqlite">[] = [
		...bound("bucketId").map(({ to, among }) =>
			db
				.update(transactions)
				.set({ bucketId: to, version: sql`${transactions.version} + 1` })
				.where(and(among, unassigned, intoBucket(to))),
		),
		...bound("commitmentId").map(({ to, among }) =>
			db
				.update(transactions)
				.set({ commitmentId: to, version: sql`${transactions.version} + 1` })
				.where(and(among, unassigned, intoCommitment(to))),
		),
	];
	if (withFor) {
		// A Rule's For, for what it just filed that isn't For anyone yet (ADR-0011).
		const id = sql`json_extract(r.value, '$.id')`;
		batch.push(
			db
				.insert(transactionFor)
				.select(
					db
						.select({
							transactionId: sql<string>`${id}`.as("transaction_id"),
							memberId: sql<string>`f.value`.as("member_id"),
							householdId: sql<string>`${householdId}`.as("household_id"),
						})
						.from(sql`json_each(${rows}) r, json_each(r.value, '$.for') f`)
						.where(
							sql`json_extract(r.value, '$.outcome') = 'filed'
								and ${newlyFiled(id, sql`json_extract(r.value, '$.bucketId')`, sql`json_extract(r.value, '$.commitmentId')`)}
								and not exists (select 1 from ${transactionFor} x where x.transaction_id = ${id})
								and exists (select 1 from ${members} where ${members.id} = f.value
									and ${members.householdId} = ${householdId})`,
						),
				)
				.onConflictDoNothing(),
		);
	}
	if (byRule) {
		batch.push(
			db
				.update(rules)
				.set({
					matchedCount: sql`${rules.matchedCount} + (select count(*) from json_each(${rows})
						where ${field("rule")} = ${rules.id} and ${field("outcome")} = 'filed'
						and ${newlyFiled(field("id"), field("bucketId"), field("commitmentId"))})`,
				})
				.where(
					and(
						eq(rules.householdId, householdId),
						sql`${rules.id} in (select ${field("rule")} from json_each(${rows}))`,
					),
				),
		);
	}
	batch.push(
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
						method: sql<string | null>`${field("method")}`.as("method"),
						bucketId: sql<string | null>`${field("bucketId")}`.as("bucket_id"),
						confidence: sql<number | null>`${field("confidence")}`.as("confidence"),
						merchant: sql<string>`${field("merchant")}`.as("merchant"),
						createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
						reason: sql<string | null>`${field("reason")}`.as("reason"),
						commitmentId: sql<string | null>`${field("commitmentId")}`.as("commitment_id"),
						returnedAt: sql<Date | null>`null`.as("returned_at"),
					})
					.from(sql`json_each(${rows})`)
					.where(
						sql`exists (select 1 from ${transactions} where ${transactions.id} = ${field("id")}
							and ${transactions.householdId} = ${householdId})`,
					),
			)
			.onConflictDoUpdate({
				target: categorizations.transactionId,
				// Only one that waits in Review: filed now, or looked at again (refileReview) with a new
				// guess. Anything filed was categorized once already.
				set: {
					memberId: sql`excluded.member_id`,
					outcome: sql`excluded.outcome`,
					method: sql`excluded.method`,
					bucketId: sql`excluded.bucket_id`,
					confidence: sql`excluded.confidence`,
					reason: sql`excluded.reason`,
					commitmentId: sql`excluded.commitment_id`,
					// Filed, it's no longer a card a Parent put back; with only a new guess it still is.
					returnedAt: sql`case when excluded.outcome = 'filed' then null
						else ${categorizations.returnedAt} end`,
				},
				setWhere: sql`${categorizations.outcome} = 'review'`,
			}),
	);
	return batch;
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
			cleanName: transactions.merchant,
		})
		.from(transactions)
		.leftJoin(categorizations, eq(categorizations.transactionId, transactions.id))
		.where(and(eq(transactions.id, transactionId), changeableBy(viewer)));
	if (row?.source !== "import" || !row.bucketId) return null;
	// By the clean name once it's named, as categorization looks merchants up (ADR-0027).
	const merchant =
		(row.cleanName ? merchantKey(row.cleanName) : null) ||
		row.merchant ||
		(row.note ? merchantKey(row.note) : null);
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
