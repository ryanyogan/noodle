import { addDays, type Cents, type DayKey, MATCH_WINDOW } from "@noodle/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./index";
import { matchImported } from "./matches";
import { captureTokens, households, members, transactions } from "./schema";

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
