import {
	addAccount,
	createHouseholdForParent,
	type Db,
	importStatement,
	loadBankConnections,
	loadBankConnectionToImport,
	loadGoals,
} from "@noodle/db";
import { bankConnections, income, transactions } from "@noodle/db/schema";
import { testDb } from "@noodle/db/test-db";
import type { DayKey } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { applyBankChoices, bankChoices, connectInstitution } from "./bank-connect";
import { type BankConnectionProvider, BankProviderError } from "./bank-connection";
import { credentialKey, openCredential, TEST_CREDENTIAL_KEY } from "./bank-credential";
import {
	type BankImportDeps,
	type BankImportParams,
	bankImportInstanceId,
	inlineStep,
	runBankImport,
} from "./bank-import-run";
import { plaidProvider } from "./plaid";
import { fakePlaidTransport } from "./plaid-fake";

// The ingest seam for Bank Connections, end to end but for the Worker: a Parent's Plaid Link
// hand-off is connected (connectInstitution, as connectBank does), and the ingest Queue's message
// runs the Import Workflow (runBankImport, inline, as the consumer does with the fakes) against
// the fake Plaid API, then what landed is read back as the app reads it.

const householdId = "household";
const parentId = "parent";
const connectionId = "connection";
const today = "2026-09-20" as DayKey;

let db: Db;
let key: CryptoKey;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;

beforeEach(async () => {
	db = testDb();
	key = await credentialKey(TEST_CREDENTIAL_KEY);
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: "Alex",
	});
});

const plaid = () => plaidProvider(fakePlaidTransport(today));

/** Connects the fake Item and adds every account there as a new Account, as a Parent might. */
async function connect(
	provider: BankConnectionProvider = plaid(),
	id = connectionId,
	link: { token?: string; historyStart?: string } = {},
) {
	const connected = await connectInstitution(
		{ db, provider, key },
		{
			householdId,
			memberId: parentId,
			connectionId: id,
			handoff: {
				token: link.token ?? "public-fake-household",
				institution: "First Platypus Bank",
			},
			historyStart: link.historyStart,
		},
	);
	if (!connected.ok) return connected;
	const choices = await bankChoices(
		{ db, provider, key },
		{ householdId, connectionId: id, institution: "First Platypus Bank" },
	);
	const chosen = await applyBankChoices(
		{ db, provider, key, newId },
		{
			householdId,
			memberId: parentId,
			connectionId: id,
			choices: (choices?.accounts ?? []).map((a) => ({ externalId: a.externalId, choice: "new" })),
		},
	);
	return chosen.ok ? { ok: true, accounts: chosen.accounts } : chosen;
}

const params: BankImportParams = {
	householdId,
	connectionId,
	timeZone: "America/Chicago",
	runId: "run-1",
};

function deps(provider: BankConnectionProvider = plaid()) {
	const categorized: string[] = [];
	const drafted: string[] = [];
	const notified: string[][] = [];
	const importDeps: BankImportDeps = {
		db,
		providerFor: () => provider,
		openCredential: ({ householdId, id, credential }) =>
			openCredential(key, credential, { householdId, connectionId: id }),
		categorize: async (_viewer, importId) => {
			categorized.push(importId);
		},
		draftPlan: async (viewer) => {
			drafted.push(viewer.memberId);
		},
		notify: async (_householdId, changes) => {
			notified.push(changes);
		},
		newId,
	};
	return { importDeps, categorized, drafted, notified };
}

const landed = async () => ({
	transactions: (await db.select().from(transactions)).map((t) => t.note).sort(),
	income: (await db.select().from(income)).map((i) => i.note).sort(),
});

/** What the first read brings in: the posted spending, and Netflix, still pending. */
const FIRST_SPENDING = [
	"Auto Loan Payment",
	"Chipotle",
	"Costco",
	"Evergreen Property Rent",
	"Kroger",
	"Netflix",
	"Shell",
];

/** After a later sync (fakeLaterChanges): Chipotle dropped, Target new and pending. */
const LATER_SPENDING = [
	"Auto Loan Payment",
	"Costco",
	"Evergreen Property Rent",
	"Kroger",
	"Netflix",
	"Shell",
	"Target",
];

