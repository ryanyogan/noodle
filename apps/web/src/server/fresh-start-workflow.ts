import { env, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
	type ClearLevel,
	failFreshStart,
	finishFreshStart,
	freshStartCarriesOn,
	freshStartRunPlan,
	learnedMerchants,
	listHouseholdSnapshots,
	loadFreshStart,
	setFreshStartProgress,
	stampFreshStart,
	startFreshStartRun,
} from "@noodle/db";
import { merchantKey } from "@noodle/domain";
import { openCredential } from "./bank-credential";
import { bankSetup, providerFor } from "./bank-setup";
import { getDb } from "./db";
import { fileHolds } from "./file-holds";
import { CLEAR_STEPS, type ClearDeps, runClearStep } from "./fresh-start-clear";
import { SNAPSHOT_STEP } from "./fresh-start-trouble";
import { notifyHousehold } from "./notify";
import { newestMigration, takeFinalSnapshot, takeSnapshotAndTell } from "./snapshot-store";

// The Fresh start Workflow (#63, ADR-0029): waits out the grace period, then clears the Household
// a step at a time, each retried, telling open screens how far it has got through the Agent, and
// two minutes later sweeps files uploaded before the clear finished.

export type FreshStartParams = {
	id: string;
	householdId: string;
	level: ClearLevel;
	/** Delete Household only: the Parent ticked "Also delete the last snapshot", so no last snapshot is kept. */
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

// Five retries, 30 seconds doubling: 15½ minutes of waiting before a step is given up and the
// request marked failed. STUCK_AFTER_MS in @noodle/db is reckoned from these numbers.
const RETRY = __AI_STUB__
	? { retries: { limit: 1, delay: "1 second" as const, backoff: "constant" as const } }
	: { retries: { limit: 5, delay: "30 seconds" as const, backoff: "exponential" as const } };

/**
 * E2E only (a build made with AI_MODEL=stub): a Household with a Transaction whose note is this
 * fails "Forgetting merchants" on its first run, so the browser test can see a failed clear and
 * try again. The bundler drops it from production's build.
 */
export const E2E_FAILING_NOTE = "Make the clear fail";

/** What the Workflow returns when its request is cancelled, done, gone or another run's. */
const NOT_MINE = "cancelled";

export function clearDeps(householdId: string): ClearDeps {
	const setup = bankSetup();
	return {
		db: getDb(),
		files: env.STATEMENTS,
		backups: env.BACKUPS,
		holds: fileHolds({ db: getDb(), backups: env.BACKUPS }),
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
	if (progress.state === "running")
		await setFreshStartProgress(getDb(), progress.id, progress, Date.now());
	try {
		await env.HOUSEHOLD_AGENT.getByName(householdId).freshStartProgress(progress);
	} catch (error) {
		console.error("Couldn’t tell the Household Agent", error);
	}
}

export class FreshStartWorkflow extends WorkflowEntrypoint<Env, FreshStartParams> {
	override async run(event: Readonly<WorkflowEvent<FreshStartParams>>, step: WorkflowStep) {
		const { id, householdId, level } = event.payload;
		// This run. The first has the request's own id; Try again and "Start it now" hand the
		// request to a new one, and the old one stops before its next step (issue 118).
		const runId = event.instanceId;
		const begin = await step.do("read the schedule", async () => {
			const freshStart = await loadFreshStart(getDb(), id);
			return {
				plan: freshStartRunPlan(freshStart, runId),
				runAt: freshStart?.runAt.getTime() ?? 0,
			};
		});
		// (`!begin`: a run asleep since before issue 118 kept the old step's answer, null if cancelled.)
		if (!begin || begin.plan === "exit") return NOT_MINE;
		// Either Parent may cancel meanwhile. A time already past goes straight on (sleepUntil
		// refuses one: "You can't sleep until a time in the past"). A request found running or
		// failed doesn't wait: the run carries on with the clear.
		if (begin.plan === "wait" && begin.runAt > Date.now())
			await step.sleepUntil("wait out the grace period", new Date(begin.runAt));
		// How far an earlier run got (0: this is the first). Null: cancelled, done or not ours.
		const reached = await step.do("start", async () => {
			const db = getDb();
			if (!(await startFreshStartRun(db, id, { runId, now: Date.now() }))) return null;
			const freshStart = await loadFreshStart(db, id);
			return {
				step: freshStart?.step ?? 0,
				// What the Parent ticked, kept on the request so a later run knows it too.
				deleteBackups: freshStart?.deleteBackups ?? event.payload.deleteBackups ?? false,
			};
		});
		if (reached === null) return NOT_MINE;
		const deleteBackups = reached.deleteBackups || event.payload.deleteBackups === true;

		/**
		 * One retried step. False when the request is no longer this run's to clear (done, or
		 * handed to another run): the run then ends without touching anything more. When the step
		 * uses up its retries the request is marked failed at it, both Parents' screens are told,
		 * and the run ends in error; nothing after it is cleared until a Parent tries again.
		 */
		const attempt = async (name: string, key: string, work: () => Promise<void>) => {
			try {
				return await step.do(name, RETRY, async () => {
					const db = getDb();
					if (!freshStartCarriesOn(await loadFreshStart(db, id), runId)) return false;
					await work();
					return true;
				});
			} catch (error) {
				await step.do(`note that “${name}” failed`, async () => {
					if (await failFreshStart(getDb(), id, { step: key, now: Date.now(), runId }))
						await notifyHousehold(householdId, ["fresh-start"]);
				});
				throw error;
			}
		};

		// A Fresh start can be undone: a snapshot first, under the fresh start's own id so a retried
		// step (or a later run) doesn't take a second (ADR-0035).
		if (level === "fresh-start") {
			const went = await attempt("take a snapshot first", SNAPSHOT_STEP, async () => {
				const db = getDb();
				await stampFreshStart(db, id, Date.now());
				if ((await listHouseholdSnapshots(db, householdId)).some((snap) => snap.id === id)) return;
				// Told to the Household's open screens, so the history shows it for both Parents.
				await takeSnapshotAndTell(
					{ db, bucket: env.BACKUPS, migration: await newestMigration(env.DB) },
					{ householdId, kind: "before-fresh-start", now: new Date(), id },
					notifyHousehold,
				);
			});
			if (!went) return NOT_MINE;
		}
		// Delete Household keeps one last snapshot for 30 days, outside the Household's own prefix
		// (which the clear empties), unless the Parent ticked "Also delete the last snapshot". The same key on
		// a retry, so it is written over, not doubled.
		if (level === "delete" && !deleteBackups) {
			const went = await attempt("keep one last snapshot", SNAPSHOT_STEP, async () => {
				await stampFreshStart(getDb(), id, Date.now());
				await takeFinalSnapshot(
					{ db: getDb(), bucket: env.BACKUPS, migration: await newestMigration(env.DB) },
					{ householdId, now: new Date(), id },
				);
			});
			if (!went) return NOT_MINE;
		}
		const steps = CLEAR_STEPS.length + 1;
		for (const [i, { key, label }] of CLEAR_STEPS.entries()) {
			const went = await attempt(label, key, async () => {
				// A later run goes over the steps an earlier one finished: each is repeatable and
				// finds nothing left. It does so quietly, so progress never goes backwards.
				if (i + 1 >= reached.step)
					await report(householdId, { id, level, state: "running", step: i + 1, steps, label });
				else await stampFreshStart(getDb(), id, Date.now());
				if (
					__AI_STUB__ &&
					key === "merchants" &&
					runId === id &&
					(await learnedMerchants(getDb(), householdId)).includes(merchantKey(E2E_FAILING_NOTE))
				)
					throw new Error("E2E: this clear was made to fail");
				// Who asked, so the Log says who disconnected each Bank Connection.
				const by = key === "banks" ? (await loadFreshStart(getDb(), id))?.requestedBy : undefined;
				await runClearStep(clearDeps(householdId), key, householdId, level, undefined, by);
			});
			if (!went) return NOT_MINE;
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
