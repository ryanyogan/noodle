import type { DayKey, GuessMethod, MonthKey } from "@noodle/domain";
import { and, asc, count, eq, gt, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import { accountLabelSql } from "./account-label";
import type { Uncategorized } from "./categorize";
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
import type { TransactionRow, TransactionWriteResult } from "./transactions";

// Review: the Transactions categorization wasn't sure of, waiting for a Parent to confirm its guess
// or say otherwise. A Transaction waits in Review while its categorization says so and it's still
// unassigned as a whole: unsplit, in no Bucket, Commitment or Goal. Either Parent may clear it
// (it's in nobody's Personal Allowance while unassigned). A guess may be the importing Parent's
// own Personal Allowance, but it's only ever shown to them: to the other Parent the card has no
// guess, so nothing private reaches them (ADR-0003, ADR-0021).

/** A Transaction waiting in Review, as a card shows it. */
export type ReviewItem = TransactionRow & {
	/** The merchant its statement line names (a merchantKey): what a Rule for it would match. */
	merchant: string;
	/**
	 * Categorization's best guess, how sure it was (0–1), where it came from, and why (the merchant
	 * filed before it was like, or the model's few words); null when it had none.
	 */
	guess: {
		bucketId: string;
		name: string;
		confidence: number | null;
		method: GuessMethod | null;
		reason: string | null;
	} | null;
	/** "none" when categorization looked and found nothing; null when it isn't known. */
	lookedAt: GuessMethod | null;
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

/** The month of the enclosing query's Transaction, as a MonthKey. */
const monthOfTransaction = sql<string>`substr(${transactions.date}, 1, 7)`;

/** What waits in Review for `viewer`: the oldest `limit` Transactions, and how many in all. */
export async function loadReview(db: Db, viewer: Viewer, limit: number): Promise<ReviewQueue> {
	const [rows, [total]] = await Promise.all([
		db
			.select({
				version: transactions.version,
				id: transactions.id,
				date: transactions.date,
				amountCents: transactions.amountCents,
				note: transactions.note,
				source: transactions.source,
				pending: transactions.pending,
				account: accountLabelSql,
				merchant: categorizations.merchant,
				merchantName: transactions.merchant,
				guessId: buckets.id,
				guessName: buckets.name,
				confidence: categorizations.confidence,
				method: categorizations.method,
				reason: categorizations.reason,
			})
			.from(categorizations)
			.innerJoin(transactions, eq(transactions.id, categorizations.transactionId))
			.leftJoin(accounts, eq(accounts.id, transactions.accountId))
			// Never another Parent's Personal Allowance as a guess, whatever was kept. Nor a Bucket
			// that isn't in the Plan of the Transaction's own month (one added since, or archived by
			// then): it can't be filed there, so Confirm on such a guess was refused every time.
			.leftJoin(
				buckets,
				and(
					eq(buckets.id, categorizations.bucketId),
					eq(buckets.householdId, viewer.householdId),
					or(isNull(buckets.ownerMemberId), eq(buckets.ownerMemberId, viewer.memberId)),
					lte(buckets.fromMonth, monthOfTransaction),
					or(isNull(buckets.archivedFromMonth), gt(buckets.archivedFromMonth, monthOfTransaction)),
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
			pending: row.pending,
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
			version: row.version,
			merchant: row.merchant,
			merchantName: row.merchantName,
			guess:
				row.guessId && row.guessName
					? {
							bucketId: row.guessId,
							name: row.guessName,
							confidence: row.confidence,
							method: row.method,
							reason: row.reason,
						}
					: null,
			// A guess hidden from this Parent reads as none.
			lookedAt: row.guessId ? row.method : row.method === null ? null : "none",
		})),
	};
}

/** At most how many Review rows one look again takes: 20 of the model's prompts. */
const LOOK_AGAIN_ROWS = 200;

/**
 * What waits in Review that `viewer` imported, oldest first: what categorization looks at again
 * for them once the Plan has changed. The other Parent's are theirs to look at again, with their
 * Rules and Personal Allowance.
 */
export async function loadReviewToLookAgain(db: Db, viewer: Viewer): Promise<Uncategorized[]> {
	const rows = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			amountCents: transactions.amountCents,
			note: transactions.note,
			merchant: transactions.merchant,
		})
		.from(categorizations)
		.innerJoin(transactions, eq(transactions.id, categorizations.transactionId))
		.where(and(waiting(viewer), eq(categorizations.memberId, viewer.memberId)))
		.orderBy(asc(transactions.date), asc(transactions.id))
		.limit(LOOK_AGAIN_ROWS);
	return rows as Uncategorized[];
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
		guess: {
			bucketId: string;
			confidence: number | null;
			method?: GuessMethod | null;
			reason?: string | null;
		} | null;
		forMemberIds: string[];
		/** The version the Parent last had of it: left alone if it has moved on (ADR-0041). */
		expectedVersion?: number;
	},
): Promise<TransactionWriteResult> {
	const { householdId } = viewer;
	const { transactionId } = input;
	const asExpected =
		input.expectedVersion === undefined
			? undefined
			: eq(transactions.version, input.expectedVersion);
	const theirs = sql`exists (select 1 from ${transactions} where ${and(
		eq(transactions.id, transactionId),
		changeableBy(viewer),
		isNull(transactions.goalId),
		asExpected,
	)})`;
	const guess = input.guess
		? sql`(select ${buckets.id} from ${buckets} where ${buckets.id} = ${input.guess.bucketId}
			and ${buckets.householdId} = ${householdId} and ${buckets.ownerMemberId} is null)`
		: sql`null`;
	const confidence = input.guess?.confidence ?? null;
	const method = input.guess?.method ?? null;
	const reason = input.guess?.reason ?? null;
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
			.insert(categorizations)
			.select(
				db
					.select({
						// Selected in the table's column order: insert … select is positional.
						transactionId: sql<string>`${transactionId}`.as("transaction_id"),
						householdId: sql<string>`${householdId}`.as("household_id"),
						memberId: sql<string>`${viewer.memberId}`.as("member_id"),
						outcome: sql<"review">`'review'`.as("outcome"),
						method: sql<string | null>`${method}`.as("method"),
						bucketId: sql<string | null>`${guess}`.as("bucket_id"),
						confidence: sql<number | null>`${confidence}`.as("confidence"),
						merchant: sql<string>`${input.merchant}`.as("merchant"),
						createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
						reason: sql<string | null>`${reason}`.as("reason"),
						commitmentId: sql<string | null>`null`.as("commitment_id"),
					})
					.from(sql`(select 1)`)
					.where(theirs),
			)
			.onConflictDoUpdate({
				target: categorizations.transactionId,
				set: {
					outcome: sql`'review'`,
					method: sql`excluded.method`,
					bucketId: sql`excluded.bucket_id`,
					commitmentId: sql`null`,
					confidence: sql`excluded.confidence`,
					reason: sql`excluded.reason`,
				},
			}),
		// Last: every write before it is guarded by the version this one moves on from.
		db
			.update(transactions)
			.set({ bucketId: null, commitmentId: null, version: sql`${transactions.version} + 1` })
			.where(
				and(
					eq(transactions.id, transactionId),
					changeableBy(viewer),
					isNull(transactions.goalId),
					asExpected,
				),
			),
	]);
	const [row] = await db
		.select({
			version: transactions.version,
			waits: sql<number>`${transactions.bucketId} is null and ${transactions.commitmentId} is null
				and exists (select 1 from ${categorizations} where ${categorizations.transactionId} = ${transactions.id}
				and ${categorizations.outcome} = 'review')`,
		})
		.from(transactions)
		.where(and(eq(transactions.id, transactionId), eq(transactions.householdId, householdId)));
	if (input.expectedVersion === undefined) return { ok: true, version: row?.version ?? null };
	if (!row) return { ok: false, reason: "changed-elsewhere" };
	// One on and waiting in Review: it landed, now or on an earlier try. Unmoved: it wasn't theirs
	// to change, as before. Anything else was changed on another screen first, and is left alone.
	const landed = row.version === input.expectedVersion + 1 && Boolean(row.waits);
	return landed || row.version === input.expectedVersion
		? { ok: true, version: row.version }
		: { ok: false, reason: "changed-elsewhere" };
}