const row = async (note: string) => {
	const found = (await db.select().from(transactions)).find((t) => t.note === note);
	return found && { id: found.id, amountCents: found.amountCents, pending: found.pending };
};

describe("connecting a Bank Connection", () => {
	it("creates an Account for each checking, savings, card and loan account, with its balance", async () => {
		expect(await connect()).toEqual({ ok: true, accounts: 4 });
		const { accounts } = await loadGoals(db, { householdId, memberId: parentId });
		expect(accounts.map((a) => [a.name, a.kind, a.latestBalance?.amount])).toEqual([
			["Plaid Checking ••0000", "checking", 1_250_40],
			["Kids Savings ••1111", "savings", 8_200_00],
			["Costco Anywhere Visa ••3333", "credit-card", 410_25],
			["Plaid Auto Loan ••4444", "loan", 12_480_00],
		]);
	});

	it("keeps the credential sealed, and out of what screens read", async () => {
		await connect();
		const [row] = await db.select().from(bankConnections);
		expect(row?.credential).toMatch(/^v1:/);
		expect(row?.credential).not.toContain("access-fake");
		const connection = await loadBankConnectionToImport(db, householdId, connectionId);
		if (!connection) throw new Error("no connection");
		expect(await openCredential(key, connection.credential, { householdId, connectionId })).toBe(
			"access-fake-household",
		);
		const [summary] = await loadBankConnections(db, householdId);
		expect(JSON.stringify(summary)).not.toContain("v1:");
		expect(summary).toMatchObject({ institution: "First Platypus Bank", status: "importing" });
	});

	it("refuses the same login connected again", async () => {
		await connect();
		expect(await connect(plaid(), "connection-2")).toEqual({
			ok: false,
			reason: "connected-already",
		});
		expect(await loadBankConnections(db, householdId)).toHaveLength(1);
	});
});

describe("pairing with the Accounts already there (ADR-0020)", () => {
	const handCard = "01J00000000000000000000001";
	beforeEach(async () => {
		await addAccount(db, {
			householdId,
			accountId: handCard,
			name: "Costco Anywhere Visa",
			kind: "credit-card",
			balanceCents: 300_00,
			balanceId: "hand-balance",
			createdByMemberId: parentId,
		});
		// A statement brought in Shell (2 days before the fake's today) and Costco (5 days before).
		await importStatement(db, {
			householdId,
			importId: "statement",
			accountId: handCard,
			source: "csv",
			fileName: "costco.csv",
			fileKey: null,
			lines: [
				{ date: "2026-09-18", amount: -38_50, description: "SHELL OIL 5741", bankId: null },
				{ date: "2026-09-15", amount: -112_30, description: "COSTCO WHSE #1042", bankId: null },
			],
			closingBalance: null,
			csvMapping: null,
			createdByMemberId: parentId,
			newId,
		});
	});

	it("waits while choosing, suggests the card, and pairs it without doubling its lines", async () => {
		await connectInstitution(
			{ db, provider: plaid(), key },
			{
				householdId,
				memberId: parentId,
				connectionId,
				handoff: { token: "public-fake-household", institution: "First Platypus Bank" },
			},
		);
		// Nothing is read until the Parent has chosen.
		expect(await runBankImport(params, inlineStep, deps().importDeps)).toBe("choosing");
		expect(await landed()).toEqual({
			transactions: ["COSTCO WHSE #1042", "SHELL OIL 5741"],
			income: [],
		});

		const choices = await bankChoices(
			{ db, provider: plaid(), key },
			{ householdId, connectionId, institution: "First Platypus Bank" },
		);
		const card = choices?.accounts.find((a) => a.kind === "credit-card");
		expect(card).toMatchObject({ name: "Costco Anywhere Visa ••3333", suggested: handCard });
		expect(choices?.accounts.filter((a) => a.suggested !== null)).toHaveLength(1);
		expect(card?.options.map((o) => o.id)).toEqual([handCard]);

		const chosen = await applyBankChoices(
			{ db, provider: plaid(), key, newId },
			{
				householdId,
				memberId: parentId,
				connectionId,
				choices: (choices?.accounts ?? []).map((a) => ({
					externalId: a.externalId,
					choice: a.suggested ? { pair: a.suggested } : "new",
				})),
			},
		);
		expect(chosen).toMatchObject({ ok: true, accounts: 4, first: true, refused: [] });
		expect(await runBankImport(params, inlineStep, deps().importDeps)).toBe("done");

		// The card is the same Account, and its statement's Shell and Costco aren't doubled.
		const { accounts } = await loadGoals(db, { householdId, memberId: parentId });
		expect(accounts.filter((a) => a.kind === "credit-card")).toMatchObject([
			{ id: handCard, name: "Costco Anywhere Visa", bankConnectionId: connectionId },
		]);
		const notes = (await landed()).transactions;
		expect(notes.filter((n) => /shell/i.test(n ?? ""))).toEqual(["SHELL OIL 5741"]);
		expect(notes.filter((n) => /costco/i.test(n ?? ""))).toEqual(["COSTCO WHSE #1042"]);
		expect(notes).toEqual(expect.arrayContaining(["Chipotle", "Netflix"]));

		// Choosing again later offers the card as paired.
		const again = await bankChoices(
			{ db, provider: plaid(), key },
			{ householdId, connectionId, institution: "First Platypus Bank" },
		);
		expect(again?.accounts.find((a) => a.kind === "credit-card")?.pairedWith).toBe(handCard);
		expect(again?.gone).toEqual([]);
	});
});

