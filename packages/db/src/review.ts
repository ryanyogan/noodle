import type { DayKey } from "@noodle/domain";
import { and, asc, count, eq, isNull, type SQL, sql } from "drizzle-orm";
import { counts } from "./counting";
import type { Db } from "./index";
import { changeableBy, type Viewer, visibleTo } from "./privacy";
import {
	accounts,
	buckets,
	categorizations,
	splitFor,
	splits,
	transactionFor,
	transactions,
} from "./schema";
import type { TransactionRow } from "./transactions";

// Review: the Transactions categorization wasn't sure of, waiting for a Parent to confirm its guess
// or say otherwise. A Transaction waits in Review while its categorization says so and it's still
// unassigned as a whole: unsplit, in no Bucket, Commitment or Goal. Either Parent may clear it
// (it's in nobody's Personal Allowance while unassigned), and a guess is never a Personal
// Allowance (categorize-run leaves those out), so nothing private reaches the other Parent.

/** A Transaction waiting in Review, as a card shows it. */
export type ReviewItem = TransactionRow & {
	/** The merchant its statement line names (a merchantKey): what a Rule for it would match. */
	merchant: string;
	/** Categorization's best guess, and how sure it was (0–1); null when it had none. */
	guess: { bucketId: string; name: string; confidence: number | null } | null;
};

export type ReviewQueue = {
	/** The oldest first, at most `limit` of them. */
	items: ReviewItem[];
	/** How many wait in all. */
	total: number;
};

/** The enclosing query's Transaction waits in Review for `viewer`. */
const waiting = (viewer: Viewer) =>
	and(
		eq(categorizations.householdId, viewer.householdId),
		eq(categorizations.outcome, "review"),
		visibleTo(viewer),
		isNull(transactions.bucketId),
		isNull(transactions.commitmentId),
		isNull(transactions.goalId),
		// A Quick Add's bank copy is filed through its Quick Add; a Transfer's side nowhere.
		counts(),
		sql`not exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`,
	) as SQL;

/** What waits in Review for `viewer`: the oldest `limit` Transactions, and how many in all. */
export async function loadReview(db: Db, viewer: Viewer, limit: number): Promise<ReviewQueue> {
	const [rows, [total]] = await Promise.all([
		db
			.select({
				id: transactions.id,
				date: transactions.date,
				amountCents: transactions.amountCents,
				note: transactions.note,
				source: transactions.source,
				account: accounts.name,
				merchant: categorizations.merchant,
				guessId: buckets.id,
				guessName: buckets.name,
				confidence: categorizations.confidence,
			})
			.from(categorizations)
			.innerJoin(transactions, eq(transactions.id, categorizations.transactionId))
			.leftJoin(accounts, eq(accounts.id, transactions.accountId))
			// Never another Parent's Personal Allowance as a guess, whatever was kept.
			.leftJoin(
				buckets,
				and(
					eq(buckets.id, categorizations.bucketId),
					eq(buckets.householdId, viewer.householdId),
					isNull(buckets.ownerMemberId),
				),
			)
			.where(waiting(viewer))
			.orderBy(asc(transactions.date), asc(transactions.id))
			.limit(limit),
		db
			.select({ count: count() })
			.from(categorizations)
			.innerJoin(transactions, eq(transactions.id, categorizations.transactionId))
			.where(waiting(viewer)),
	]);
	const ids = rows.map((row) => row.id);
	const forRows =
		ids.length === 0
			? []
			: await db
					.select({
						transactionId: transactionFor.transactionId,
						memberId: transactionFor.memberId,
					})
					.from(transactionFor)
					.where(
						and(
							eq(transactionFor.householdId, viewer.householdId),
							sql`${transactionFor.transactionId} in (select value from json_each(${JSON.stringify(ids)}))`,
						),
					);
	return {
		total: total?.count ?? 0,
		items: rows.map((row) => ({
			id: row.id,
			date: row.date as DayKey,
			amountCents: row.amountCents,
			bucketId: null,
			commitmentId: null,
			goal: null,
			note: row.note,
			importedFrom: row.source === "import" ? row.account : null,
			matchedIn: null,
			transfer: null,
			refundOf: null,
			for: forRows
				.filter((f) => f.transactionId === row.id)
				.map((f) => f.memberId)
				.sort(),
			splits: [],
			partlyPrivate: false,
			autoFiled: null,
			merchant: row.merchant,
			guess:
				row.guessId && row.guessName
					? { bucketId: row.guessId, name: row.guessName, confidence: row.confidence }
					: null,
		})),
	};
}