/**
 * Files Transactions waiting in Review without a Bucket (ADR-0037): each leaves Review and stays
 * unassigned, as it was while it waited, so no month's figures change, a closed month's included.
 * Only what waits for `viewer`; anything else is left alone. Idempotent. Returns the IDs it filed.
 */
export async function fileWithoutBucket(
	db: Db,
	viewer: Viewer,
	transactionIds: string[],
): Promise<{ filed: string[]; versions: Record<string, number> }> {
	if (transactionIds.length === 0) return { filed: [], versions: {} };
	const asked = sql`(select value from json_each(${JSON.stringify(transactionIds)}))`;
	// Read first, then deleted by ID: `waiting` reads the Transaction beside its categorization.
	const rows = await db
		.select({ id: transactions.id })
		.from(categorizations)
		.innerJoin(transactions, eq(transactions.id, categorizations.transactionId))
		.where(and(waiting(viewer), sql`${transactions.id} in ${asked}`));
	const filed = rows.map((row) => row.id);
	if (filed.length === 0) return { filed, versions: {} };
	const theFiled = sql`(select value from json_each(${JSON.stringify(filed)}))`;
	const ofTheFiled = and(
		eq(transactions.householdId, viewer.householdId),
		sql`${transactions.id} in ${theFiled}`,
	);
	await db.batch([
		// It left Review: a decision made on another screen's card for it is refused (ADR-0041).
		db
			.update(transactions)
			.set({ version: sql`${transactions.version} + 1` })
			.where(
				and(
					ofTheFiled,
					sql`exists (select 1 from ${categorizations} where ${categorizations.transactionId} = ${transactions.id}
						and ${categorizations.outcome} = 'review')`,
				),
			),
		db
			.delete(categorizations)
			.where(
				and(
					eq(categorizations.householdId, viewer.householdId),
					eq(categorizations.outcome, "review"),
					sql`${categorizations.transactionId} in ${theFiled}`,
				),
			),
	]);
	const after = await db
		.select({ id: transactions.id, version: transactions.version })
		.from(transactions)
		.where(ofTheFiled);
	return { filed, versions: Object.fromEntries(after.map((row) => [row.id, row.version])) };
}

/** How many of the Household's Transactions dated in `month` categorization filed on its own. */
export async function countFiledOnItsOwn(
	db: Db,
	householdId: string,
	month: MonthKey,
): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(categorizations)
		.innerJoin(transactions, eq(transactions.id, categorizations.transactionId))
		.where(
			and(
				eq(categorizations.householdId, householdId),
				eq(categorizations.outcome, "filed"),
				sql`${transactions.date} like ${`${month}-%`}`,
			),
		);
	return row?.count ?? 0;
}
