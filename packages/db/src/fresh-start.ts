import { merchantKey } from "@noodle/domain";
import { and, count, desc, eq, getTableColumns, gt, inArray, ne, or } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import { REMOVED_CREDENTIAL } from "./bank-connections";
import type { Db } from "./index";
import * as s from "./schema";

// Fresh start and Delete Household (#63, ADR-0029): every table a Household's rows live in, and
// clearing them. fresh-start.test.ts fails when a table with a household_id (or one pointing at
// such a table) isn't listed here, so a new table can't be left behind.

export type ClearLevel = "fresh-start" | "delete";

/**
 * Every household-scoped table, parents before children (the seed's order, ADR-0003): cleared in
 * reverse, so no foreign key is ever left pointing at a deleted row.
 */
export const HOUSEHOLD_TABLES = {
	households: s.households,
	merchantVectors: s.merchantVectors,
	members: s.members,
	invites: s.invites,
	setupProgress: s.setupProgress,
	setupJobs: s.setupJobs,
	merchantNames: s.merchantNames,
	suggestions: s.suggestions,
	baselines: s.baselines,
	buckets: s.buckets,
	bucketAllowances: s.bucketAllowances,
	bucketRolling: s.bucketRolling,
	commitments: s.commitments,
	commitmentTerms: s.commitmentTerms,
	bankConnections: s.bankConnections,
	accounts: s.accounts,
	accountBalances: s.accountBalances,
	imports: s.imports,
	csvMappings: s.csvMappings,
	goals: s.goals,
	earmarkClaims: s.earmarkClaims,
	income: s.income,
	transactions: s.transactions,
	bankLinePairs: s.bankLinePairs,
	transactionFor: s.transactionFor,
	splits: s.splits,
	splitFor: s.splitFor,
	matches: s.matches,
	transfers: s.transfers,
	refunds: s.refunds,
	moves: s.moves,
	pushSubscriptions: s.pushSubscriptions,
	nudgePreferences: s.nudgePreferences,
	scenarios: s.scenarios,
	planChanges: s.planChanges,
	monthCloses: s.monthCloses,
	rules: s.rules,
	ruleFor: s.ruleFor,
	categorizations: s.categorizations,
	captureTokens: s.captureTokens,
	checkIns: s.checkIns,
	perkSources: s.perkSources,
	perks: s.perks,
	insights: s.insights,
	receipts: s.receipts,
	planDrafts: s.planDrafts,
	planDraftDecisions: s.planDraftDecisions,
	bankLinkSessions: s.bankLinkSessions,
	freshStarts: s.freshStarts,
} satisfies Record<string, SQLiteTable>;

export type HouseholdTableName = keyof typeof HOUSEHOLD_TABLES;

/** What a fresh start keeps: the Household, its Parents and Children, and the fresh start's own record. */
export const KEPT_ON_FRESH_START: ReadonlySet<HouseholdTableName> = new Set([
	"households",
	"members",
	"freshStarts",
]);

/** The tables a level clears, in the order to clear them (children first). */
export function tablesToClear(level: ClearLevel): HouseholdTableName[] {
	const names = Object.keys(HOUSEHOLD_TABLES).reverse() as HouseholdTableName[];
	return level === "delete" ? names : names.filter((name) => !KEPT_ON_FRESH_START.has(name));
}

/** The column that says which Household a row belongs to: `household_id`, or the Household's own `id`. */
export function householdColumn(name: HouseholdTableName): SQLiteColumn {
	const table = HOUSEHOLD_TABLES[name];
	const columns = getTableColumns(table) as Record<string, SQLiteColumn>;
	return (name === "households" ? columns.id : columns.householdId) as SQLiteColumn;
}

/**
 * Deletes the Household's rows from every table the level clears, children first, after the
 * emergency Goal pointer. Each delete is idempotent, so a retried or repeated run is safe.
 */
export async function clearHouseholdRows(
	db: Db,
	householdId: string,
	level: ClearLevel,
): Promise<void> {
	await db
		.update(s.households)
		.set({ emergencyGoalId: null })
		.where(eq(s.households.id, householdId));
	for (const name of tablesToClear(level)) {
		await db.delete(HOUSEHOLD_TABLES[name]).where(eq(householdColumn(name), householdId));
	}
}

