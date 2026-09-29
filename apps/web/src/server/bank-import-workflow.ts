import { env, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createDb, type Db } from "@noodle/db";
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

// The Import Workflow's Worker side: the class the Worker exports, and starting a run when the
// ingest Queue says a Bank Connection has something to read. The logic is runBankImport.

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
			console.error("Bank Connections aren’t set up: no BANK_CONNECTION_KEY secret");
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
