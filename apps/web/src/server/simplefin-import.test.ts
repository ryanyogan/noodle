import {
	createHouseholdForParent,
	type Db,
	loadBankConnections,
	loadBankConnectionToImport,
	loadGoals,
} from "@noodle/db";
import { bankConnections, income, transactions } from "@noodle/db/schema";
import { testDb } from "@noodle/db/test-db";
import type { SimplefinAccountSet } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { connectInstitution } from "./bank-connect";
import { type BankConnectionProvider, BankProviderError } from "./bank-connection";
import { credentialKey, openCredential, TEST_CREDENTIAL_KEY } from "./bank-credential";
import {
	type BankImportDeps,
	type BankImportParams,
	inlineStep,
	runBankImport,
} from "./bank-import-run";
import { plaidProvider } from "./plaid";
import { fakePlaidTransport } from "./plaid-fake";
import { SETUP_TOKEN_CLAIMED, type SimplefinTransport, simplefinProvider } from "./simplefin";

// The ingest seam for SimpleFIN Bank Connections: a Parent's setup token is claimed and connected
// (connectInstitution, as connectSimplefin does), and the ingest Queue's message runs the Import
// Workflow (runBankImport, inline) against a SimpleFIN server that answers with recorded Account
// Sets, then what landed is read back as the app reads it. The same Workflow, Imports and keys as
// Plaid's: only the provider differs.

const householdId = "household";
const parentId = "parent";
const connectionId = "connection";
const NOW = new Date("2026-09-20T15:00:00Z");

/** A setup token's claim URL, and the Access URL claiming it answers with. */
const CLAIM_URL = "https://beta-bridge.simplefin.org/simplefin/claim/4F2C1B0A9E8D7C6B";
const SETUP_TOKEN = btoa(CLAIM_URL);
const ACCESS_URL = "https://7d0c1f7e2b:Qm9vZGxlLXNlY3JldA@beta-bridge.simplefin.org/simplefin";

/** GET /accounts from a SimpleFIN Bridge (protocol version 2), as recorded; IDs and names changed. */
const RECORDED: SimplefinAccountSet = {
	errlist: [],
	connections: [
		{
			conn_id: "CON-5b8e1e0c",
			name: "Prairie State Credit Union",
			org_id: "prairiestatecu",
			org_url: "https://www.prairiestatecu.example",
			sfin_url: "https://beta-bridge.simplefin.org/simplefin",
		},
	],
	accounts: [
		{
			id: "ACT-3c0d4a8e-6f5b-4b1f-9d2c-11a0e3b7c902",
			name: "Share Draft Checking",
			conn_id: "CON-5b8e1e0c",
			currency: "USD",
			balance: "3184.22",
			"available-balance": "3102.47",
			"balance-date": 1789895564,
			transactions: [
				{
					id: "TRN-0a8b7c6d-1111",
					posted: 1788393600,
					amount: "2650.00",
					description: "ACME CORP PAYROLL PPD ID: 9111111101",
					transacted_at: 1788393600,
				},
				{
					id: "TRN-0a8b7c6d-2222",
					posted: 1788825600,
					amount: "-1450.00",
					description: "EVERGREEN PROPERTY RENT WEB PMTS",
				},
				{
					id: "TRN-0a8b7c6d-3333",
					posted: 1789430400,
					amount: "-86.41",
					description: "HY-VEE #1124 DES MOINES IA",
					transacted_at: 1789326175,
				},
				{
					id: "TRN-0a8b7c6d-4444",
					posted: 0,
					amount: "-18.75",
					description: "CASEYS #3301",
					transacted_at: 1789895564,
					pending: true,
				},
			],
		},
		{
			id: "ACT-3c0d4a8e-6f5b-4b1f-9d2c-11a0e3b7c903",
			name: "Regular Savings",
			conn_id: "CON-5b8e1e0c",
			currency: "USD",
			balance: "8200.00",
			"balance-date": 1789895564,
			transactions: [
				{
					id: "TRN-5e6f7a8b-1111",
					posted: 1788220800,
					amount: "1.87",
					description: "DIVIDEND EARNED",
				},
			],
		},
		{
			id: "ACT-8f1e2d3c-0b9a-4c8d-a7e6-5f4d3c2b1a00",
			name: "Visa Signature Rewards",
			conn_id: "CON-5b8e1e0c",
			currency: "USD",
			balance: "-612.40",
			"balance-date": 1789895564,
			transactions: [
				{
					id: "TRN-9c8b7a6f-1111",
					posted: 1789084800,
					amount: "250.00",
					description: "PAYMENT THANK YOU",
				},
				{
					id: "TRN-9c8b7a6f-2222",
					posted: 1789603200,
					amount: "-129.64",
					description: "COSTCO WHSE #0367",
					transacted_at: 1789598467,
				},
				{
					id: "TRN-9c8b7a6f-3333",
					posted: 1789776000,
					amount: "-42.18",
					description: "SHELL OIL 57442",
				},
			],
		},
		{
			id: "ACT-1d2c3b4a-auto",
			name: "Auto Loan",
			conn_id: "CON-5b8e1e0c",
			currency: "USD",
			balance: "-11820.55",
			"balance-date": 1789895564,
			transactions: [
				{
					id: "TRN-1d2c3b4a-1111",
					posted: 1789344000,
					amount: "310.00",
					description: "PAYMENT RECEIVED",
				},
			],
		},
		{
			id: "ACT-7a6b5c4d-brokerage",
			name: "Brokerage",
			conn_id: "CON-5b8e1e0c",
			currency: "USD",
			balance: "23631.98",
			"balance-date": 1789895564,
			holdings: [{ id: "HOL-1", symbol: "VTI", shares: "100.000" }],
			transactions: [
				{
					id: "TRN-7a6b5c4d-1111",
					posted: 1789689600,
					amount: "-500.00",
					description: "TRANSFER TO CHECKING",
				},
			],
		},
	],
};