/** How many of each thing a fresh start would clear, for the first warning. */
export type FreshStartCounts = {
	transactions: number;
	bankConnections: number;
	accounts: number;
	buckets: number;
	goals: number;
	commitments: number;
	receipts: number;
	imports: number;
	rules: number;
	insights: number;
};

export async function countHouseholdData(db: Db, householdId: string): Promise<FreshStartCounts> {
	const counted = async (name: HouseholdTableName, extra?: ReturnType<typeof eq>) => {
		const [row] = await db
			.select({ n: count() })
			.from(HOUSEHOLD_TABLES[name])
			.where(and(eq(householdColumn(name), householdId), extra));
		return row?.n ?? 0;
	};
	return {
		transactions: await counted("transactions"),
		bankConnections: await counted(
			"bankConnections",
			ne(s.bankConnections.credential, REMOVED_CREDENTIAL),
		),
		accounts: await counted("accounts"),
		buckets: await counted("buckets"),
		goals: await counted("goals"),
		commitments: await counted("commitments"),
		receipts: await counted("receipts"),
		imports: await counted("imports"),
		rules: await counted("rules"),
		insights: await counted("insights"),
	};
}

/** The Household's Bank Connections still linked at their bank (their token not yet deleted). */
export async function linkedBankConnectionIds(db: Db, householdId: string): Promise<string[]> {
	const rows = await db
		.select({ id: s.bankConnections.id })
		.from(s.bankConnections)
		.where(
			and(
				eq(s.bankConnections.householdId, householdId),
				ne(s.bankConnections.credential, REMOVED_CREDENTIAL),
			),
		);
	return rows.map((row) => row.id);
}

/** The banks the Household still has connected, by name, each once. */
export async function linkedBankNames(db: Db, householdId: string): Promise<string[]> {
	const rows = await db
		.select({ institution: s.bankConnections.institution })
		.from(s.bankConnections)
		.where(
			and(
				eq(s.bankConnections.householdId, householdId),
				ne(s.bankConnections.credential, REMOVED_CREDENTIAL),
			),
		);
	return [...new Set(rows.map((row) => row.institution ?? "your bank"))];
}

/** Notes a merchant the Household's merchant index learned, so a fresh start can forget it. */
export async function recordLearnedMerchant(
	db: Db,
	householdId: string,
	merchant: string,
): Promise<void> {
	await db.insert(s.merchantVectors).values({ householdId, merchant }).onConflictDoNothing();
}

/**
 * Every merchant the Household's merchant index may have learned: those recorded since #63, and,
 * for ones learned before, each merchantKey its Transactions and Review could have taught
 * (loadCorrection's clean name, statement merchant or note).
 */
export async function learnedMerchants(db: Db, householdId: string): Promise<string[]> {
	const keys = new Set<string>();
	for (const row of await db
		.select({ merchant: s.merchantVectors.merchant })
		.from(s.merchantVectors)
		.where(eq(s.merchantVectors.householdId, householdId)))
		keys.add(row.merchant);
	for (const row of await db
		.selectDistinct({ merchant: s.categorizations.merchant })
		.from(s.categorizations)
		.where(eq(s.categorizations.householdId, householdId)))
		keys.add(row.merchant);
	for (const row of await db
		.selectDistinct({ merchant: s.transactions.merchant, note: s.transactions.note })
		.from(s.transactions)
		.where(eq(s.transactions.householdId, householdId))) {
		if (row.merchant) keys.add(merchantKey(row.merchant));
		if (row.note) keys.add(merchantKey(row.note));
	}
	keys.delete("");
	return [...keys];
}

// --- The fresh start's own record -------------------------------------------------------------

export type FreshStart = typeof s.freshStarts.$inferSelect;

/** The Household's fresh start that's scheduled or running, if any. */
export async function loadActiveFreshStart(
	db: Db,
	householdId: string,
): Promise<FreshStart | null> {
	const [row] = await db
		.select()
		.from(s.freshStarts)
		.where(
			and(
				eq(s.freshStarts.householdId, householdId),
				inArray(s.freshStarts.status, ["scheduled", "running"]),
			),
		)
		.orderBy(desc(s.freshStarts.createdAt))
		.limit(1);
	return row ?? null;
}

