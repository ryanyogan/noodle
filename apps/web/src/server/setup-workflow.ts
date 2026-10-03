import {
	env,
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
	waitUntil,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { createDb, type Db } from "@noodle/db";
import { categorizeImported } from "./categorize";
import { clearedCheck, isClearedSince, stopIfCleared } from "./cleared-since";
import { getDb } from "./db";
import { notifyHousehold } from "./notify";
import { draftPlan } from "./plan-draft-after-import";
import {
	runSetup,
	type SetupDeps,
	type SetupParams,
	type SetupStep,
	setupInstanceId,
	WORKFLOW_WAIT,
} from "./setup-run";

// The Setup Workflow's Worker side: the class the Worker exports, and starting it once per
// Household. The logic is runSetup.

const setupDeps = (db: Db, wait: SetupDeps["wait"]): SetupDeps => ({
	db,
	categorize: categorizeImported,
	draftPlan,
	notify: notifyHousehold,
	wait,
});

export class SetupWorkflow extends WorkflowEntrypoint<Env, SetupParams> {
	override async run(event: Readonly<WorkflowEvent<SetupParams>>, step: WorkflowStep) {
		const db = createDb(this.env.DB);
		const cleared = clearedCheck(db, event.payload.householdId, event.timestamp);
		try {
			await runSetup(
				event.payload,
				stopIfCleared(step, cleared, (message) => new NonRetryableError(message)),
				setupDeps(db, WORKFLOW_WAIT),
			);
		} catch (error) {
			if (!isClearedSince(error)) throw error;
		}
	}
}

/**
 * With the fakes (AI_MODEL=stub), a step that runs each callback at once and sleeps for real but
 * briefly, after the response has gone: E2E sees the jobs finish within seconds of an upload.
 */
const stubStep: SetupStep = {
	do: ((_name: string, configOrFn: unknown, fn?: unknown) =>
		(typeof configOrFn === "function" ? configOrFn : (fn as () => unknown))()) as SetupStep["do"],
	sleep: () => new Promise((resolve) => setTimeout(resolve, 1000)),
};

/** Households whose stub run is going, so starting again doesn't run it twice. */
const stubRuns = new Set<string>();

/** Starts the Household's Setup Workflow, once: starting it again finds it already there. */
export async function startSetupWorkflow(params: SetupParams): Promise<void> {
	if (__AI_STUB__) {
		if (stubRuns.has(params.householdId)) return;
		stubRuns.add(params.householdId);
		waitUntil(
			runSetup(params, stubStep, setupDeps(getDb(), { every: "1 second", rounds: 120 }))
				.catch((error) => console.error("Couldn’t run setup", error))
				.finally(() => stubRuns.delete(params.householdId)),
		);
		return;
	}
	// createBatch skips an instance that already exists, where create would throw.
	await env.SETUP.createBatch([{ id: setupInstanceId(params.householdId, params.run), params }]);
}
