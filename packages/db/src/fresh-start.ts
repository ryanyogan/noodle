import { merchantKey } from "@noodle/domain";
import {
	and,
	count,
	desc,
	eq,
	getTableColumns,
	gt,
	inArray,
	isNotNull,
	isNull,
	ne,
	or,
} from "drizzle-orm";
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
	// Before Commitments: one may pay down a card or loan (commitments.account_id, issue 93).
	bankConnections: s.bankConnections,
	accounts: s.accounts,
	accountBalances: s.accountBalances,
	commitments: s.commitments,
	commitmentTerms: s.commitmentTerms,
	imports: s.imports,
	csvMappings: s.csvMappings,
	goals: s.goals,
	earmarkClaims: s.earmarkClaims,
	income: s.income,
	transactions: s.transactions,
	bankLinePairs: s.bankLinePairs,
	deletedBankLines: s.deletedBankLines,
	transactionFor: s.transactionFor,
	splits: s.splits,
	splitFor: s.splitFor,
	matches: s.matches,
	transfers: s.transfers,
	refunds: s.refunds,
	// After income and Transactions, which they point at; matches after what they settle.
	owedBack: s.owedBack,
	paidBackMatches: s.paidBackMatches,
	refundLinks: s.refundLinks,
	moves: s.moves,
	pushSubscriptions: s.pushSubscriptions,
	nudgePreferences: s.nudgePreferences,
	scenarios: s.scenarios,
	planChanges: s.planChanges,
	monthCloses: s.monthCloses,
	rules: s.rules,
	ruleFor: s.ruleFor,
	moneyInRules: s.moneyInRules,
	cardPaymentRules: s.cardPaymentRules,
	categorizations: s.categorizations,
	captureCards: s.captureCards,
	captureTokens: s.captureTokens,
	checkIns: s.checkIns,
	perkSources: s.perkSources,
	perks: s.perks,
	perkUses: s.perkUses,
	insights: s.insights,
	receipts: s.receipts,
	planDrafts: s.planDrafts,
	planDraftDecisions: s.planDraftDecisions,
	bankLinkSessions: s.bankLinkSessions,
	householdPasses: s.householdPasses,
	freshStarts: s.freshStarts,
	householdSnapshots: s.householdSnapshots,
} satisfies Record<string, SQLiteTable>;

export type HouseholdTableName = keyof typeof HOUSEHOLD_TABLES;

/**
 * What a fresh start keeps: the Household, its Parents and Children, the fresh start's own record,
 * and the Household's snapshots (ADR-0035), so a fresh start can be undone.
 */