/** The same, as a version 1 server answers: `org` on each account, errors as strings. */
const RECORDED_V1: SimplefinAccountSet = {
	errors: [],
	accounts: RECORDED.accounts.map(({ conn_id: _, ...account }) => ({
		...account,
		org: { name: "Prairie State Credit Union", domain: "prairiestatecu.example" },
	})),
};

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

/** A SimpleFIN server that answers every read with the recorded Account Set, and counts. */
function recordedServer(set: SimplefinAccountSet = RECORDED) {
	const claimed = new Set<string>();
	const reads: URLSearchParams[] = [];
	const transport: SimplefinTransport = {
		async claim(claimUrl) {
			// A setup token can be claimed only once.
			if (claimUrl !== CLAIM_URL || claimed.has(claimUrl)) {
				throw new BankProviderError("claim refused", SETUP_TOKEN_CLAIMED);
			}
			claimed.add(claimUrl);
			return ACCESS_URL;
		},
		async accounts(accessUrl, query) {
			if (accessUrl !== ACCESS_URL) throw new BankProviderError("SimpleFIN: HTTP 403", "403");
			reads.push(query);
			if (query.get("balances-only") === "1") {
				return { ...set, accounts: set.accounts.map(({ transactions: _, ...a }) => a) };
			}
			return set;
		},
	};
	return { transport, reads, provider: simplefinProvider(transport, () => NOW) };
}

const connect = (provider: BankConnectionProvider, id = connectionId, token = SETUP_TOKEN) =>
	connectInstitution(
		{ db, provider, key, newId },
		{
			householdId,
			memberId: parentId,
			connectionId: id,
			handoff: { token, institution: null },
		},
	);

const params: BankImportParams = {
	householdId,
	connectionId,
	timeZone: "America/Chicago",
	runId: "run-1",
};

function deps(simplefin: BankConnectionProvider) {
	const categorized: string[] = [];
	const plaid = plaidProvider(fakePlaidTransport("2026-09-20"));
	const importDeps: BankImportDeps = {
		db,
		providerFor: (provider) => (provider === "simplefin" ? simplefin : plaid),
		openCredential: ({ householdId, id, credential }) =>
			openCredential(key, credential, { householdId, connectionId: id }),
		categorize: async (_viewer, importId) => void categorized.push(importId),
		draftPlan: async () => {},
		notify: async () => {},
		newId,
	};
	return { importDeps, categorized };
}

