import { env, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
	type ClearLevel,
	finishFreshStart,
	listHouseholdSnapshots,
	loadFreshStart,
	setFreshStartProgress,
	startFreshStartRun,
} from "@noodle/db";
import { openCredential } from "./bank-credential";
import { bankSetup, providerFor } from "./bank-setup";
import { getDb } from "./db";
import { CLEAR_STEPS, type ClearDeps, runClearStep } from "./fresh-start-clear";
import { newestMigration, takeFinalSnapshot, takeSnapshot } from "./snapshot-store";

// The Fresh start Workflow (#63, ADR-0029): waits out the grace period, then clears the Household
// a step at a time, each retried, telling open screens how far it has got through the Agent, and
// two minutes later sweeps files uploaded before the clear finished.

export type FreshStartParams = {
	id: string;
	householdId: string;
	level: ClearLevel;
	/** Delete Household only: the Parent ticked "Also delete backups", so no last snapshot is kept. */
	deleteBackups?: boolean;
};

/** What open screens are told as it goes ("Clearing Transactions and the Plan… 5 of 6"). */
export type FreshStartProgress = {
	id: string;
	level: ClearLevel;
	/** `cleared` once everything is gone (the fresh start is done then); `done` when the screen found it gone. */
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
		backups: env.BACKUPS,
		// Under AI_MODEL=stub (dev and E2E) background AI learns nothing into the index (its
		// stand-in keeps no vectors), so there is nothing to forget, and the index is remote.
		merchants: __AI_STUB__
			? { deleteByIds: async () => undefined }
			: (env.MERCHANTS as unknown as Vectorize),
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
		const { id, householdId, level, deleteBackups } = event.payload;
		const runAt = await step.do("read the schedule", async () => {
			const freshStart = await loadFreshStart(getDb(), id);
			return freshStart?.status === "scheduled" ? freshStart.runAt.getTime() : null;
		});
		if (runAt === null) return "cancelled";
		// Either Parent may cancel meanwhile. A time already past goes straight on (sleepUntil
		// refuses one: "You can't sleep until a time in the past").
		if (runAt > Date.now()) await step.sleepUntil("wait out the grace period", new Date(runAt));
		if (!(await step.do("start", () => startFreshStartRun(getDb(), id)))) return "cancelled";
		// A Fresh start can be undone: a snapshot first, under the fresh start's own id so a retried
		// step doesn't take a second (ADR-0035).
		if (level === "fresh-start") {
			await step.do("take a snapshot first", RETRY, async () => {
				const db = getDb();
				if ((await listHouseholdSnapshots(db, householdId)).some((snap) => snap.id === id)) return;
				await takeSnapshot(
					{ db, bucket: env.BACKUPS, migration: await newestMigration(env.DB) },
					{ householdId, kind: "before-fresh-start", now: new Date(), id },
				);
			});
		}
		// Delete Household keeps one last snapshot for 30 days, outside the Household's own prefix
		// (which the clear empties), unless the Parent ticked "Also delete backups". The same key on
		// a retry, so it is written over, not doubled.
		if (level === "delete" && !deleteBackups) {
			await step.do("keep one last snapshot", RETRY, async () => {
				await takeFinalSnapshot(
					{ db: getDb(), bucket: env.BACKUPS, migration: await newestMigration(env.DB) },
					{ householdId, now: new Date(), id },
				);
			});
		}
		const steps = CLEAR_STEPS.length + 1;
		for (const [i, { key, label }] of CLEAR_STEPS.entries()) {
			await step.do(label, RETRY, async () => {
				await report(householdId, { id, level, state: "running", step: i + 1, steps, label });
				await runClearStep(clearDeps(householdId), key, householdId, level);
			});
		}
		// Done at "cleared": the Parent can set up again at once. Work already running for the
		// Household stops before its next write, since it began before this finished (clearedSince).
		const clearedAt = await step.do("cleared", async () => {
			const now = Date.now();
			await finishFreshStart(getDb(), id, now);
			await report(householdId, { id, level, state: "cleared", step: steps, steps, label: null });
			return now;
		});
		// Files that work uploaded just before it stopped go too; nothing uploaded after the clear
		// (a new statement, a download) is touched. D1, the merchants index and the Agent's storage
		// aren't swept: they can't tell what came after, and work running checks before writing.
		await step.sleep("let work already running finish", "2 minutes");
		await step.do("sweep", RETRY, () =>
			runClearStep(clearDeps(householdId), "files", householdId, level, new Date(clearedAt)),
		);
		return "done";
	}
}
