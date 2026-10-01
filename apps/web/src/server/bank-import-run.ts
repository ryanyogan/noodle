import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import {
	type BankConnectionToImport,
	type BankProvider,
	type Db,
	loadBankConnectionToImport,
	markBankConnectionReconnect,
	markBankImportFailed,
	refreshBankBalances,
	saveBankImport,
	saveBankNotice,
	syncBankLines,
	type Viewer,
} from "@noodle/db";
import type { BankLine, Cents } from "@noodle/domain";
import type { HouseholdChange } from "../household-changes";
import { type BankConnectionProvider, BankProviderError } from "./bank-connection";

// The Import Workflow, one instance per Bank Connection and run: when a Parent connects one, when
// its provider says it has news (a webhook), and daily. Each round reads what the provider has
// since the Bank Connection's cursor and syncs each Account with it (syncBankLines): new lines
// come in as one Import per Account (source "bank", keyed by the bank's ID for each line, so
// nothing lands twice), changed ones are changed in place (a pending charge's posted copy takes
// over its row), and dropped ones go. Then the cursor moves on. While the provider is still
// gathering history it waits a minute and reads again; once it has all, each Account's balance is
// refreshed, and each Import is categorized and the first Plan drafted, as after a statement
// upload. Every step is retried on its own, with backoff; a Bank Connection whose reads keep
// failing is marked failed, and one whose credential has lapsed waits for a Parent to reconnect.

export type BankImportParams = {
	householdId: string;
	connectionId: string;
	timeZone: string;
	/** Tells this run's instance apart from the Bank Connection's others. */
	runId: string;
};

/** A new instance for each run; the same queue message delivered twice is the same instance. */
export const bankImportInstanceId = (connectionId: string, runId: string) =>
	`bank-import-${connectionId}-${runId}`;

export type BankImportDeps = {
	db: Db;
	/** The provider a Bank Connection reads through (Plaid); throws if it's not set up. */
	providerFor: (provider: BankProvider) => BankConnectionProvider;
	/** The Bank Connection's credential, in the clear. */
	openCredential: (connection: BankConnectionToImport) => Promise<string>;
	/** Files an Import's Transactions for the Parent who connected; never throws. */
	categorize: (viewer: Viewer, importId: string) => Promise<void>;
	/** Drafts the first Plan from the new history; never throws. */
	draftPlan: (viewer: Viewer, timeZone: string) => Promise<void>;
	notify: (householdId: string, changes: HouseholdChange[]) => Promise<void>;
	newId: () => string;
};

/** The steps the Workflow uses, so tests and E2E's fakes can run it inline. */
export type BankImportStep = Pick<WorkflowStep, "do" | "sleep">;

/** A read from the provider, a few times over a few minutes: institutions have bad minutes. */
export const READ_STEP: WorkflowStepConfig = {
	retries: { limit: 4, delay: "30 seconds", backoff: "exponential" },
	timeout: "2 minutes",
};
const WRITE_STEP: WorkflowStepConfig = {
	retries: { limit: 3, delay: "10 seconds", backoff: "exponential" },
	timeout: "1 minute",
};

/** How many reads a run makes while the provider gathers history, a minute apart. */
export const MAX_ROUNDS = 10;

/**
 * One round's read: for each of the Bank Connection's Accounts, its lines and those dropped, with
 * the ID for an Import of any new ones; and, from the last round, each Account's balance.
 */
type Read = {
	from: string | null;
	to: string | null;
	complete: boolean;
	createdByMemberId: string;
	imports: { importId: string; accountId: string; lines: BankLine[]; removed: string[] }[];
	balances: { accountId: string; balanceId: string; amountCents: Cents }[];
};

export type BankImportResult =
	| "done"
	| "gone"
	| "overtaken"
	| "failed"
	| "reconnect"
	/** Its Parent hasn't chosen its Accounts yet (ADR-0020): nothing is read, so nothing is lost. */
	| "choosing";

