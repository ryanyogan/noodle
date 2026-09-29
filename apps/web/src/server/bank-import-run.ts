import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import {
	type BankConnectionToImport,
	type BankProvider,
	type Db,
	importStatement,
	loadBankConnectionToImport,
	markBankImportFailed,
	saveBankImport,
	saveBankNotice,
	type Viewer,
} from "@noodle/db";
import type { StatementLine } from "@noodle/domain";
import type { HouseholdChange } from "../household-changes";
import { type BankConnectionProvider, BankProviderError } from "./bank-connection";

// The Import Workflow, one instance per Bank Connection and run: when a Parent connects one today
// (and on each sync, #17). Each round reads what the provider has posted since the Bank
// Connection's cursor, brings it in as one Import per Account (importStatement, source "bank",
// keyed by the bank's ID for each line, so nothing lands twice), then moves the cursor on. While
// the provider is still gathering history it waits a minute and reads again. Once it has all, each
// Import is categorized and the first Plan drafted, as after a statement upload. Every step is
// retried on its own; a Bank Connection whose reads keep failing is marked failed.

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
	/** The provider a Bank Connection reads through (Plaid or SimpleFIN); throws if it's not set up. */
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

/** One round's read: the lines for each of the Bank Connection's Accounts, with their Import's ID. */
type Read = {
	from: string | null;
	to: string | null;
	complete: boolean;
	notice: string | null;
	createdByMemberId: string;
	imports: { importId: string; accountId: string; lines: StatementLine[] }[];
};

export type BankImportResult = "done" | "gone" | "overtaken" | "failed";

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
			const read = await step.do(`read ${round}`, READ_STEP, async (): Promise<Read | null> => {
				const connection = await loadBankConnectionToImport(db, householdId, connectionId);
				if (!connection) return null;
				const credential = await deps.openCredential(connection);
				const provider = deps.providerFor(connection.provider);
				const changes = await provider
					.changes(credential, connection.cursor)
					.catch(async (error) => {
						// A refusal the provider explained: the Parent sees why, whether or not a retry works.
						if (error instanceof BankProviderError && error.notice) {
							await saveBankNotice(db, householdId, connectionId, error.notice);
						}
						throw error;
					});
				return {
					from: connection.cursor,
					to: changes.cursor,
					complete: changes.complete,
					notice: changes.notice ?? null,
					createdByMemberId: connection.createdByMemberId,
					imports: connection.accounts.flatMap(({ id, externalId }) => {
						const lines = changes.lines
							.filter((line) => line.accountExternalId === externalId)
							.map(({ date, amount, description, bankId }) => ({
								date,
								amount,
								description,
								bankId,
							}));
						return lines.length > 0 ? [{ importId: deps.newId(), accountId: id, lines }] : [];
					}),
				};
			});
			if (!read) return "gone";
			viewer = { householdId, memberId: read.createdByMemberId };

			const months = new Set<string>();
			for (const { importId, accountId, lines } of read.imports) {
				const result = await step.do(`import ${round} ${accountId}`, WRITE_STEP, async () => {
					const written = await importStatement(db, {
						householdId,
						importId,
						accountId,
						source: "bank",
						fileName: null,
						fileKey: null,
						bankConnectionId: connectionId,
						lines,
						closingBalance: null,
						csvMapping: null,
						createdByMemberId: read.createdByMemberId,
						newId: deps.newId,
					});
					return written.ok ? { months: written.months } : null;
				});
				if (!result) continue;
				imported.push(importId);
				for (const month of result.months) months.add(month);
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
					notice: read.notice,
				}),
			);
			await deps.notify(householdId, [
				"bank-connections",
				"imports",
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

/** A step that runs each callback at once, once, and doesn't wait: an Import inline, for E2E's fakes. */
export const inlineStep: BankImportStep = {
	do: ((_name: string, configOrFn: unknown, fn?: unknown) =>
		(typeof configOrFn === "function"
			? configOrFn
			: (fn as () => unknown))()) as BankImportStep["do"],
	sleep: async () => {},
};
