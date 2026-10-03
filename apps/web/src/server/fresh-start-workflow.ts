import { env, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
	type ClearLevel,
	finishFreshStart,
	loadFreshStart,
	setFreshStartProgress,
	startFreshStartRun,
} from "@noodle/db";
import { openCredential } from "./bank-credential";
import { bankSetup, providerFor } from "./bank-setup";
import { getDb } from "./db";
import { CLEAR_STEPS, type ClearDeps, runClearStep, SWEEP_STEPS } from "./fresh-start-clear";

// The Fresh start Workflow (#63, ADR-0029): waits out the grace period, then clears the Household
// a step at a time, each retried, telling open screens how far it has got through the Agent.

export type FreshStartParams = { id: string; householdId: string; level: ClearLevel };

/** What open screens are told as it goes ("Clearing Transactions and the Plan… 5 of 6"). */
export type FreshStartProgress = {
	id: string;
	level: ClearLevel;
	/** `cleared` once everything is gone; `done` after the sweep two minutes later. */
	state: "running" | "cleared" | "done";
	step: number;
	steps: number;
	label: string | null;
};

const RETRY = {
	retries: { limit: 5, delay: "30 seconds" as const, backoff: "exponential" as const },
};

export function clearDeps(householdId: string): ClearDeps {
	const setup = bankSetup();
	return {
		db: getDb(),
		files: env.STATEMENTS,
		merchants: env.MERCHANTS as unknown as Vectorize,
		agent: (id) => env.HOUSEHOLD_AGENT.getByName(id),
		bank: setup
			? {
					providerFor: (provider) => providerFor(setup, provider),
					openCredential: async (connection) =>
						openCredential(await setup.key(), connection.credential, {
							householdId,
							connectionId: connection.id,
						}),
				}
			: null,
	};
}

async function report(householdId: string, progress: FreshStartProgress) {
	if (progress.state === "running") await setFreshStartProgress(getDb(), progress.id, progress);
	try {
		await env.HOUSEHOLD_AGENT.getByName(householdId).freshStartProgress(progress);
	} catch (error) {
		console.error("Couldn’t tell the Household Agent", error);
	}
}

export class FreshStartWorkflow extends WorkflowEntrypoint<Env, FreshStartParams> {
	override async run(event: Readonly<WorkflowEvent<FreshStartParams>>, step: WorkflowStep) {
		const { id, householdId, level } = event.payload;
		const runAt = await step.do("read the schedule", async () => {
			const freshStart = await loadFreshStart(getDb(), id);
			return freshStart?.status === "scheduled" ? freshStart.runAt.getTime() : null;
		});
		if (runAt === null) return "cancelled";
		// Either Parent may cancel meanwhile. A time already past goes straight on (sleepUntil
		// refuses one: "You can't sleep until a time in the past").
		if (runAt > Date.now()) await step.sleepUntil("wait out the grace period", new Date(runAt));
		if (!(await step.do("start", () => startFreshStartRun(getDb(), id)))) return "cancelled";
		const steps = CLEAR_STEPS.length + 1;
		for (const [i, { key, label }] of CLEAR_STEPS.entries()) {
			await step.do(label, RETRY, async () => {
				await report(householdId, { id, level, state: "running", step: i + 1, steps, label });
				await runClearStep(clearDeps(householdId), key, householdId, level);
			});
		}
		await step.do("cleared", () =>
			report(householdId, { id, level, state: "cleared", step: steps, steps, label: null }),
		);
		// Workflows already running for the Household (month close, Perk research, Setup, a
		// download, background AI) find nothing to work on now; anything they wrote meanwhile goes.
		await step.sleep("let work already running finish", "2 minutes");
		await step.do("sweep", RETRY, async () => {
			await report(householdId, {
				id,
				level,
				state: "running",
				step: steps,
				steps,
				label: "Finishing up",
			});
			for (const key of SWEEP_STEPS)
				await runClearStep(clearDeps(householdId), key, householdId, level);
		});
		await step.do("done", async () => {
			if (level === "fresh-start") await finishFreshStart(getDb(), id, Date.now());
			await report(householdId, { id, level, state: "done", step: steps, steps, label: null });
		});
		return "done";
	}
}
