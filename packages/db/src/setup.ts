import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./index";
import { bankConnections, baselines, imports, setupJobs, setupProgress } from "./schema";

// The get-started wizard (#53): its progress per Household, the Setup Workflow's jobs, and what
// that Workflow waits on (the first history to land). Every query is scoped by household_id.

export type SetupProgress = {
	step: number;
	answers: Record<string, unknown>;
	skipped: number[];
	startedAt: Date;
	finishedAt: Date | null;
};

/** The Household's wizard progress; null before a Parent has started it. */
export async function loadSetupProgress(
	db: Db,
	householdId: string,
): Promise<SetupProgress | null> {
	const [row] = await db
		.select({
			step: setupProgress.step,
			answers: setupProgress.answers,
			skipped: setupProgress.skipped,
			startedAt: setupProgress.startedAt,
			finishedAt: setupProgress.finishedAt,
		})
		.from(setupProgress)
		.where(eq(setupProgress.householdId, householdId));
	return row ?? null;
}

/**
 * Whether the Household has ever set take-home pay. A Household from before the wizard has a Plan
 * and no progress row; it counts as set up, so This Month doesn't ask it to continue.
 */
export async function hasTakeHomePay(db: Db, householdId: string): Promise<boolean> {
	const [row] = await db
		.select({ month: baselines.month })
		.from(baselines)
		.where(eq(baselines.householdId, householdId))
		.limit(1);
	return row !== undefined;
}

/**
 * Saves where the wizard is: the step, every answer so far, and the skipped steps. The first save
 * starts it; `finished` marks it done (once: a later save keeps the first time). Idempotent.
 */
export async function saveSetupProgress(
	db: Db,
	householdId: string,
	progress: {
		step: number;
		answers: Record<string, unknown>;
		skipped: number[];
		finished?: boolean;
	},
): Promise<void> {
	await db
		.insert(setupProgress)
		.values({
			householdId,
			step: progress.step,
			answers: progress.answers,
			skipped: progress.skipped,
			finishedAt: progress.finished ? new Date() : null,
		})
		.onConflictDoUpdate({
			target: setupProgress.householdId,
			set: {
				step: progress.step,
				answers: progress.answers,
				skipped: progress.skipped,
				...(progress.finished
					? { finishedAt: sql`coalesce(${setupProgress.finishedAt}, unixepoch() * 1000)` }
					: {}),
				updatedAt: sql`(unixepoch() * 1000)`,
			},
		});
}

/**
 * Starts the wizard again at Hello for "Run setup again": the answers are kept, so each step
 * changes what it wrote before instead of adding to it, and the Household counts as not finished
 * until Done is pressed again. Idempotent.
 */
export async function restartSetupProgress(
	db: Db,
	householdId: string,
	answers: Record<string, unknown>,
): Promise<void> {
	await db
		.insert(setupProgress)
		.values({ householdId, step: 1, answers, skipped: [], finishedAt: null })
		.onConflictDoUpdate({
			target: setupProgress.householdId,
			set: {
				step: 1,
				answers,
				skipped: [],
				finishedAt: null,
				updatedAt: sql`(unixepoch() * 1000)`,
			},
		});
}

export type SetupJobStatus = "waiting" | "running" | "done" | "skipped";
export type SetupJob = { job: string; status: SetupJobStatus };

/** The Setup Workflow's jobs for the Household, as each last said; none before it starts. */
export function loadSetupJobs(db: Db, householdId: string): Promise<SetupJob[]> {
	return db
		.select({ job: setupJobs.job, status: setupJobs.status })
		.from(setupJobs)
		.where(eq(setupJobs.householdId, householdId))
		.orderBy(asc(setupJobs.job));
}

/** Records how one of the Setup Workflow's jobs stands. Idempotent. */
export async function saveSetupJob(
	db: Db,
	householdId: string,
	job: string,
	status: SetupJobStatus,
): Promise<void> {
	await db
		.insert(setupJobs)
		.values({ householdId, job, status })
		.onConflictDoUpdate({
			target: [setupJobs.householdId, setupJobs.job],
			set: { status, updatedAt: sql`(unixepoch() * 1000)` },
		});
}

/** Starts every job over as waiting, for a new run of the Setup Workflow. */
export async function resetSetupJobs(db: Db, householdId: string, jobs: string[]): Promise<void> {
	await db.delete(setupJobs).where(eq(setupJobs.householdId, householdId));
	if (jobs.length === 0) return;
	await db
		.insert(setupJobs)
		.values(jobs.map((job) => ({ householdId, job, status: "waiting" as const })));
}

/**
 * The Household's history so far, for the Setup Workflow: every finished Import, oldest first,
 * and whether more is still on its way (a Bank Connection still reading or being chosen, or a
 * statement still being read).
 */
export async function loadSetupHistory(
	db: Db,
	householdId: string,
): Promise<{ importIds: string[]; arriving: boolean }> {
	const [rows, busy] = await Promise.all([
		db
			.select({ id: imports.id, status: imports.status })
			.from(imports)
			.where(eq(imports.householdId, householdId))
			.orderBy(asc(imports.createdAt), asc(imports.id)),
		db
			.select({ id: bankConnections.id })
			.from(bankConnections)
			.where(
				and(
					eq(bankConnections.householdId, householdId),
					inArray(bankConnections.status, ["choosing", "importing"]),
				),
			)
			.limit(1),
	]);
	return {
		importIds: rows.filter((row) => row.status === "imported").map((row) => row.id),
		arriving: busy.length > 0 || rows.some((row) => row.status === "processing"),
	};
}