export async function loadFreshStart(db: Db, id: string): Promise<FreshStart | null> {
	const [row] = await db.select().from(s.freshStarts).where(eq(s.freshStarts.id, id));
	return row ?? null;
}

/** Schedules one, unless one is already scheduled or running: then that one is returned. */
export async function scheduleFreshStart(
	db: Db,
	input: {
		id: string;
		householdId: string;
		level: ClearLevel;
		requestedBy: string;
		runAt: number;
		now: number;
	},
): Promise<{ created: boolean; freshStart: FreshStart }> {
	const active = await loadActiveFreshStart(db, input.householdId);
	if (active) return { created: false, freshStart: active };
	const [row] = await db
		.insert(s.freshStarts)
		.values({
			id: input.id,
			householdId: input.householdId,
			level: input.level,
			requestedBy: input.requestedBy,
			runAt: new Date(input.runAt),
			status: "scheduled",
			createdAt: new Date(input.now),
		})
		.returning();
	return { created: true, freshStart: row as FreshStart };
}

/** Either Parent cancels it while it's still waiting; false once it has started (or there's none). */
export async function cancelFreshStart(
	db: Db,
	householdId: string,
	memberId: string,
): Promise<FreshStart | null> {
	const [row] = await db
		.update(s.freshStarts)
		.set({ status: "cancelled", cancelledBy: memberId })
		.where(and(eq(s.freshStarts.householdId, householdId), eq(s.freshStarts.status, "scheduled")))
		.returning();
	return row ?? null;
}

/** The Workflow takes it from scheduled to running; false when it was cancelled. Retries are fine. */
export async function startFreshStartRun(db: Db, id: string): Promise<boolean> {
	await db
		.update(s.freshStarts)
		.set({ status: "running" })
		.where(and(eq(s.freshStarts.id, id), eq(s.freshStarts.status, "scheduled")));
	return (await loadFreshStart(db, id))?.status === "running";
}

export async function setFreshStartProgress(
	db: Db,
	id: string,
	progress: { step: number; steps: number; label: string | null },
): Promise<void> {
	await db.update(s.freshStarts).set(progress).where(eq(s.freshStarts.id, id));
}

export async function finishFreshStart(db: Db, id: string, now: number): Promise<void> {
	await db
		.update(s.freshStarts)
		.set({ status: "done", label: null, finishedAt: new Date(now) })
		.where(eq(s.freshStarts.id, id));
}

/** How many rows the Household has in each of its tables: what a fresh start checks it left. */
export async function countHouseholdRows(
	db: Db,
	householdId: string,
): Promise<Record<HouseholdTableName, number>> {
	const out: Partial<Record<HouseholdTableName, number>> = {};
	for (const name of Object.keys(HOUSEHOLD_TABLES) as HouseholdTableName[]) {
		const [row] = await db
			.select({ n: count() })
			.from(HOUSEHOLD_TABLES[name])
			.where(eq(householdColumn(name), householdId));
		out[name] = row?.n ?? 0;
	}
	return out as Record<HouseholdTableName, number>;
}

/** How long the other Parent has to cancel: a day. A Household with one Parent skips it. */
export const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/** When a fresh start asked for at `now` runs: at once with one Parent, a day later with two. */
export function freshStartRunAt(now: number, otherParents: number): number {
	return otherParents > 0 ? now + GRACE_PERIOD_MS : now;
}

/**
 * Whether the Household is being cleared, or a fresh start finished after `startedAt`: background
 * work that began before then checks this before each write and stops, so nothing it wrote for
 * the old Household lands in the new one (ADR-0029).
 */
export async function clearedSince(
	db: Db,
	householdId: string,
	startedAt: number,
): Promise<boolean> {
	const [row] = await db
		.select({ id: s.freshStarts.id })
		.from(s.freshStarts)
		.where(
			and(
				eq(s.freshStarts.householdId, householdId),
				or(
					eq(s.freshStarts.status, "running"),
					and(eq(s.freshStarts.status, "done"), gt(s.freshStarts.finishedAt, new Date(startedAt))),
				),
			),
		)
		.limit(1);
	return row !== undefined;
}
