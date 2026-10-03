import {
	addDays,
	autoMatches,
	type Cents,
	type DayKey,
	MATCH_WINDOW,
	type MatchSide,
	possibleMatches,
} from "@noodle/domain";
import { and, eq, gte, inArray, isNotNull, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import { inTransfer } from "./counting";
import type { Db } from "./index";
import { changeableBy, type Viewer, visibleTo } from "./privacy";
import { accounts, matches, splits, transactions } from "./schema";

// Matches (see the `matches` table): made automatically after an Import (matchImported), or by a
// Parent from a Transaction's detail, and unmatched by a Parent. Deciding which pairs to Match
// reads first (autoMatches in @noodle/domain); the write re-checks in SQL that both sides are
// still unmatched and still agree (ADR-0004), and the partial unique indexes keep each
// Transaction in one Match at a time, so a retried or concurrent run adds nothing twice.

/** The other side of a Match, or a candidate for one, as a Transaction's detail shows it. */
export type MatchPeer = {
	id: string;
	date: DayKey;
	amountCents: Cents;
	note: string | null;
	/** Its merchant's clean name, for an imported line once named (ADR-0027). */
	merchantName: string | null;
	/** The Account it was imported into; null for a Quick Add. */
	account: string | null;
};

/** A Transaction's Match, or what it might be Matched with. */
export type MatchView =
	| { kind: "matched"; matchId: string; peer: MatchPeer; automatic: boolean }
	| { kind: "unmatched"; possible: MatchPeer[] }
	| { kind: "none" };

/**
 * A Quick Add or an imported Transaction still unmatched and whole, as matching reads it; never a
 * Transfer's side, which isn't spending at all.
 */
const unmatchedSide = (source: "quick-add" | "import") =>
	and(
		eq(transactions.source, source),
		sql`${transactions.amountCents} > 0`,
		sql`not ${inTransfer()}`,
		sql`not exists (select 1 from ${matches} where (${matches.quickAddId} = ${transactions.id} or ${matches.importedId} = ${transactions.id}) and ${matches.removedAt} is null)`,
	) as SQL;

/**
 * An imported Transaction nobody has dealt with yet: unassigned and not split. Only these are
 * Matched automatically; one a Parent assigned is theirs to Match by hand.
 */
const untouched = and(
	isNull(transactions.bucketId),
	isNull(transactions.commitmentId),
	isNull(transactions.goalId),
	sql`not exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id})`,
) as SQL;

const sideColumns = {
	id: transactions.id,
	date: transactions.date,
	amount: transactions.amountCents,
	text: transactions.note,
};

/**
 * Matches the Household's unmatched imported Transactions dated `from` to `to` with their Quick
 * Adds, where it's clear (autoMatches). Runs after every Import; idempotent. Returns how many it
 * Matched and the months of the Quick Adds it Matched.
 */
export async function matchImported(
	db: Db,
	householdId: string,
	from: DayKey,
	to: DayKey,
	newId: () => string,
): Promise<{ matched: number; months: string[] }> {
	const [quickAdds, imported, refusedRows] = await db.batch([
		db
			.select(sideColumns)
			.from(transactions)
			.where(
				and(
					eq(transactions.householdId, householdId),
					unmatchedSide("quick-add"),
					gte(transactions.date, addDays(from, -MATCH_WINDOW.to)),
					lte(transactions.date, addDays(to, -MATCH_WINDOW.from)),
				),
			),
		db
			.select(sideColumns)
			.from(transactions)
			.where(
				and(
					eq(transactions.householdId, householdId),
					unmatchedSide("import"),
					untouched,
					gte(transactions.date, from),
					lte(transactions.date, to),
				),
			),
		db
			.select({ quickAddId: matches.quickAddId, importedId: matches.importedId })
			.from(matches)
			.where(and(eq(matches.householdId, householdId), isNotNull(matches.removedAt))),
	]);
	if (quickAdds.length === 0 || imported.length === 0) return { matched: 0, months: [] };
	const refused = new Set(refusedRows.map((row) => `${row.quickAddId}|${row.importedId}`));
	const pairs = autoMatches(quickAdds as MatchSide[], imported as MatchSide[], (q, i) =>
		refused.has(`${q}|${i}`),
	);
	if (pairs.length === 0) return { matched: 0, months: [] };
	const rows = pairs.map((pair) => ({ id: newId(), ...pair }));
	const field = (name: string) => sql.raw(`json_extract(value, '$.${name}')`);
	await db
		.insert(matches)
		.select(
			db
				.select({
					// Selected in the table's column order: insert … select is positional.
					id: sql<string>`${field("id")}`.as("id"),
					householdId: sql<string>`${householdId}`.as("household_id"),
					quickAddId: sql<string>`${field("quickAddId")}`.as("quick_add_id"),
					importedId: sql<string>`${field("importedId")}`.as("imported_id"),
					createdByMemberId: sql<string | null>`null`.as("created_by_member_id"),
					createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
					removedAt: sql<Date | null>`null`.as("removed_at"),
					removedByMemberId: sql<string | null>`null`.as("removed_by_member_id"),
				})
				.from(sql`json_each(${JSON.stringify(rows)})`)
				.where(
					// Both sides are still the Household's, unmatched, and for the same amount.
					sql`exists (select 1 from transactions q join transactions i
						on i.id = ${field("importedId")} and i.household_id = ${householdId} and i.source = 'import'
						where q.id = ${field("quickAddId")} and q.household_id = ${householdId}
						and q.source = 'quick-add' and q.amount_cents = i.amount_cents)`,
				),
		)
		.onConflictDoNothing();
	const matchedIds = new Set(pairs.map((pair) => pair.quickAddId));
	const months = quickAdds
		.filter((quickAdd) => matchedIds.has(quickAdd.id))
		.map((quickAdd) => quickAdd.date.slice(0, 7));
	return { matched: pairs.length, months: [...new Set(months)] };
}

/** A Transaction `viewer` may read, as a MatchPeer: its note, date, amount and Account. */
async function loadPeers(db: Db, where: SQL): Promise<MatchPeer[]> {
	const rows = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			amountCents: transactions.amountCents,
			note: transactions.note,
			merchantName: transactions.merchant,
			account: accounts.name,
		})
		.from(transactions)
		.leftJoin(accounts, eq(accounts.id, transactions.accountId))
		.where(where);
	// Dates are always written as DayKeys.
	return rows as MatchPeer[];
}

