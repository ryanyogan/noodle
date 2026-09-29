import {
	createHouseholdForParent,
	type Db,
	loadBankConnections,
	loadBankConnectionToImport,
	loadGoals,
} from "@noodle/db";
import { bankConnections, income, transactions } from "@noodle/db/schema";
import { testDb } from "@noodle/db/test-db";
import type { DayKey } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { connectInstitution } from "./bank-connect";
import type { BankConnectionProvider } from "./bank-connection";
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

const connect = (provider: BankConnectionProvider = plaid(), id = connectionId) =>
	connectInstitution(
		{ db, provider, key, newId },
		{
			householdId,
			memberId: parentId,
			connectionId: id,
			handoff: { token: "public-fake-household", institution: "First Platypus Bank" },
		},
	);

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

const POSTED_SPENDING = [
	"Auto Loan Payment",
	"Chipotle",
	"Costco",
	"Evergreen Property Rent",
	"Kroger",
	"Shell",
];

describe("connecting a Bank Connection", () => {
	it("creates an Account for each checking, savings, card and loan account, with its balance", async () => {
		expect(await connect()).toEqual({ ok: true, accounts: 4 });
		const { accounts } = await loadGoals(db, { householdId, memberId: parentId });
		expect(accounts.map((a) => [a.name, a.kind, a.latestBalance?.amount])).toEqual([
			["Plaid Checking ··0000", "checking", 1_250_40],
			["Plaid Saving ··1111", "savings", 8_200_00],
			["Plaid Credit Card ··3333", "credit-card", 410_25],
			["Plaid Auto Loan ··4444", "loan", 12_480_00],
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

describe("the Import Workflow", () => {
	it("brings in the posted Transactions and income, then categorizes and drafts the Plan", async () => {
		await connect();
		const { importDeps, categorized, drafted, notified } = deps();
		expect(await runBankImport(params, inlineStep, importDeps)).toBe("done");

		// Pending and investment lines aren't brought in; money in to checking or savings is income.
		expect(await landed()).toEqual({
			transactions: POSTED_SPENDING,
			income: ["Acme Payroll", "Interest Paid"],
		});
		const [summary] = await loadBankConnections(db, householdId);
		expect(summary?.status).toBe("ready");
		expect(summary?.lastImportedAt).toBeInstanceOf(Date);
		// One Import per Account with lines, each categorized for the Parent who connected.
		expect(categorized).toHaveLength(4);
		expect(drafted).toEqual([parentId]);
		expect(notified[0]).toEqual(expect.arrayContaining(["bank-connections", "imports"]));
	});

	it("brings in one set of Transactions when the same queue message runs twice", async () => {
		await connect();
		// The same message is the same Workflow instance; inline, it simply runs again.
		expect(bankImportInstanceId(connectionId, "run-1")).toBe(
			bankImportInstanceId(params.connectionId, params.runId),
		);
		await runBankImport(params, inlineStep, deps().importDeps);
		const again = deps();
		expect(await runBankImport(params, inlineStep, again.importDeps)).toBe("done");

		expect((await landed()).transactions).toEqual(POSTED_SPENDING);
		// The second read started from the saved cursor and found nothing new.
		expect(again.categorized).toEqual([]);
		expect(again.drafted).toEqual([]);
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
			transactions: POSTED_SPENDING,
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
		expect((await landed()).transactions).toEqual(POSTED_SPENDING);
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

	it("does nothing for a Bank Connection that's gone", async () => {
		expect(await runBankImport(params, inlineStep, deps().importDeps)).toBe("gone");
	});
});