const landed = async () => ({
	transactions: (await db.select().from(transactions))
		.map((t) => `${t.date} ${t.note} ${t.amountCents}`)
		.sort(),
	income: (await db.select().from(income))
		.map((i) => `${i.date} ${i.note} ${i.amountCents}`)
		.sort(),
});

// Spending is positive, money back negative; the Hy-Vee and Costco lines are dated when they happened.
const POSTED_SPENDING = [
	"2026-09-08 EVERGREEN PROPERTY RENT WEB PMTS 145000",
	"2026-09-11 PAYMENT THANK YOU -25000",
	"2026-09-13 HY-VEE #1124 DES MOINES IA 8641",
	"2026-09-14 PAYMENT RECEIVED -31000",
	"2026-09-16 COSTCO WHSE #0367 12964",
	"2026-09-19 SHELL OIL 57442 4218",
];
const POSTED_INCOME = [
	"2026-09-01 DIVIDEND EARNED 187",
	"2026-09-03 ACME CORP PAYROLL PPD ID: 9111111101 265000",
];

describe("connecting through SimpleFIN", () => {
	it("claims the setup token and creates an Account for each account the app tracks", async () => {
		const server = recordedServer();
		expect(await connect(server.provider)).toEqual({ ok: true, accounts: 4 });
		const { accounts } = await loadGoals(db, { householdId, memberId: parentId });
		expect(accounts.map((a) => [a.name, a.kind, a.latestBalance?.amount])).toEqual([
			["Share Draft Checking", "checking", 3_184_22],
			["Regular Savings", "savings", 8_200_00],
			["Visa Signature Rewards", "credit-card", 612_40],
			["Auto Loan", "loan", 11_820_55],
		]);
		// Connecting asked for balances only, once: the Bridge counts every request.
		expect(server.reads.map(String)).toEqual(["balances-only=1"]);
	});

	it("keeps the Access URL sealed, and names the institution", async () => {
		await connect(recordedServer().provider);
		const [row] = await db.select().from(bankConnections);
		expect(row?.provider).toBe("simplefin");
		expect(row?.credential).toMatch(/^v1:/);
		expect(JSON.stringify(row)).not.toContain("Qm9vZGxlLXNlY3JldA");
		const connection = await loadBankConnectionToImport(db, householdId, connectionId);
		if (!connection) throw new Error("no connection");
		expect(await openCredential(key, connection.credential, { householdId, connectionId })).toBe(
			ACCESS_URL,
		);
		const [summary] = await loadBankConnections(db, householdId);
		expect(summary).toMatchObject({
			provider: "simplefin",
			institution: "Prairie State Credit Union",
			status: "importing",
		});
	});

	it("refuses a setup token claimed already, and writes nothing", async () => {
		const server = recordedServer();
		await connect(server.provider);
		const again = connect(server.provider, "connection-2");
		await expect(again).rejects.toMatchObject({ code: SETUP_TOKEN_CLAIMED });
		expect(await loadBankConnections(db, householdId)).toHaveLength(1);
	});

	it("refuses what isn't a setup token before asking the server anything", async () => {
		const server = recordedServer();
		await expect(connect(server.provider, connectionId, "not a token")).rejects.toMatchObject({
			code: "INVALID_SETUP_TOKEN",
		});
		expect(server.reads).toEqual([]);
	});
});

