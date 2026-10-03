import {
	addAccount,
	addBankConnection,
	chooseBankAccounts,
	createHouseholdForParent,
	type Db,
	findBankConnectionsByExternal,
	loadBankConnections,
	loadBankConnectionsToSync,
	loadBankConnectionToImport,
	loadPairableAccounts,
} from "@noodle/db";
import { testDb } from "@noodle/db/test-db";
import { beforeEach, describe, expect, it } from "vitest";
import { type BankConnectionProvider, BankProviderError } from "./bank-connection";
import { disconnectBankConnection } from "./bank-disconnect";

// Disconnecting a bank (#61): removed at the bank, token deleted, Accounts kept by hand.

const householdId = "household";
const parentId = "parent";
let db: Db;
let removed: string[];
let removeError: Error | null;

const provider = {
	provider: "plaid",
	connect: async () => {
		throw new Error("not used");
	},
	accounts: async () => [],
	changes: async () => ({ added: [], next: "", complete: true }),
	remove: async (credential: string) => {
		if (removeError) throw removeError;
		removed.push(credential);
	},
} as unknown as BankConnectionProvider;

const deps = () => ({
	db,
	providerFor: () => provider,
	openCredential: async (c: { credential: string }) => `opened:${c.credential}`,
});

const bankChecking = {
	externalId: "acc-chk",
	name: "Checking ··0000",
	mask: "0000",
	kind: "checking" as const,
	balance: 125_040,
};

async function connect(connectionId: string, externalId = "item-1") {
	await addBankConnection(db, {
		householdId,
		connectionId,
		provider: "plaid",
		externalId,
		institution: "First Platypus Bank",
		credential: "v1:sealed",
		createdByMemberId: parentId,
	});
	return chooseBankAccounts(db, {
		householdId,
		connectionId,
		createdByMemberId: parentId,
		choices: [
			{
				account: bankChecking,
				balanceId: `${connectionId}-b`,
				choice: { kind: "pair", accountId: "chase" },
			},
		],
	});
}

beforeEach(async () => {
	db = testDb();
	removed = [];
	removeError = null;
	for (const [id, parent, house] of [
		[householdId, parentId, "The Rinks"],
		["other", "other-parent", "The Others"],
	]) {
		await createHouseholdForParent(db, {
			clerkUserId: `clerk-${parent}`,
			householdId: id,
			householdName: house,
			timeZone: "America/Chicago",
			parentId: parent,
			parentName: "Alex",
		});
	}
	await addAccount(db, {
		householdId,
		accountId: "chase",
		name: "Chase checking",
		kind: "checking",
		balanceCents: 50_000,
		balanceId: "chase-b0",
		createdByMemberId: parentId,
	});
	await connect("conn-1");
});

describe("disconnectBankConnection", () => {
	it("removes the link at the bank, deletes the token and keeps the Account by hand", async () => {
		expect(await disconnectBankConnection(deps(), { householdId, connectionId: "conn-1" })).toEqual(
			{ ok: true },
		);
		expect(removed).toEqual(["opened:v1:sealed"]);
		const row = await loadBankConnectionToImport(db, householdId, "conn-1");
		expect(row).toMatchObject({ credential: "", status: "disconnected", accounts: [] });
		// Not shown, not synced, and its Account is there, by hand, to pair again.
		expect(await loadBankConnections(db, householdId)).toEqual([]);
		expect(await loadBankConnectionsToSync(db)).toEqual([]);
		const pairable = await loadPairableAccounts(db, householdId);
		expect(pairable).toMatchObject([{ id: "chase", bankConnectionId: null }]);
	});

	it("leaves nothing for a later webhook about the link to find", async () => {
		await disconnectBankConnection(deps(), { householdId, connectionId: "conn-1" });
		expect(await findBankConnectionsByExternal(db, "plaid", "item-1")).toEqual([]);
	});

	it("won't disconnect another Household's bank", async () => {
		expect(
			await disconnectBankConnection(deps(), { householdId: "other", connectionId: "conn-1" }),
		).toEqual({ ok: false, reason: "not-found" });
		expect(removed).toEqual([]);
		expect(await loadBankConnections(db, householdId)).toHaveLength(1);
	});

	it("keeps the token when the bank didn't answer, so the Parent can try again", async () => {
		removeError = new BankProviderError("Plaid: down", "INTERNAL_SERVER_ERROR");
		expect(await disconnectBankConnection(deps(), { householdId, connectionId: "conn-1" })).toEqual(
			{ ok: false, reason: "bank" },
		);
		expect(await loadBankConnectionToImport(db, householdId, "conn-1")).toMatchObject({
			credential: "v1:sealed",
		});
	});

	it("goes ahead when the bank has dropped the link already", async () => {
		removeError = new BankProviderError("Plaid: gone", "ITEM_NOT_FOUND");
		expect(await disconnectBankConnection(deps(), { householdId, connectionId: "conn-1" })).toEqual(
			{ ok: true },
		);
		expect(await disconnectBankConnection(deps(), { householdId, connectionId: "conn-1" })).toEqual(
			{ ok: false, reason: "not-found" },
		);
	});

	it("pairs the same bank, connected again, with the same Account", async () => {
		await disconnectBankConnection(deps(), { householdId, connectionId: "conn-2" });
		await disconnectBankConnection(deps(), { householdId, connectionId: "conn-1" });
		// The fake hands the same login the same Item ID: it's free again.
		expect(await connect("conn-2")).toMatchObject({ ok: true, accounts: 1 });
		expect(await loadBankConnections(db, householdId)).toMatchObject([
			{ id: "conn-2", accounts: [{ id: "chase" }] },
		]);
	});
});
