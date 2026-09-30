import { env, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createDb, type Db, loadBankConnectionsToSync } from "@noodle/db";
import { ulid } from "ulid";
import { openCredential } from "./bank-credential";
import {
	type BankImportDeps,
	type BankImportParams,
	bankImportInstanceId,
	inlineStep,
	runBankImport,
} from "./bank-import-run";
import { type BankSetup, bankSetup, providerFor } from "./bank-setup";
import { categorizeImported } from "./categorize";
import { getDb } from "./db";
import { notifyHousehold } from "./notify";
import { draftPlan } from "./plan-draft-after-import";

// The Import Workflow's Worker side: the class the Worker exports, starting a run when the ingest
// Queue says a Bank Connection has something to read, and the daily sync that puts each one
// there. The logic is runBankImport.

/** A Bank Connection to read, waiting on the ingest Queue. */
export type BankImportMessage = { kind: "bank-import" } & BankImportParams;

function importDeps(db: Db, setup: BankSetup): BankImportDeps {
	return {
		db,
		providerFor: (provider) => {
			const found = providerFor(setup, provider);
			if (!found) throw new Error(`Bank Connections through ${provider} aren’t set up`);
			return found;
		},
		openCredential: async ({ householdId, id, credential }) =>
			openCredential(await setup.key(), credential, { householdId, connectionId: id }),
		categorize: categorizeImported,
		draftPlan,
		notify: notifyHousehold,
		newId: ulid,
	};
}

export class ImportWorkflow extends WorkflowEntrypoint<Env, BankImportParams> {
	override async run(event: Readonly<WorkflowEvent<BankImportParams>>, step: WorkflowStep) {
		const setup = bankSetup();
		if (!setup) {
			console.error(
				"Bank Connections aren’t set up: Plaid’s secrets or BANK_CONNECTION_KEY are missing",
			);
			return;
		}
		await runBankImport(event.payload, step, importDeps(createDb(this.env.DB), setup));
	}
}

/**
 * Starts the Import Workflow for a Bank Connection, once per run: the same queue message again
 * finds its instance already there. With the fakes (AI_MODEL=stub) it runs inline, so E2E sees
 * the Transactions as soon as the ingest Queue has the message.
 */
export async function startBankImport({ kind: _, ...params }: BankImportMessage): Promise<void> {
	const setup = bankSetup();
	if (!setup) return;
	if (__AI_STUB__) {
		await runBankImport(params, inlineStep, importDeps(getDb(), setup));
		return;
	}
	// createBatch skips an instance that already exists, where create would throw.
	await env.IMPORT.createBatch([
		{ id: bankImportInstanceId(params.connectionId, params.runId), params },
	]);
}

/**
 * The daily sync: every Bank Connection not waiting on a reconnect goes on the ingest Queue, so
 * Accounts stay current even when no webhook came. One run per Bank Connection per day, however
 * often the cron fires.
 */
export async function startBankSyncs(now: Date): Promise<void> {
	if (!bankSetup()) return;
	const runId = `daily-${now.toISOString().slice(0, 10)}`;
	const messages = (await loadBankConnectionsToSync(getDb())).map(
		({ householdId, connectionId, timeZone }) => ({
			body: { kind: "bank-import", householdId, connectionId, timeZone, runId } as const,
		}),
	);
	for (let i = 0; i < messages.length; i += 100) {
		await env.INGEST_QUEUE.sendBatch(messages.slice(i, i + 100));
	}
}
