import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import {
	type Db,
	loadSetupHistory,
	resetSetupJobs,
	type SetupJobStatus,
	saveSetupJob,
	type Viewer,
} from "@noodle/db";
import type { HouseholdChange } from "../household-changes";
import { SETUP_JOBS, type SetupJobKey } from "../setup";

// The Setup Workflow (#53), apart from the Worker so unit tests can run it with fakes: one
// instance per Household, started when the get-started wizard's Hello chooses a bank or a
// statement. It waits for the first history to land (a Bank Connection's Import, or a statement),
// then files it (the same pipeline as after any Import) and drafts the first Plan from it. Each
// job writes its status to D1 and tells the Household's screens (ADR-0007), so the wizard can say
// "2 of 3 done" while the Parent keeps going. Every job is idempotent: a replayed step, or the
// Import pipeline having done the same already, changes nothing.

export type SetupParams = {
	householdId: string;
	/** The Parent who started setup: history is filed and read as them (ADR-0003). */
	memberId: string;
	timeZone: string;
};

/** One instance per Household: starting it again finds the one already there. */
export const setupInstanceId = (householdId: string) => `setup-${householdId}`;

export type SetupDeps = {
	db: Db;
	/** Files an Import's Transactions for the Viewer; never throws. */
	categorize: (viewer: Viewer, importId: string) => Promise<void>;
	/** Drafts the first Plan from the history; never throws. */
	draftPlan: (viewer: Viewer, timeZone: string) => Promise<void>;
	notify: (householdId: string, changes: HouseholdChange[]) => Promise<void>;
	/** How long to wait between looks for history, and how many looks before giving up. */
	wait: { every: WorkflowSleepDuration; rounds: number };
};

type WorkflowSleepDuration = Parameters<WorkflowStep["sleep"]>[1];

export type SetupStep = Pick<WorkflowStep, "do" | "sleep">;

const WRITE_STEP: WorkflowStepConfig = {
	retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
	timeout: "1 minute",
};

/** A day of looking, every 30 seconds: a bank can take a while to gather history. */
export const WORKFLOW_WAIT: SetupDeps["wait"] = { every: "30 seconds", rounds: 2880 };

export type SetupResult = "done" | "no-history";

export async function runSetup(
	params: SetupParams,
	step: SetupStep,
	deps: SetupDeps,
): Promise<SetupResult> {
	const { db, notify } = deps;
	const { householdId, memberId, timeZone } = params;
	const viewer: Viewer = { householdId, memberId };
	const mark = async (job: SetupJobKey, status: SetupJobStatus) => {
		await step.do(`${job} ${status}`, WRITE_STEP, () => saveSetupJob(db, householdId, job, status));
		await notify(householdId, ["setup"]);
	};

	await step.do("start", WRITE_STEP, () => resetSetupJobs(db, householdId, [...SETUP_JOBS]));
	await mark("history", "running");

	// Wait until something has landed and nothing more is on its way.
	let importIds: string[] | null = null;
	for (let round = 1; round <= deps.wait.rounds; round++) {
		const history = await step.do(`look ${round}`, WRITE_STEP, () =>
			loadSetupHistory(db, householdId),
		);
		if (history.importIds.length > 0 && !history.arriving) {
			importIds = history.importIds;
			break;
		}
		if (round < deps.wait.rounds) await step.sleep(`wait ${round}`, deps.wait.every);
	}
	if (!importIds) {
		for (const job of SETUP_JOBS) await mark(job, "skipped");
		return "no-history";
	}
	await mark("history", "done");

	await mark("categorize", "running");
	for (const importId of importIds) {
		await step.do(`categorize ${importId}`, () => deps.categorize(viewer, importId));
	}
	await mark("categorize", "done");

	await mark("draft", "running");
	await step.do("draft Plan", () => deps.draftPlan(viewer, timeZone));
	await mark("draft", "done");
	return "done";
}
