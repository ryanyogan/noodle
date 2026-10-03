import {
	type ClearLevel,
	clearHouseholdRows,
	type Db,
	learnedMerchants,
	linkedBankConnectionIds,
	removeBankConnection,
} from "@noodle/db";
import type { BankConnectionProvider } from "./bank-connection";
import { disconnectBankConnection } from "./bank-disconnect";
import { vectorId } from "./categorize-model";

// Clearing a Household's data from every store (#63, ADR-0029), one step at a time so the Fresh
// start Workflow can retry each and report progress. Every step is idempotent: run again, it finds
// less (or nothing) to clear.

export type ClearDeps = {
	db: Db;
	/** The STATEMENTS bucket: statements, Receipts and downloads. */
	files: Pick<R2Bucket, "list" | "delete">;
	/** The MERCHANTS index. */
	merchants: { deleteByIds(ids: string[]): Promise<unknown> };
	/** The Household's Agent. */
	agent: (householdId: string) => { clearHousehold(): Promise<void> };
	/** Plaid, to remove each link; null where banks aren't set up (local, tests without Plaid). */
	bank: {
		providerFor: (provider: "plaid") => BankConnectionProvider | null;
		openCredential: (connection: { id: string; credential: string }) => Promise<string>;
	} | null;
};

/**
 * The steps, in order. Banks first, while the tokens are still in D1: once removed, a running
 * Import stops at its next round and no webhook brings in more. Then the Agent's held Nudges and
 * background AI. Merchants before rows, since their vector IDs come from the Transactions.
 */
export const CLEAR_STEPS = [
	{ key: "banks", label: "Disconnecting banks" },
	{ key: "background", label: "Stopping background work" },
	{ key: "merchants", label: "Forgetting merchants" },
	{ key: "files", label: "Clearing statements and receipts" },
	{ key: "rows", label: "Clearing Transactions and the Plan" },
] as const;

export type ClearStep = (typeof CLEAR_STEPS)[number]["key"];

/** Where the Household's files live in R2: statements, Receipts' emails, and downloads. */
export const filePrefixes = (householdId: string) => [
	`${householdId}/`,
	`receipts/${householdId}/`,
	`exports/${householdId}/`,
];

/** Vectorize deletes at most this many IDs at once; R2 too. */
const PAGE = 1000;

async function removeBanks(deps: ClearDeps, householdId: string) {
	for (const connectionId of await linkedBankConnectionIds(deps.db, householdId)) {
		if (!deps.bank) {
			await removeBankConnection(deps.db, householdId, connectionId);
			continue;
		}
		const result = await disconnectBankConnection(
			{ db: deps.db, ...deps.bank },
			{ householdId, connectionId },
		);
		// The bank didn't answer: retried, and nothing is cleared until every link is removed.
		if (!result.ok && result.reason === "bank") throw new Error("Couldn’t disconnect a bank");
	}
}

/** The Household's files, or only those uploaded before `before` (the sweep after a clear). */
async function clearFiles(deps: ClearDeps, householdId: string, before?: Date) {
	for (const prefix of filePrefixes(householdId)) {
		let cursor: string | undefined;
		for (;;) {
			const page = await deps.files.list({ prefix, limit: PAGE, cursor });
			const keys = page.objects
				.filter((object) => !before || object.uploaded < before)
				.map((object) => object.key);
			if (keys.length > 0) await deps.files.delete(keys);
			if (!page.truncated) break;
			cursor = page.cursor;
		}
	}
}

async function forgetMerchants(deps: ClearDeps, householdId: string) {
	const merchants = await learnedMerchants(deps.db, householdId);
	const ids = await Promise.all(merchants.map((merchant) => vectorId(householdId, merchant)));
	for (let i = 0; i < ids.length; i += PAGE)
		await deps.merchants.deleteByIds(ids.slice(i, i + PAGE));
}

export async function runClearStep(
	deps: ClearDeps,
	step: ClearStep,
	householdId: string,
	level: ClearLevel,
	/** Files only: keep what was uploaded at or after this. */
	before?: Date,
): Promise<void> {
	if (step === "banks") await removeBanks(deps, householdId);
	else if (step === "background") await deps.agent(householdId).clearHousehold();
	else if (step === "merchants") await forgetMerchants(deps, householdId);
	else if (step === "files") await clearFiles(deps, householdId, before);
	else await clearHouseholdRows(deps.db, householdId, level);
}

/** Every step: what the Workflow does, without its waits, progress and sweep. */
export async function clearHousehold(deps: ClearDeps, householdId: string, level: ClearLevel) {
	for (const { key } of CLEAR_STEPS) await runClearStep(deps, key, householdId, level);
}

/** The Agent's part: its held Nudges, background AI, model budget and alarm all go. */
export async function clearAgentStorage(
	storage: Pick<DurableObjectStorage, "deleteAlarm" | "deleteAll">,
) {
	await storage.deleteAlarm();
	await storage.deleteAll();
}
