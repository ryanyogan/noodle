import {
	type DayKey,
	type For,
	type GuessMethod,
	likelyFor,
	type MonthKey,
	ruleKeys,
} from "@noodle/domain";
import { and, asc, count, desc, eq, gt, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import { accountLabelSql } from "./account-label";
import type { Uncategorized } from "./categorize";
import { counts } from "./counting";
import { purchaseMayMove } from "./ended-months";
import type { Db } from "./index";
import { owedBackOffGoneSplits } from "./owed-back";
import { changeableBy, type Viewer, visibleTo } from "./privacy";
import { reviewCleared } from "./review-cleared";
import {
	accounts,
	buckets,
	categorizations,
	members,
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
	/**
	 * Who it is likely For, going by the merchant's earlier Transactions (issue 155): the card
	 * starts with them picked, and nothing is saved until a Parent files it. Left out when it is
	 * already For someone, or the earlier ones don't say.
	 */
	likelyFor?: For;
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

/** How many of the Household's latest filed Transactions are looked through for a likely For. */
const LIKELY_FOR_HISTORY = 3_000;

/**
 * Who each of `waiting` is likely For, by Transaction: for one that is For nobody yet, who the
 * same merchant's filed Transactions were For (likelyFor in @noodle/domain says when that is
 * enough), the merchant told as a Rule tells it. Only from Transactions `viewer` may read one by
 * one, so what the other Parent spent in their Personal Allowance never shows through a
 * suggestion (ADR-0003), and whole ones only: a Split's For is its own.
 */
async function loadLikelyFor(
	db: Db,
	viewer: Viewer,
	waiting: {
		id: string;
		for: For;
		merchant: string;
		merchantName: string | null;
		note: string | null;
	}[],
): Promise<Map<string, For>> {
	const likely = new Map<string, For>();
	const asking = waiting.filter((item) => item.for.length === 0);
	if (asking.length === 0) return likely;
	const [filed, current] = await Promise.all([
		db
			.select({
				note: transactions.note,
				merchant: transactions.merchant,
				for: sql<string>`(select json_group_array(${transactionFor.memberId}) from ${transactionFor}
					where ${transactionFor.transactionId} = ${transactions.id})`,
			})
			.from(transactions)
			.where(
				and(
					visibleTo(viewer),
					counts(),
					gt(transactions.amountCents, 0),
					sql`(${transactions.bucketId} is not null or ${transactions.commitmentId} is not null)`,
					sql`not exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`,
				),
			)
			.orderBy(desc(transactions.date), desc(transactions.id))
			.limit(LIKELY_FOR_HISTORY),
		db
			.select({ id: members.id })
			.from(members)
			.where(and(eq(members.householdId, viewer.householdId), isNull(members.removedAt))),
	]);
	// Each filed Transaction's place in `filed` (the latest first), by every name a Rule knows it by.
	const byMerchant = new Map<string, number[]>();
	const earlier = filed.map((row, at) => {
		for (const key of ruleKeys(row)) byMerchant.set(key, [...(byMerchant.get(key) ?? []), at]);
		return JSON.parse(row.for) as For;
	});
	const still = current.map((member) => member.id);
	for (const item of asking) {
		const keys = new Set([
			item.merchant,
			...ruleKeys({ merchant: item.merchantName, note: item.note }),
		]);
		const places = new Set([...keys].flatMap((key) => byMerchant.get(key) ?? []));
		const who = likelyFor(
			[...places].sort((a, b) => a - b).map((at) => earlier[at] ?? []),
			still,
		);
		if (who) likely.set(item.id, who);
	}
	return likely;
}

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
	const forOf = (id: string) =>
		forRows
			.filter((f) => f.transactionId === id)
			.map((f) => f.memberId)
			.sort();
	const likely = await loadLikelyFor(
		db,
		viewer,
		rows.map((row) => ({
			id: row.id,
			for: forOf(row.id),
			merchant: row.merchant,
			merchantName: row.merchantName,
			note: row.note,
		})),
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
			for: forOf(row.id),
			...(likely.has(row.id) ? { likelyFor: likely.get(row.id) } : {}),
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
 * Rules and Personal Allowance. Never one a Parent put back with Undo (issue 105): they said no
 * to where it was filed, and what that filing taught would only file it there again. It waits
 * for a Parent to file it, or for a Rule they make.
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
		.where(
			and(
				waiting(viewer),
				eq(categorizations.memberId, viewer.memberId),
				isNull(categorizations.returnedAt),
			),
		)
		.orderBy(asc(transactions.date), asc(transactions.id))
		.limit(LOOK_AGAIN_ROWS);
	return rows as Uncategorized[];
}

/**
 * Puts a Transaction a Parent just decided back in Review (their undo): unassigned as a whole,
 * without Splits, For `forMemberIds` again, with categorization's guess as it was, and marked as
 * put back, so background AI doesn't file it again by itself (`loadReviewToLookAgain`). Only one
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
		/** The Household's day; UTC's when left out. */
		today?: DayKey;
	},
): Promise<TransactionWriteResult> {
	const { householdId } = viewer;
	const { transactionId } = input;
	// Unfiling it (or dropping its Splits) would move a month that has ended (ADR-0058): refused,
	// and every write below carries the same test. One that is in nothing and unsplit moves nothing.
	const moves = sql`(${transactions.bucketId} is not null or ${transactions.commitmentId} is not null
		or exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id}))`;
	const mayReturn = sql`(${purchaseMayMove(input.today)} or not ${moves})`;
	const [ended] = await db
		.select({ id: transactions.id })
		.from(transactions)
		.where(
			and(
				eq(transactions.id, transactionId),
				eq(transactions.householdId, householdId),
				sql`not ${mayReturn}`,
			),
		);
	if (ended) return { ok: false, reason: "month-ended" };
	const asExpected =
		input.expectedVersion === undefined
			? undefined
			: eq(transactions.version, input.expectedVersion);
	const theirs = sql`exists (select 1 from ${transactions} where ${and(
		eq(transactions.id, transactionId),
		changeableBy(viewer),
		isNull(transactions.goalId),
		asExpected,
		mayReturn,
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
		// Owed back on one of those Splits is on the whole purchase now.
		owedBackOffGoneSplits(db, householdId, transactionId),
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
						returnedAt: sql<Date>`(unixepoch() * 1000)`.as("returned_at"),
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
					returnedAt: sql`excluded.returned_at`,
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
					mayReturn,
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
		// Who cleared it from Review, noted while its marker still says it waits (issue 142).
		reviewCleared(db, viewer.householdId, viewer.memberId, sql`${transactions.id} in ${theFiled}`),
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