/**
 * Puts a Transaction a Parent just decided back in Review (their undo): unassigned as a whole,
 * without Splits, For `forMemberIds` again, with categorization's guess as it was. Only one
 * `viewer` may change (changeableBy), not a Goal's spending, and only a Household Bucket as the
 * guess. Idempotent.
 */
export async function returnToReview(
	db: Db,
	viewer: Viewer,
	input: {
		transactionId: string;
		merchant: string;
		guess: { bucketId: string; confidence: number | null } | null;
		forMemberIds: string[];
	},
): Promise<void> {
	const { householdId } = viewer;
	const { transactionId } = input;
	const theirs = sql`exists (select 1 from ${transactions} where ${and(
		eq(transactions.id, transactionId),
		changeableBy(viewer),
		isNull(transactions.goalId),
	)})`;
	const guess = input.guess
		? sql`(select ${buckets.id} from ${buckets} where ${buckets.id} = ${input.guess.bucketId}
			and ${buckets.householdId} = ${householdId} and ${buckets.ownerMemberId} is null)`
		: sql`null`;
	const confidence = input.guess?.confidence ?? null;
	const ownSplits = sql`(select ${splits.id} from ${splits} where ${splits.transactionId} = ${transactionId})`;
	await db.batch([
		db.delete(splitFor).where(and(sql`${splitFor.splitId} in ${ownSplits}`, theirs)),
		db.delete(splits).where(and(eq(splits.transactionId, transactionId), theirs)),
		db.delete(transactionFor).where(and(eq(transactionFor.transactionId, transactionId), theirs)),
		db
			.insert(transactionFor)
			.select(
				db
					.select({
						transactionId: sql<string>`${transactionId}`.as("transaction_id"),
						memberId: sql<string>`value`.as("member_id"),
						householdId: sql<string>`${householdId}`.as("household_id"),
					})
					.from(sql`json_each(${JSON.stringify(input.forMemberIds)})`)
					.where(
						sql`${theirs} and exists (select 1 from members where members.id = value
							and members.household_id = ${householdId})`,
					),
			)
			.onConflictDoNothing(),
		db
			.update(transactions)
			.set({ bucketId: null, commitmentId: null })
			.where(
				and(eq(transactions.id, transactionId), changeableBy(viewer), isNull(transactions.goalId)),
			),
		db
			.insert(categorizations)
			.select(
				db
					.select({
						// Selected in the table's column order: insert … select is positional.
						transactionId: sql<string>`${transactionId}`.as("transaction_id"),
						householdId: sql<string>`${householdId}`.as("household_id"),
						memberId: sql<string>`${viewer.memberId}`.as("member_id"),
						outcome: sql<"review">`'review'`.as("outcome"),
						method: sql<null>`null`.as("method"),
						bucketId: sql<string | null>`${guess}`.as("bucket_id"),
						confidence: sql<number | null>`${confidence}`.as("confidence"),
						merchant: sql<string>`${input.merchant}`.as("merchant"),
						createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
					})
					.from(sql`(select 1)`)
					.where(theirs),
			)
			.onConflictDoUpdate({
				target: categorizations.transactionId,
				set: {
					outcome: sql`'review'`,
					method: sql`null`,
					bucketId: sql`excluded.bucket_id`,
					confidence: sql`excluded.confidence`,
				},
			}),
	]);
}