describe("the Import Workflow", () => {
	it("brings in the posted Transactions and income, then categorizes and drafts the Plan", async () => {
		await connect();
		const { importDeps, categorized, drafted, notified } = deps();
		expect(await runBankImport(params, inlineStep, importDeps)).toBe("done");

		// Investment lines aren't brought in; money in to checking or savings is income.
		expect(await landed()).toEqual({
			transactions: FIRST_SPENDING,
			income: ["Acme Payroll", "Interest Paid"],
		});
		const [summary] = await loadBankConnections(db, householdId);
		expect(summary?.status).toBe("ready");
		expect(summary?.lastImportedAt).toBeInstanceOf(Date);
		// One Import per Account with lines, each categorized for the Parent who connected.
		expect(categorized).toHaveLength(4);
		expect(drafted).toEqual([parentId]);
		expect(notified[0]).toEqual(expect.arrayContaining(["bank-connections", "imports"]));
		// A pending charge comes in marked as one.
		expect(await row("Netflix")).toMatchObject({ pending: true });
		expect(await row("Kroger")).toMatchObject({ pending: false });
	});

	it("syncs on from the cursor: a pending charge posts in place, and changed and dropped lines follow", async () => {
		await connect();
		// The same message is the same Workflow instance; each sync is a new one.
		expect(bankImportInstanceId(connectionId, "run-1")).toBe(
			bankImportInstanceId(params.connectionId, params.runId),
		);
		await runBankImport(params, inlineStep, deps().importDeps);
		const pending = await row("Netflix");
		const kroger = await row("Kroger");

		const later = deps();
		expect(await runBankImport({ ...params, runId: "run-2" }, inlineStep, later.importDeps)).toBe(
			"done",
		);
		expect((await landed()).transactions).toEqual(LATER_SPENDING);
		// Netflix posted for a little more, in the pending row's place: it counts once.
		expect(await row("Netflix")).toEqual({
			id: pending?.id,
			amountCents: 10_49 * Math.sign(pending?.amountCents ?? 0),
			pending: false,
		});
		expect(await row("Kroger")).toMatchObject({
			id: kroger?.id,
			amountCents: 68_40 * Math.sign(kroger?.amountCents ?? 0),
		});
		expect(await row("Target")).toMatchObject({ pending: true });
		// Only the new line is an Import to categorize.
		expect(later.categorized).toHaveLength(1);

		// A sync after that finds nothing new.
		const again = deps();
		expect(await runBankImport({ ...params, runId: "run-3" }, inlineStep, again.importDeps)).toBe(
			"done",
		);
		expect((await landed()).transactions).toEqual(LATER_SPENDING);
		expect(again.categorized).toEqual([]);
		expect(again.drafted).toEqual([]);
	});

	it("records each Account's balance anew when the institution's has changed", async () => {
		await connect();
		const base = plaid();
		const moved: BankConnectionProvider = {
			...base,
			accounts: async (credential) =>
				(await base.accounts(credential)).map((account) =>
					account.kind === "credit-card" ? { ...account, balance: 455_74 } : account,
				),
		};
		const { importDeps, notified } = deps(moved);
		await runBankImport(params, inlineStep, importDeps);
		const { accounts } = await loadGoals(db, { householdId, memberId: parentId });
		expect(accounts.map((a) => a.latestBalance?.amount)).toEqual([
			1_250_40, 8_200_00, 455_74, 12_480_00,
		]);
		expect(notified.at(-1)).toContain("goals");
	});

	it("waits for a Parent to reconnect when the institution wants them to log in again", async () => {
		await connect();
		let reads = 0;
		const lapsed: BankConnectionProvider = {
			...plaid(),
			changes: async () => {
				reads++;
				throw new BankProviderError("login required", "ITEM_LOGIN_REQUIRED", null, true);
			},
		};
		const { importDeps, notified } = deps(lapsed);
		expect(await runBankImport(params, inlineStep, importDeps)).toBe("reconnect");
		// Not retried: only the Parent can fix it.
		expect(reads).toBe(1);
		const [summary] = await loadBankConnections(db, householdId);
		expect(summary?.status).toBe("reconnect");
		expect(notified).toEqual([["bank-connections"]]);
	});

	it("shows what the provider asked the Parent to read, until a read works", async () => {
		await connect();
		const down: BankConnectionProvider = {
			...plaid(),
			changes: async () => {
				throw new BankProviderError(
					"down",
					"INSTITUTION_DOWN",
					"This institution is not currently responding.",
				);
			},
		};
		expect(await runBankImport(params, inlineStep, deps(down).importDeps)).toBe("failed");
		const notice = async () => (await loadBankConnections(db, householdId))[0]?.notice;
		expect(await notice()).toBe("This institution is not currently responding.");

		expect(await runBankImport({ ...params, runId: "run-2" }, inlineStep, deps().importDeps)).toBe(
			"done",
		);
		expect(await notice()).toBeNull();
	});

	it("brings in one set of Transactions when the provider sends the same lines twice", async () => {
		await connect();
		// A provider that forgets the cursor: every read hands over everything again.
		const base = plaid();
		const forgetful: BankConnectionProvider = {
			...base,
			changes: (credential) => base.changes(credential, null),
		};
		await runBankImport(params, inlineStep, deps(forgetful).importDeps);
		await runBankImport({ ...params, runId: "run-2" }, inlineStep, deps(forgetful).importDeps);

		expect(await landed()).toEqual({
			transactions: FIRST_SPENDING,
			income: ["Acme Payroll", "Interest Paid"],
		});
	});

	it("reads again while the provider is still gathering history", async () => {
		await connect();
		const base = plaid();
		let reads = 0;
		const slow: BankConnectionProvider = {
			...base,
			changes: async (credential, cursor) => {
				reads++;
				const changes = await base.changes(credential, cursor);
				return { ...changes, complete: reads >= 3 };
			},
		};
		const slept: string[] = [];
		const step = { ...inlineStep, sleep: async (name: string) => void slept.push(name) };
		expect(await runBankImport(params, step as typeof inlineStep, deps(slow).importDeps)).toBe(
			"done",
		);
		expect(slept).toEqual(["wait 1", "wait 2"]);
		// The second read went on to the later changes.
		expect((await landed()).transactions).toEqual(LATER_SPENDING);
	});

	it("marks the Bank Connection failed when its reads keep failing", async () => {
		await connect();
		const broken: BankConnectionProvider = {
			...plaid(),
			changes: async () => {
				throw new Error("ITEM_LOGIN_REQUIRED");
			},
		};
		expect(await runBankImport(params, inlineStep, deps(broken).importDeps)).toBe("failed");
		const [summary] = await loadBankConnections(db, householdId);
		expect(summary?.status).toBe("failed");
		expect((await landed()).transactions).toEqual([]);
	});

	it("gives up at once when Plaid refuses Noodle's keys, saying so on the Bank Connection", async () => {
		await connect();
		const refusing = (code: string): BankConnectionProvider => ({
			...plaid(),
			changes: async () => {
				throw new BankProviderError("refused", code, "Plaid isn’t set up for this copy of Noodle.");
			},
		});
		const gaveUp: string[] = [];
		const run = async (code: string, runId: string) => {
			const { importDeps } = deps(refusing(code));
			importDeps.giveUp = (message) => {
				gaveUp.push(code);
				return new Error(message);
			};
			return runBankImport({ ...params, runId }, inlineStep, importDeps);
		};
		expect(await run("INVALID_API_KEYS", "run-1")).toBe("failed");
		expect(await run("UNAUTHORIZED_ENVIRONMENT", "run-2")).toBe("failed");
		// A bank that's down is worth trying again.
		expect(await run("INSTITUTION_DOWN", "run-3")).toBe("failed");
		expect(gaveUp).toEqual(["INVALID_API_KEYS", "UNAUTHORIZED_ENVIRONMENT"]);
		const [summary] = await loadBankConnections(db, householdId);
		expect(summary?.status).toBe("failed");
		expect(summary?.notice).toBe("Plaid isn’t set up for this copy of Noodle.");
	});

	it("does nothing for a Bank Connection that's gone", async () => {
		expect(await runBankImport(params, inlineStep, deps().importDeps)).toBe("gone");
	});
});