/**
 * A Transaction's Match as `viewer` sees it: for a Quick Add, its bank copy; for an imported
 * Transaction, its Quick Add. Unmatched, what a Parent might Match it with (possibleMatches):
 * only Quick Adds `viewer` may change, so never the other Parent's Personal Allowance.
 */
export async function loadMatch(db: Db, viewer: Viewer, transactionId: string): Promise<MatchView> {
	const [self] = await db
		.select({ ...sideColumns, source: transactions.source })
		.from(transactions)
		.where(and(eq(transactions.id, transactionId), visibleTo(viewer)));
	if (!self || self.amount <= 0) return { kind: "none" };
	const isQuickAdd = self.source === "quick-add";
	const [match] = await db
		.select()
		.from(matches)
		.where(
			and(
				eq(matches.householdId, viewer.householdId),
				isNull(matches.removedAt),
				isQuickAdd ? eq(matches.quickAddId, self.id) : eq(matches.importedId, self.id),
			),
		);
	if (match) {
		// The bank copy isn't visibleTo anyone on its own; it's read here through its Quick Add.
		const peerId = isQuickAdd ? match.importedId : match.quickAddId;
		const [peer] = await loadPeers(
			db,
			and(eq(transactions.id, peerId), eq(transactions.householdId, viewer.householdId)) as SQL,
		);
		if (!peer) return { kind: "none" };
		return {
			kind: "matched",
			matchId: match.id,
			peer,
			automatic: match.createdByMemberId === null,
		};
	}
	const date = self.date as DayKey;
	const [from, to] = isQuickAdd
		? [addDays(date, MATCH_WINDOW.from), addDays(date, MATCH_WINDOW.to)]
		: [addDays(date, -MATCH_WINDOW.to), addDays(date, -MATCH_WINDOW.from)];
	const others = await db
		.select(sideColumns)
		.from(transactions)
		.where(
			and(
				isQuickAdd ? visibleTo(viewer) : changeableBy(viewer),
				unmatchedSide(isQuickAdd ? "import" : "quick-add"),
				gte(transactions.date, from),
				lte(transactions.date, to),
			),
		);
	const ranked = possibleMatches(self as MatchSide, others as MatchSide[], isQuickAdd);
	if (ranked.length === 0) return { kind: "unmatched", possible: [] };
	const peers = await loadPeers(
		db,
		and(
			eq(transactions.householdId, viewer.householdId),
			inArray(
				transactions.id,
				ranked.map((side) => side.id),
			),
		) as SQL,
	);
	const order = ranked.map((side) => side.id);
	return {
		kind: "unmatched",
		possible: peers.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
	};
}

