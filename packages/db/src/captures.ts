import {
	accountForWalletCard,
	addDays,
	type Cents,
	type DayKey,
	MATCH_WINDOW,
} from "@noodle/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./index";
import { matchImported } from "./matches";
import { accounts, captureCards, captureTokens, households, members, transactions } from "./schema";

// Tap to capture: a Parent's capture token lets the iPhone Shortcut record a Quick Add as them,
// the moment they pay. A captured Quick Add is a Quick Add like any other (source 'quick-add',
// captured_via 'shortcut'), so its bank copy Matches it later and the spend counts once. Only a
// token's SHA-256 is stored.

/** The viewer's live capture token, without its secret: only when it was made. */
export type CaptureTokenSummary = { createdAt: Date } | null;

export async function loadCaptureToken(
	db: Db,
	householdId: string,
	memberId: string,
): Promise<CaptureTokenSummary> {
	const [token] = await db
		.select({ createdAt: captureTokens.createdAt })
		.from(captureTokens)
		.where(
			and(
				eq(captureTokens.householdId, householdId),
				eq(captureTokens.memberId, memberId),
				isNull(captureTokens.revokedAt),
			),
		);
	return token ?? null;
}

/** Revokes the Parent's live capture token, if any: a Shortcut still sending it is refused. */
export function revokeCaptureTokenQuery(db: Db, householdId: string, memberId: string) {
	return db
		.update(captureTokens)
		.set({ revokedAt: sql`(unixepoch() * 1000)` })
		.where(
			and(
				eq(captureTokens.householdId, householdId),
				eq(captureTokens.memberId, memberId),
				isNull(captureTokens.revokedAt),
			),
		);
}

export async function revokeCaptureToken(
	db: Db,
	householdId: string,
	memberId: string,
): Promise<void> {
	await revokeCaptureTokenQuery(db, householdId, memberId);
}

/**
 * Makes a Parent's capture token, stored as `tokenHash`, revoking the one they had: a Parent has
 * one live token at a time. Written only for a Parent of the Household.
 */
export async function createCaptureToken(
	db: Db,
	input: { householdId: string; memberId: string; tokenId: string; tokenHash: string },
): Promise<void> {
	await db.batch([
		revokeCaptureTokenQuery(db, input.householdId, input.memberId),
		db.insert(captureTokens).select(
			db
				.select({
					// Selected in the table's column order: insert … select is positional.
					id: sql<string>`${input.tokenId}`.as("id"),
					householdId: members.householdId,
					memberId: members.id,
					tokenHash: sql<string>`${input.tokenHash}`.as("token_hash"),
					createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
					revokedAt: sql<Date | null>`null`.as("revoked_at"),
				})
				.from(members)
				.where(
					and(
						eq(members.id, input.memberId),
						eq(members.householdId, input.householdId),
						eq(members.kind, "parent"),
					),
				),
		),
	]);
}

/** Whose capture token hashes to `tokenHash`, while it's live; null for any other. */
export async function findCaptureToken(
	db: Db,
	tokenHash: string,
): Promise<{ tokenId: string; householdId: string; memberId: string; timeZone: string } | null> {
	const [token] = await db
		.select({
			tokenId: captureTokens.id,
			householdId: captureTokens.householdId,
			memberId: captureTokens.memberId,
			timeZone: households.timeZone,
		})
		.from(captureTokens)
		.innerJoin(households, eq(households.id, captureTokens.householdId))
		.where(and(eq(captureTokens.tokenHash, tokenHash), isNull(captureTokens.revokedAt)));
	return token ?? null;
}

export type CaptureResult =
	| {
			ok: true;
			/** This call wrote it; false when an earlier delivery of the same capture already had. */
			added: boolean;
			/** The months whose Quick Adds this capture's Matching paired with a bank copy. */
			matchedMonths: string[];
	  }
	| { ok: false; reason: "revoked" };

/**
 * Records a captured Quick Add: `amountCents` spent at `merchant` on `date`, by the Parent whose
 * token `tokenId` is, For the whole Household. Idempotent per `transactionId`, so a retried
 * Shortcut or a redelivered message records it once. It's written unassigned, for categorization
 * to file. Written only while the token is live. Its bank copy, if already imported, is Matched right away.
 */