describe("how far back a Bank Connection goes (#89)", () => {
	// `today` is 20 September 2026: 90 days back is 22 June.
	it("keeps the start the Parent chose, and brings in what's inside it", async () => {
		await connect(plaid(), connectionId, {
			token: "public-fake-household~d90",
			historyStart: "2026-06-22",
		});
		expect((await loadBankConnectionToImport(db, householdId, connectionId))?.historyStart).toBe(
			"2026-06-22",
		);
		expect(await runBankImport(params, inlineStep, deps().importDeps)).toBe("done");
		const { transactions: notes } = await landed();
		// Safeway was 45 days back. The bank sent Blockbuster, 400 days back, regardless.
		expect(notes).toEqual([...FIRST_SPENDING, "Safeway"].sort());
	});

	it("keeps nothing dated before the start on the first Import, whatever the bank sends", async () => {
		// Plaid was asked for a year and sent it all; the start is 10 September.
		await connect(plaid(), connectionId, {
			token: "public-fake-household~d365",
			historyStart: "2026-09-10",
		});
		expect(await runBankImport(params, inlineStep, deps().importDeps)).toBe("done");
		const { transactions: notes } = await landed();
		expect(notes).toContain("Evergreen Property Rent");
		expect(notes).toContain("Kroger");
		for (const older of ["Chipotle", "Auto Loan Payment", "Safeway", "REI", "Blockbuster"]) {
			expect(notes).not.toContain(older);
		}
	});

	it("keeps nothing dated before the start on a later Import either", async () => {
		await connect(plaid(), connectionId, { historyStart: "2026-09-10" });
		expect(await runBankImport(params, inlineStep, deps().importDeps)).toBe("done");
		const line = (bankId: string, date: string, description: string) => ({
			accountExternalId: "fake-checking",
			bankId,
			date: date as DayKey,
			amount: -1_234,
			description,
			pending: false,
			replaces: null,
		});
		const later: BankConnectionProvider = {
			...plaid(),
			changes: async () => ({
				lines: [
					line("late-old", "2026-09-09", "Old Gym"),
					line("late-edge", "2026-09-10", "Edge Diner"),
					line("late-new", "2026-09-20", "New Cafe"),
				],
				removed: [],
				cursor: "later-cursor",
				complete: true,
			}),
		};
		expect(
			await runBankImport({ ...params, runId: "run-2" }, inlineStep, deps(later).importDeps),
		).toBe("done");
		const { transactions: notes } = await landed();
		expect(notes).toContain("New Cafe");
		expect(notes).toContain("Edge Diner");
		expect(notes).not.toContain("Old Gym");
	});

	it("keeps everything for a Bank Connection made before the choice was asked", async () => {
		await connect(plaid(), connectionId, { token: "public-fake-household~d365" });
		expect((await loadBankConnectionToImport(db, householdId, connectionId))?.historyStart).toBe(
			null,
		);
		expect(await runBankImport(params, inlineStep, deps().importDeps)).toBe("done");
		const { transactions: notes } = await landed();
		expect(notes).toEqual(expect.arrayContaining(["Safeway", "REI", "Blockbuster"]));
	});
});