export type MatchResult = { ok: true; months: string[] } | { ok: false; reason: "refused" };

/**
 * A Parent Matches a Quick Add they may change with an imported Transaction, both unmatched.
 * Idempotent per `matchId`. The amounts may differ (a tip): the Quick Add's is what counts.
 */
export async function matchTransactions(
	db: Db,
	viewer: Viewer,
	input: { matchId: string; quickAddId: string; importedId: string },
): Promise<MatchResult> {
	const quickAdd = and(
		eq(transactions.id, input.quickAddId),
		changeableBy(viewer),
		unmatchedSide("quick-add"),
	);
	const imported = and(
		eq(transactions.id, input.importedId),
		eq(transactions.householdId, viewer.householdId),
		unmatchedSide("import"),
	);
	await db
		.insert(matches)
		.select(
			db
				.select({
					id: sql<string>`${input.matchId}`.as("id"),
					householdId: sql<string>`${viewer.householdId}`.as("household_id"),
					quickAddId: sql<string>`${input.quickAddId}`.as("quick_add_id"),
					importedId: sql<string>`${input.importedId}`.as("imported_id"),
					createdByMemberId: sql<string>`${viewer.memberId}`.as("created_by_member_id"),
					createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
					removedAt: sql<Date | null>`null`.as("removed_at"),
					removedByMemberId: sql<string | null>`null`.as("removed_by_member_id"),
				})
				.from(transactions)
				.where(and(quickAdd, sql`exists (select 1 from ${transactions} where ${imported})`) as SQL),
		)
		.onConflictDoNothing();
	return matchOutcome(db, viewer, input.matchId, false);
}

/** A Parent unmatches a Match whose Quick Add they may change; the imported copy counts again. */
export async function unmatch(db: Db, viewer: Viewer, matchId: string): Promise<MatchResult> {
	await db
		.update(matches)
		.set({ removedAt: sql`(unixepoch() * 1000)`, removedByMemberId: viewer.memberId })
		.where(
			and(
				eq(matches.id, matchId),
				eq(matches.householdId, viewer.householdId),
				isNull(matches.removedAt),
				sql`exists (select 1 from ${transactions} where ${transactions.id} = ${matches.quickAddId} and ${changeableBy(viewer)})`,
			),
		);
	return matchOutcome(db, viewer, matchId, true);
}

/** The months a Match's two sides are in, once it's written (or `removed`); refused if it isn't. */
async function matchOutcome(
	db: Db,
	viewer: Viewer,
	matchId: string,
	removed: boolean,
): Promise<MatchResult> {
	const rows = await db
		.select({ date: transactions.date })
		.from(matches)
		.innerJoin(
			transactions,
			or(eq(transactions.id, matches.quickAddId), eq(transactions.id, matches.importedId)),
		)
		.where(
			and(
				eq(matches.id, matchId),
				eq(matches.householdId, viewer.householdId),
				removed ? isNotNull(matches.removedAt) : isNull(matches.removedAt),
			),
		);
	if (rows.length === 0) return { ok: false, reason: "refused" };
	return { ok: true, months: [...new Set(rows.map((row) => row.date.slice(0, 7)))] };
}
