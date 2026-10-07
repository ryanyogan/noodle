import {
	type ClearLevel,
	clearHouseholdRows,
	type Db,
	learnedMerchants,
	linkedBankConnectionIds,
	removeBankConnection,
} from "@noodle/db";
import { splitFilesForClear } from "@noodle/domain";
import type { BankConnectionProvider } from "./bank-connection";
import { disconnectBankConnection } from "./bank-disconnect";
import { vectorId } from "./categorize-model";
import { snapshotPrefix } from "./snapshot-store";

// Clearing a Household's data from every store (#63, ADR-0029), one step at a time so the Fresh
// start Workflow can retry each and report progress. Every step is idempotent: run again, it finds
// less (or nothing) to clear.

export type ClearDeps = {
	db: Db;
	/** The STATEMENTS bucket: statements, Receipts and downloads. */
	files: Pick<R2Bucket, "list" | "delete">;
	/** The BACKUPS bucket, for the Household's snapshots (ADR-0035); a Delete Household removes them. */
	backups?: Pick<R2Bucket, "list" | "delete">;
	/**
	 * Files kept snapshots still refer to (ADR-0035): a clear leaves them, and notes them so the
	 * nightly run deletes them once no snapshot needs them. Absent, nothing is held.
	 */
	holds?: {
		/** The files the snapshots that outlive this clear refer to. */
		needed(householdId: string, level: ClearLevel): Promise<Set<string>>;
		/** Notes files a Fresh start left behind for its snapshots. */
		hold(householdId: string, keys: string[]): Promise<void>;
	};
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

/** R2 lists and deletes at most this many at once. */
const PAGE = 1000;
/** Vectorize deletes at most this many IDs at once ("max id count is 100"). */
export const VECTOR_PAGE = 100;

/** `memberId`: the Parent who asked for the clear, when known; the Log says who disconnected. */
async function removeBanks(deps: ClearDeps, householdId: string, memberId?: string) {
	for (const connectionId of await linkedBankConnectionIds(deps.db, householdId)) {
		if (!deps.bank) {
			await removeBankConnection(deps.db, householdId, connectionId, memberId);
			continue;
		}
		const result = await disconnectBankConnection(
			{ db: deps.db, ...deps.bank },
			{ householdId, connectionId, memberId },
		);
		// The bank didn't answer: retried, and nothing is cleared until every link is removed.
		if (!result.ok && result.reason === "bank") throw new Error("Couldn’t disconnect a bank");
	}
}

/** A deleted Household's snapshot files (ADR-0035): nothing of it is kept after Delete Household. */
async function clearSnapshotFiles(bucket: Pick<R2Bucket, "list" | "delete">, householdId: string) {
	for (;;) {
		const page = await bucket.list({ prefix: snapshotPrefix(householdId), limit: PAGE });
		const keys = page.objects.map((object) => object.key);
		if (keys.length > 0) await bucket.delete(keys);
		if (!page.truncated || keys.length === 0) break;
	}
}

/**
 * Deletes the Household's files, or only those uploaded before `before` (the sweep after a
 * clear), leaving the ones in `needed`. Returns the files it left for that reason.
 */
export async function clearHouseholdFiles(
	files: ClearDeps["files"],
	householdId: string,
	options: { before?: Date; needed?: ReadonlySet<string> } = {},
): Promise<string[]> {
	const needed = options.needed ?? new Set<string>();
	const held: string[] = [];
	for (const prefix of filePrefixes(householdId)) {
		let cursor: string | undefined;
		for (;;) {
			const page = await files.list({ prefix, limit: PAGE, cursor });
			const { hold, remove } = splitFilesForClear(
				page.objects
					.filter((object) => !options.before || object.uploaded < options.before)
					.map((object) => object.key),
				needed,
			);
			held.push(...hold);
			if (remove.length > 0) await files.delete(remove);
			if (!page.truncated) break;
			cursor = page.cursor;
		}
	}
	return held;
}

/**
 * The clear's files step. A file a snapshot that outlives the clear refers to stays (ADR-0035):
 * after a Fresh start, its own snapshots; after Delete Household, the one last snapshot, if kept.
 */
async function clearFiles(deps: ClearDeps, householdId: string, level: ClearLevel, before?: Date) {
	const needed = await deps.holds?.needed(householdId, level);
	const held = await clearHouseholdFiles(deps.files, householdId, { before, needed });
	// Delete Household keeps no list: its last snapshot's end takes every file left (the nightly
	// run), and the list would go with the Household's snapshots below anyway.
	if (level === "fresh-start" && held.length > 0) await deps.holds?.hold(householdId, held);
}

async function forgetMerchants(deps: ClearDeps, householdId: string) {
	const merchants = await learnedMerchants(deps.db, householdId);
	const ids = await Promise.all(merchants.map((merchant) => vectorId(householdId, merchant)));
	for (let i = 0; i < ids.length; i += VECTOR_PAGE)
		await deps.merchants.deleteByIds(ids.slice(i, i + VECTOR_PAGE));
}

export async function runClearStep(
	deps: ClearDeps,
	step: ClearStep,
	householdId: string,
	level: ClearLevel,
	/** Files only: keep what was uploaded at or after this. */
	before?: Date,
	/** Banks only: the Parent who asked for the clear, for the Log; left out, it says "Noodle". */
	memberId?: string,
): Promise<void> {
	if (step === "banks") await removeBanks(deps, householdId, memberId);
	else if (step === "background") await deps.agent(householdId).clearHousehold();
	else if (step === "merchants") await forgetMerchants(deps, householdId);
	else if (step === "files") {
		await clearFiles(deps, householdId, level, before);
		if (level === "delete" && deps.backups) await clearSnapshotFiles(deps.backups, householdId);
	} else await clearHouseholdRows(deps.db, householdId, level);
}

/** Every step: what the Workflow does, without its waits, progress and sweep. */
export async function clearHousehold(
	deps: ClearDeps,
	householdId: string,
	level: ClearLevel,
	memberId?: string,
) {
	for (const { key } of CLEAR_STEPS)
		await runClearStep(deps, key, householdId, level, undefined, memberId);
}

/** The Agent's part: its held Nudges, background AI, model budget and alarm all go. */
export async function clearAgentStorage(
	storage: Pick<DurableObjectStorage, "deleteAlarm" | "deleteAll">,
) {
	await storage.deleteAlarm();
	await storage.deleteAll();
}