describe("the Import Workflow, through SimpleFIN", () => {
	it("brings in the posted Transactions and income, and not pending or investment lines", async () => {
		const server = recordedServer();
		await connect(server.provider);
		const { importDeps, categorized } = deps(server.provider);
		expect(await runBankImport(params, inlineStep, importDeps)).toBe("done");

		expect(await landed()).toEqual({ transactions: POSTED_SPENDING, income: POSTED_INCOME });
		expect(categorized).toHaveLength(4);
		const [summary] = await loadBankConnections(db, householdId);
		expect(summary?.status).toBe("ready");
		// The first read went back 89 days, and asked for nothing pending.
		const read = server.reads.at(-1);
		expect(read?.get("start-date")).toBe(String(NOW.getTime() / 1000 - 89 * 86_400));
		expect(read?.has("pending")).toBe(false);
	});

	it("brings in one set of Transactions when the same payload comes twice", async () => {
		const server = recordedServer();
		await connect(server.provider);
		await runBankImport(params, inlineStep, deps(server.provider).importDeps);
		const again = deps(server.provider);
		expect(await runBankImport({ ...params, runId: "run-2" }, inlineStep, again.importDeps)).toBe(
			"done",
		);

		expect(await landed()).toEqual({ transactions: POSTED_SPENDING, income: POSTED_INCOME });
		// The second read started a few days before the first one ended, to catch late postings.
		const [, first, second] = server.reads;
		expect(Number(second?.get("start-date"))).toBe(NOW.getTime() / 1000 - 5 * 86_400);
		expect(first?.get("start-date")).not.toBe(second?.get("start-date"));
	});

	it("reads a version 1 server's answer the same way", async () => {
		const server = recordedServer(RECORDED_V1);
		await connect(server.provider);
		await runBankImport(params, inlineStep, deps(server.provider).importDeps);
		expect(await landed()).toEqual({ transactions: POSTED_SPENDING, income: POSTED_INCOME });
		const [summary] = await loadBankConnections(db, householdId);
		expect(summary?.institution).toBe("Prairie State Credit Union");
	});

	it("reads each Bank Connection through its own provider", async () => {
		const server = recordedServer();
		await connect(server.provider);
		await connectInstitution(
			{ db, provider: plaidProvider(fakePlaidTransport("2026-09-20")), key, newId },
			{
				householdId,
				memberId: parentId,
				connectionId: "plaid-connection",
				handoff: { token: "public-fake-household", institution: "First Platypus Bank" },
			},
		);
		const both = deps(server.provider).importDeps;
		await runBankImport(params, inlineStep, both);
		await runBankImport({ ...params, connectionId: "plaid-connection" }, inlineStep, both);
		const notes = (await db.select().from(transactions)).map((t) => t.note);
		expect(notes).toEqual(expect.arrayContaining(["COSTCO WHSE #0367", "Costco"]));
	});

	it("keeps the cursor where it was when an account's lines didn't all come", async () => {
		const server = recordedServer({
			...RECORDED,
			errlist: [
				{
					code: "act.missingdata",
					msg: "Incomplete transaction listing. Try again later",
					account_id: "ACT-8f1e2d3c-0b9a-4c8d-a7e6-5f4d3c2b1a00",
				},
			],
		});
		await connect(server.provider);
		await runBankImport(params, inlineStep, deps(server.provider).importDeps);
		const connection = await loadBankConnectionToImport(db, householdId, connectionId);
		expect(connection?.cursor).toBeNull();
		// What did come is in, and the next read covers the same days again.
		expect((await landed()).transactions).toEqual(POSTED_SPENDING);
		// The Parent sees what the server said, until a read says nothing.
		const [summary] = await loadBankConnections(db, householdId);
		expect(summary?.notice).toBe("Incomplete transaction listing. Try again later");
		const clean = recordedServer();
		await runBankImport({ ...params, runId: "run-2" }, inlineStep, deps(clean.provider).importDeps);
		expect((await loadBankConnections(db, householdId))[0]?.notice).toBeNull();
	});

	it("marks the Bank Connection failed when the server sends only errors", async () => {
		const server = recordedServer();
		await connect(server.provider);
		const revoked = recordedServer({
			accounts: [],
			errlist: [
				{
					code: "gen.auth",
					msg: 'Access has been revoked. <a href="https://beta-bridge.simplefin.org">Reconnect</a>',
				},
			],
		});
		expect(await runBankImport(params, inlineStep, deps(revoked.provider).importDeps)).toBe(
			"failed",
		);
		// The Parent sees why, as plain text.
		const [summary] = await loadBankConnections(db, householdId);
		expect(summary).toMatchObject({
			status: "failed",
			notice: "Access has been revoked. Reconnect",
		});
	});
});