export async function runBankImport(
	params: BankImportParams,
	step: BankImportStep,
	deps: BankImportDeps,
): Promise<BankImportResult> {
	const { db } = deps;
	const { householdId, connectionId } = params;
	const imported: string[] = [];
	let viewer: Viewer | null = null;
	try {
		for (let round = 1; round <= MAX_ROUNDS; round++) {
			// Import IDs are made inside the step, so a replayed run writes the same Imports.
			const read = await step.do(
				`read ${round}`,
				READ_STEP,
				async (): Promise<Read | "reconnect" | "choosing" | null> => {
					const connection = await loadBankConnectionToImport(db, householdId, connectionId);
					if (!connection) return null;
					if (connection.status === "choosing") return "choosing";
					const credential = await deps.openCredential(connection);
					const provider = deps.providerFor(connection.provider);
					try {
						return await readRound(deps, provider, connection, credential, round);
					} catch (error) {
						if (!(error instanceof BankProviderError)) throw error;
						// A refusal the provider explained: the Parent sees why, whether or not a retry works.
						if (error.notice) await saveBankNotice(db, householdId, connectionId, error.notice);
						// No retries: only a Parent logging in again fixes it.
						if (error.reconnect) return "reconnect";
						throw error;
					}
				},
			);
			if (!read) return "gone";
			if (read === "choosing") return "choosing";
			if (read === "reconnect") {
				await step.do("mark reconnect", WRITE_STEP, () =>
					markBankConnectionReconnect(db, householdId, connectionId),
				);
				await deps.notify(householdId, ["bank-connections"]);
				return "reconnect";
			}
			viewer = { householdId, memberId: read.createdByMemberId };

			const months = new Set<string>();
			for (const { importId, accountId, lines, removed } of read.imports) {
				const result = await step.do(`import ${round} ${accountId}`, WRITE_STEP, () =>
					syncBankLines(db, {
						householdId,
						connectionId,
						accountId,
						importId,
						lines,
						removed,
						createdByMemberId: read.createdByMemberId,
						newId: deps.newId,
					}),
				);
				if (!result) continue;
				if (result.importId) imported.push(result.importId);
				for (const month of result.months) months.add(month);
			}
			if (read.balances.length > 0) {
				await step.do(`balances ${round}`, WRITE_STEP, () =>
					refreshBankBalances(db, { householdId, connectionId, balances: read.balances }),
				);
			}

			// Ready after the last round even if the provider isn't: the next sync reads the rest.
			const last = read.complete || round === MAX_ROUNDS;
			const saved = await step.do(`save ${round}`, WRITE_STEP, () =>
				saveBankImport(db, {
					householdId,
					connectionId,
					from: read.from,
					to: read.to,
					status: last ? "ready" : "importing",
					// A read that worked: whatever the provider last asked the Parent to read is past.
					notice: null,
				}),
			);
			await deps.notify(householdId, [
				"bank-connections",
				"imports",
				...(read.balances.length > 0 ? (["goals"] as const) : []),
				...[...months].map((month) => `month:${month}` as HouseholdChange),
			]);
			// Another run moved the cursor first: it reads on from there.
			if (!saved) return "overtaken";
			if (last) break;
			await step.sleep(`wait ${round}`, "1 minute");
		}
	} catch (error) {
		// Out of retries: the Bank Connection says so, and the next run tries again.
		console.error(`Couldn’t import Bank Connection ${connectionId}`, error);
		await step.do("mark failed", WRITE_STEP, () =>
			markBankImportFailed(db, householdId, connectionId),
		);
		await deps.notify(householdId, ["bank-connections"]);
		return "failed";
	}

	// New history, wherever it came from, is categorized and may draft the first Plan.
	if (viewer && imported.length > 0) {
		const who = viewer;
		for (const importId of imported) {
			await step.do(`categorize ${importId}`, () => deps.categorize(who, importId));
		}
		await step.do("draft Plan", () => deps.draftPlan(who, params.timeZone));
	}
	return "done";
}

/** One round's read from the provider, sorted by Account; balances once it has all. */
async function readRound(
	deps: BankImportDeps,
	provider: BankConnectionProvider,
	connection: BankConnectionToImport,
	credential: string,
	round: number,
): Promise<Read> {
	const changes = await provider.changes(credential, connection.cursor);
	const last = changes.complete || round === MAX_ROUNDS;
	const reported = last ? await provider.accounts(credential) : [];
	return {
		from: connection.cursor,
		to: changes.cursor,
		complete: changes.complete,
		createdByMemberId: connection.createdByMemberId,
		imports: connection.accounts.flatMap(({ id, externalId }) => {
			const lines = changes.lines.filter((line) => line.accountExternalId === externalId);
			// A dropped line the provider didn't place could be any Account's.
			const removed = (changes.removed ?? [])
				.filter((line) => line.accountExternalId === externalId || line.accountExternalId === "")
				.map((line) => line.bankId);
			return lines.length > 0 || removed.length > 0
				? [{ importId: deps.newId(), accountId: id, lines, removed }]
				: [];
		}),
		balances: connection.accounts.flatMap(({ id, externalId }) => {
			const balance = reported.find((account) => account.externalId === externalId)?.balance;
			return balance == null
				? []
				: [{ accountId: id, balanceId: deps.newId(), amountCents: balance }];
		}),
	};
}

/** A step that runs each callback at once, once, and doesn't wait: an Import inline, for E2E's fakes. */
export const inlineStep: BankImportStep = {
	do: ((_name: string, configOrFn: unknown, fn?: unknown) =>
		(typeof configOrFn === "function"
			? configOrFn
			: (fn as () => unknown))()) as BankImportStep["do"],
	sleep: async () => {},
};