export const KEPT_ON_FRESH_START: ReadonlySet<HouseholdTableName> = new Set([
	"households",
	"members",
	"freshStarts",
	"householdSnapshots",
	// A one-time pass that ran stays run.
	"householdPasses",
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

/**
 * What the Household's merchant index should hold, read from its rows alone (#78, ADR-0035), so
 * the index can be built again after a snapshot is restored: each merchant it learned
 * (`merchant_vectors`) with the Bucket of the newest imported Transaction a Parent settled for it,
 * which is what `loadCorrection` taught when they did. A Transaction background AI filed and no
 * Parent confirmed teaches nothing, as before; a learned merchant with no such Transaction left
 * is skipped.
 */
export async function learnedMerchantBuckets(
	db: Db,
	householdId: string,
): Promise<{ merchant: string; bucketId: string }[]> {
	const learned = new Set(
		(
			await db
				.select({ merchant: s.merchantVectors.merchant })
				.from(s.merchantVectors)
				.where(eq(s.merchantVectors.householdId, householdId))
		).map((row) => row.merchant),
	);
	if (learned.size === 0) return [];
	const rows = await db
		.select({
			cleanName: s.transactions.merchant,
			note: s.transactions.note,
			bucketId: s.transactions.bucketId,
		})
		.from(s.transactions)
		.leftJoin(s.categorizations, eq(s.categorizations.transactionId, s.transactions.id))
		.where(
			and(
				eq(s.transactions.householdId, householdId),
				eq(s.transactions.source, "import"),
				isNotNull(s.transactions.bucketId),
				isNull(s.categorizations.transactionId),
			),
		)
		.orderBy(desc(s.transactions.date), desc(s.transactions.id));
	const buckets = new Map<string, string>();
	for (const row of rows) {
		const merchant =
			(row.cleanName ? merchantKey(row.cleanName) : null) ||
			(row.note ? merchantKey(row.note) : null);
		if (!merchant || !row.bucketId || !learned.has(merchant) || buckets.has(merchant)) continue;
		buckets.set(merchant, row.bucketId);
	}
	return [...buckets]
		.map(([merchant, bucketId]) => ({ merchant, bucketId }))
		.sort((x, y) => x.merchant.localeCompare(y.merchant));
}

// --- The fresh start's own record -------------------------------------------------------------

export type FreshStart = typeof s.freshStarts.$inferSelect;

/** A request not yet over: waiting, clearing, or stopped at a step and waiting for Try again. */
const ACTIVE = ["scheduled", "running", "failed"] as const;

/** The Household's fresh start that's scheduled, running or failed, if any. */
export async function loadActiveFreshStart(
	db: Db,
	householdId: string,
): Promise<FreshStart | null> {
	const [row] = await db
		.select()
		.from(s.freshStarts)
		.where(
			and(eq(s.freshStarts.householdId, householdId), inArray(s.freshStarts.status, [...ACTIVE])),
		)
		.orderBy(desc(s.freshStarts.createdAt))
		.limit(1);
	return row ?? null;
}

export async function loadFreshStart(db: Db, id: string): Promise<FreshStart | null> {
	const [row] = await db.select().from(s.freshStarts).where(eq(s.freshStarts.id, id));
	return row ?? null;
}

/** Schedules one, unless one is already scheduled, running or failed: then that one is returned. */
export async function scheduleFreshStart(
	db: Db,
	input: {
		id: string;
		householdId: string;
		level: ClearLevel;
		requestedBy: string;
		runAt: number;
		now: number;
		deleteBackups?: boolean;
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
			deleteBackups: input.deleteBackups ?? false,
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

// --- Runs (issue 118) ---------------------------------------------------------------------------
// A request is carried by one Workflow instance at a time, its run. The first run's id is the
// request's own; Try again and "Start it now" hand the request to a new run (`run_id`). A run that
// is no longer the request's stops before its next step, so two runs never clear side by side
// for longer than the one step the older was in, and every step is safe to run twice.

/** The Workflow instance that carries the request now. */
export const freshStartRunId = (row: Pick<FreshStart, "id" | "runId">): string =>
	row.runId ?? row.id;

const isRun = (runId: string) =>
	or(eq(s.freshStarts.runId, runId), and(isNull(s.freshStarts.runId), eq(s.freshStarts.id, runId)));

/**
 * What a run does when it begins: `wait` out the grace period then clear; `clear` at once, for a
 * request already running or failed (a restarted or new run carries on: every step is
 * repeatable); `exit` when it was cancelled, is done, is gone, or belongs to another run now.
 */
export function freshStartRunPlan(
	row: Pick<FreshStart, "id" | "runId" | "status"> | null,
	runId: string,
): "wait" | "clear" | "exit" {
	if (!row || freshStartRunId(row) !== runId) return "exit";
	if (row.status === "scheduled") return "wait";
	if (row.status === "running" || row.status === "failed") return "clear";
	return "exit";
}

/**
 * Asked before every step: whether this run still clears. Not once the request is done, failed
 * or handed to another run. A request that is gone carries on: Delete Household removes its own
 * record in its last step, and a retry of that step must still finish it.
 */
export function freshStartCarriesOn(
	row: Pick<FreshStart, "id" | "runId" | "status"> | null,
	runId: string,
): boolean {
	if (!row) return true;
	return row.status === "running" && freshStartRunId(row) === runId;
}

/**
 * The Workflow takes it to running: from scheduled, from failed, or already running (a restarted
 * run carries on). False when it was cancelled, is done, or (given `run`) is another run's now.
 */
export async function startFreshStartRun(
	db: Db,
	id: string,
	run?: { runId: string; now: number },
): Promise<boolean> {
	await db
		.update(s.freshStarts)
		.set({
			status: "running",
			failedStep: null,
			failedAt: null,
			...(run ? { progressAt: new Date(run.now) } : {}),
		})
		.where(
			and(
				eq(s.freshStarts.id, id),
				inArray(s.freshStarts.status, ["scheduled", "failed"]),
				run ? isRun(run.runId) : undefined,
			),
		);
	const row = await loadFreshStart(db, id);
	return row?.status === "running" && (!run || freshStartRunId(row) === run.runId);
}

/** Before a step: how far it has got, and that it moved just now (`at`). */
export async function setFreshStartProgress(
	db: Db,
	id: string,
	progress: { step: number; steps: number; label: string | null },
	at?: number,
): Promise<void> {
	await db
		.update(s.freshStarts)
		.set({ ...progress, ...(at === undefined ? {} : { progressAt: new Date(at) }) })
		.where(eq(s.freshStarts.id, id));
}

/** A step run again quietly by a later run: it moved, but is no further than before. */
export async function stampFreshStart(db: Db, id: string, at: number): Promise<void> {
	await db
		.update(s.freshStarts)
		.set({ progressAt: new Date(at) })
		.where(eq(s.freshStarts.id, id));
}

/** A step used up its retries: the request stops there until a Parent tries again. */
export async function failFreshStart(
	db: Db,
	id: string,
	failure: { step: string; now: number; runId: string },
): Promise<boolean> {
	const rows = await db
		.update(s.freshStarts)
		.set({ status: "failed", failedStep: failure.step, failedAt: new Date(failure.now) })
		.where(and(eq(s.freshStarts.id, id), eq(s.freshStarts.status, "running"), isRun(failure.runId)))
		.returning({ id: s.freshStarts.id });
	return rows.length > 0;
}

/**
 * A running request that has not begun a step for this long is shown as stuck. Longer than any
 * silence a healthy run leaves: a step's attempt may take 10 minutes (the Workflow's limit) and
 * the longest wait between retries is 8 (30 seconds doubling, five retries), so 18 at most.
 */
export const STUCK_AFTER_MS = 20 * 60 * 1000;

/**
 * `failed`: a step used up its retries. `stuck`: it should be moving and hasn't for
 * STUCK_AFTER_MS (running with no step begun, or due and never begun). Either can be tried again.
 */
export function freshStartTrouble(
	row: Pick<FreshStart, "status" | "runAt" | "progressAt">,
	now: number,
): "failed" | "stuck" | null {
	if (row.status === "failed") return "failed";
	if (row.status !== "running" && row.status !== "scheduled") return null;
	const moved =
		row.status === "running"
			? (row.progressAt ?? row.runAt).getTime()
			: Math.max(row.runAt.getTime(), row.progressAt?.getTime() ?? 0);
	return now - moved > STUCK_AFTER_MS ? "stuck" : null;
}

/** Hands the request to a new run, only if nobody else changed it meanwhile. */
async function handOver(
	db: Db,
	row: FreshStart,
	to: { runId: string; now: number; runAt?: number; agreedBy?: string },
): Promise<FreshStart | null> {
	const [next] = await db
		.update(s.freshStarts)
		.set({
			runId: to.runId,
			progressAt: new Date(to.now),
			failedStep: null,
			failedAt: null,
			status: row.status === "failed" ? "running" : row.status,
			...(to.runAt === undefined ? {} : { runAt: new Date(to.runAt) }),
			...(to.agreedBy === undefined ? {} : { agreedBy: to.agreedBy }),
		})
		.where(
			and(
				eq(s.freshStarts.id, row.id),
				eq(s.freshStarts.status, row.status),
				row.runId === null ? isNull(s.freshStarts.runId) : eq(s.freshStarts.runId, row.runId),
			),
		)
		.returning();
	return next ?? null;
}

export type FreshStartHandOver = { freshStart: FreshStart; previousRunId: string };

/**
 * Try again: a failed or stuck request goes to a new run, which carries on with the clear. Null
 * when there is nothing to try again (none, or one moving along), or the other Parent just did.
 */
export async function retryFreshStart(
	db: Db,
	input: { householdId: string; runId: string; now: number },
): Promise<FreshStartHandOver | null> {
	const row = await loadActiveFreshStart(db, input.householdId);
	if (!row || !freshStartTrouble(row, input.now)) return null;
	const freshStart = await handOver(db, row, input);
	return freshStart && { freshStart, previousRunId: freshStartRunId(row) };
}

/**
 * "Start it now": the Parent who did not ask agrees, so the wait is over and a new run begins at
 * once. Null for the Parent who asked (nobody skips their own wait alone), and when nothing is
 * waiting (cancelled meanwhile, already begun).
 */
export async function agreeToFreshStart(
	db: Db,
	input: { householdId: string; memberId: string; runId: string; now: number },
): Promise<FreshStartHandOver | null> {
	const row = await loadActiveFreshStart(db, input.householdId);
	if (row?.status !== "scheduled" || row.requestedBy === input.memberId) return null;
	const freshStart = await handOver(db, row, {
		runId: input.runId,
		now: input.now,
		runAt: input.now,
		agreedBy: input.memberId,
	});
	return freshStart && { freshStart, previousRunId: freshStartRunId(row) };
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
					// Failed is still being cleared: it stopped part-way and waits for Try again.
					inArray(s.freshStarts.status, ["running", "failed"]),
					and(eq(s.freshStarts.status, "done"), gt(s.freshStarts.finishedAt, new Date(startedAt))),
				),
			),
		)
		.limit(1);
	return row !== undefined;
}
