import { beforeEach, describe, expect, it } from "vitest";
import {
	addBankConnection,
	createHouseholdForParent,
	type Db,
	loadBankConnections,
	loadBankConnectionToImport,
	loadGoals,
	loadImports,
	saveBankImport,
} from "./index";
import { testDb } from "./test-db";

const householdId = "household";
const parentId = "parent";

let db: Db;

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: "Alex",
	});
});

const connect = (connectionId = "conn-1", externalId = "item-1") =>
	addBankConnection(db, {
		householdId,
		connectionId,
		provider: "plaid",
		externalId,
		institution: "First Platypus Bank",
		credential: "v1:sealed",
		createdByMemberId: parentId,
		accounts: [
			{
				accountId: `${connectionId}-1`,
				balanceId: `${connectionId}-b1`,
				account: {
					externalId: "acc-chk",
					name: "Checking ··0000",
					kind: "checking",
					balance: 110_00,
				},
			},
			{
				accountId: `${connectionId}-2`,
				balanceId: `${connectionId}-b2`,
				account: { externalId: "acc-cc", name: "Card ··3333", kind: "credit-card", balance: null },
			},
		],
	});

describe("addBankConnection", () => {
	it("creates its Accounts with the balances the institution reports", async () => {
		expect(await connect()).toEqual({ ok: true, accounts: 2 });
		const { accounts } = await loadGoals(db, { householdId, memberId: parentId });
		expect(accounts).toMatchObject([
			{
				name: "Checking ··0000",
				kind: "checking",
				bankConnectionId: "conn-1",
				latestBalance: { amount: 110_00 },
			},
			{ name: "Card ··3333", kind: "credit-card", bankConnectionId: "conn-1", latestBalance: null },
		]);
		const [summary] = await loadBankConnections(db, householdId);
		expect(summary).toMatchObject({
			id: "conn-1",
			institution: "First Platypus Bank",
			status: "importing",
			lastImportedAt: null,
		});
		expect(summary?.accounts.map((a) => a.name)).toEqual(["Checking ··0000", "Card ··3333"]);
		// What screens read never carries the credential.
		expect(JSON.stringify(summary)).not.toContain("sealed");
	});

	it("is idempotent, and refuses the same link connected again", async () => {
		await connect();
		expect(await connect()).toEqual({ ok: true, accounts: 2 });
		expect(await connect("conn-2", "item-1")).toEqual({ ok: false, reason: "connected-already" });
		const { accounts } = await loadGoals(db, { householdId, memberId: parentId });
		expect(accounts).toHaveLength(2);
	});

	it("never writes into another Household", async () => {
		await connect();
		const other = await loadBankConnectionToImport(db, "someone-else", "conn-1");
		expect(other).toBeNull();
	});
});

describe("saveBankImport", () => {
	it("moves the cursor on only from where the read began", async () => {
		await connect();
		const save = (from: string | null, to: string) =>
			saveBankImport(db, { householdId, connectionId: "conn-1", from, to, status: "ready" });
		expect(await save(null, "c1")).toBe(true);
		// A read that began before c1 was saved lost the race.
		expect(await save(null, "c1-late")).toBe(false);
		expect(await save("c1", "c2")).toBe(true);
		const connection = await loadBankConnectionToImport(db, householdId, "conn-1");
		expect(connection).toMatchObject({
			cursor: "c2",
			credential: "v1:sealed",
			createdByMemberId: parentId,
			accounts: [
				{ id: "conn-1-1", externalId: "acc-chk" },
				{ id: "conn-1-2", externalId: "acc-cc" },
			],
		});
		const [summary] = await loadBankConnections(db, householdId);
		expect(summary?.status).toBe("ready");
		expect(summary?.lastImportedAt).toBeInstanceOf(Date);
	});
});

describe("an Import from a Bank Connection", () => {
	it("names its institution", async () => {
		await connect();
		const { importStatement } = await import("./imports");
		await importStatement(db, {
			householdId,
			importId: "imp-1",
			accountId: "conn-1-1",
			source: "bank",
			fileName: null,
			fileKey: null,
			bankConnectionId: "conn-1",
			lines: [{ date: "2026-09-10", amount: -450, description: "Coffee", bankId: "tx-1" }],
			closingBalance: null,
			csvMapping: null,
			createdByMemberId: parentId,
			newId: () => "row-1",
		});
		const [record] = await loadImports(db, householdId, "conn-1-1");
		expect(record).toMatchObject({
			source: "bank",
			institution: "First Platypus Bank",
			transactionCount: 1,
		});
	});
});