export async function addCapture(
	db: Db,
	input: {
		tokenId: string;
		householdId: string;
		memberId: string;
		transactionId: string;
		date: DayKey;
		amountCents: Cents;
		merchant: string;
		/** The Wallet card it was paid with, when the Shortcut sends it: the Account it lands on. */
		card?: string | null;
		newId: () => string;
	},
): Promise<CaptureResult> {
	const { householdId, memberId, date } = input;
	const added = await db
		.insert(transactions)
		.select(
			db
				.select({
					// Selected in the table's column order: insert … select is positional.
					id: sql<string>`${input.transactionId}`.as("id"),
					householdId: captureTokens.householdId,
					source: sql<"quick-add">`'quick-add'`.as("source"),
					date: sql<string>`${date}`.as("date"),
					amountCents: sql<number>`${input.amountCents}`.as("amount_cents"),
					bucketId: sql<string | null>`null`.as("bucket_id"),
					note: sql<string>`${input.merchant}`.as("note"),
					createdByMemberId: captureTokens.memberId,
					createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
					commitmentId: sql<string | null>`null`.as("commitment_id"),
					accountId: sql<string | null>`null`.as("account_id"),
					goalId: sql<string | null>`null`.as("goal_id"),
					importId: sql<string | null>`null`.as("import_id"),
					externalId: sql<string | null>`null`.as("external_id"),
					capturedVia: sql<"shortcut">`'shortcut'`.as("captured_via"),
					pending: sql<boolean>`0`.as("pending"),
					merchant: sql<string | null>`null`.as("merchant"),
					version: sql<number>`0`.as("version"),
					bankTookBackOn: sql<string | null>`null`.as("bank_took_back_on"),
					bankAmountCents: sql<number | null>`null`.as("bank_amount_cents"),
					reviewClearedByMemberId: sql<string | null>`null`.as("review_cleared_by_member_id"),
					reviewClearedAt: sql<Date | null>`null`.as("review_cleared_at"),
				})
				.from(captureTokens)
				.where(
					and(
						eq(captureTokens.id, input.tokenId),
						eq(captureTokens.householdId, householdId),
						eq(captureTokens.memberId, memberId),
						isNull(captureTokens.revokedAt),
					),
				),
		)
		.onConflictDoNothing({ target: transactions.id })
		.returning({ id: transactions.id });
	const [written] = await db
		.select({ id: transactions.id })
		.from(transactions)
		.where(
			and(
				eq(transactions.id, input.transactionId),
				eq(transactions.householdId, householdId),
				eq(transactions.source, "quick-add"),
			),
		);
	if (!written) return { ok: false, reason: "revoked" };
	const card = input.card?.trim();
	if (card && added.length > 0) {
		const accountId = accountForWalletCard(card, await walletAccounts(db, householdId));
		await db.batch([
			db
				.insert(captureCards)
				.values({ transactionId: input.transactionId, householdId, card })
				.onConflictDoNothing({ target: captureCards.transactionId }),
			...(accountId
				? [
						db
							.update(transactions)
							.set({ accountId })
							.where(
								and(
									eq(transactions.id, input.transactionId),
									eq(transactions.householdId, householdId),
									isNull(transactions.accountId),
								),
							),
					]
				: []),
		]);
	}
	// A bank copy imported before the capture arrived, dated within the Match window.
	const matched = await matchImported(
		db,
		householdId,
		addDays(date, MATCH_WINDOW.from),
		addDays(date, MATCH_WINDOW.to),
		input.newId,
	);
	return {
		ok: true,
		added: added.length > 0,
		matchedMonths: matched.months,
	};
}

/** The Household's Accounts in use, as accountForWalletCard reads them. */
const walletAccounts = (db: Db, householdId: string) =>
	db
		.select({
			id: accounts.id,
			name: accounts.name,
			kind: accounts.kind,
			walletName: accounts.walletName,
		})
		.from(accounts)
		.where(and(eq(accounts.householdId, householdId), isNull(accounts.archivedAt)));

/** A Wallet card captures were paid with that no Account is known for yet, and how many captures. */
export type WalletQuestion = { card: string; captures: number };

/**
 * The Wallet cards a Parent is asked about once: named by a capture that landed on no Account.
 * Answered by answerWalletCard, which moves those captures, so the question goes away.
 */
export async function loadWalletQuestions(db: Db, householdId: string): Promise<WalletQuestion[]> {
	return db
		.select({
			card: sql<string>`min(${captureCards.card})`,
			captures: sql<number>`count(*)`.mapWith(Number),
		})
		.from(captureCards)
		.innerJoin(transactions, eq(transactions.id, captureCards.transactionId))
		.where(
			and(
				eq(captureCards.householdId, householdId),
				isNull(transactions.accountId),
				// A name a Parent said is none of their Accounts stays answered for later captures too.
				sql`not exists (select 1 from capture_cards nc where nc.household_id = ${householdId}
					and lower(nc.card) = lower(${captureCards.card}) and nc.none_at is not null)`,
			),
		)
		.groupBy(sql`lower(${captureCards.card})`)
		.orderBy(sql`lower(${captureCards.card})`);
}

/**
 * "None of these" to "Which Account is this Wallet card?": the captures paid with it stay on no
 * Account, and the name isn't asked about again. Naming an Account for it later still works.
 */
export async function dismissWalletCard(
	db: Db,
	input: { householdId: string; card: string; now?: Date },
): Promise<{ ok: boolean }> {
	const said = await db
		.update(captureCards)
		.set({ noneAt: input.now ?? new Date() })
		.where(
			and(
				eq(captureCards.householdId, input.householdId),
				sql`lower(${captureCards.card}) = lower(${input.card.trim()})`,
			),
		)
		.returning({ id: captureCards.transactionId });
	return { ok: said.length > 0 };
}

/**
 * A Parent's answer to "Which Account is this Wallet card?": remembered on the Account, so later
 * captures land there, and the captures already made with that card move to it. Refused unless
 * the Account is the Household's, in use.
 */
export async function answerWalletCard(
	db: Db,
	input: { householdId: string; card: string; accountId: string },
): Promise<{ ok: boolean; moved: number }> {
	const { householdId, accountId } = input;
	const card = input.card.trim();
	const own = and(
		eq(accounts.id, accountId),
		eq(accounts.householdId, householdId),
		isNull(accounts.archivedAt),
	);
	const [remembered, moved] = await db.batch([
		db.update(accounts).set({ walletName: card }).where(own).returning({ id: accounts.id }),
		db
			.update(transactions)
			.set({ accountId })
			.where(
				and(
					eq(transactions.householdId, householdId),
					isNull(transactions.accountId),
					sql`${transactions.id} in (select cc.transaction_id from capture_cards cc
						where cc.household_id = ${householdId} and lower(cc.card) = lower(${card}))`,
					sql`exists (select 1 from accounts wa where wa.id = ${accountId}
						and wa.household_id = ${householdId} and wa.archived_at is null)`,
				),
			)
			.returning({ id: transactions.id }),
	]);
	return { ok: remembered.length > 0, moved: moved.length };
}
