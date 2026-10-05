import {
	addBankConnection,
	addGoal,
	chooseBankAccounts,
	createHouseholdForParent,
	type Db,
	loadBankConnections,
	loadBankConnectionToImport,
	loadGoals,
} from "@noodle/db";
import { testDb } from "@noodle/db/test-db";
import { beforeEach, describe, expect, it } from "vitest";
import { type BankConnectionProvider, BankProviderError } from "./bank-connection";
import { archiveAccountAndUnlink, unlinkBankAccount } from "./bank-unlink";

// Unlinking one Account from its bank, and archiving one that still syncs (ADR-0046).

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
let db: Db;
let removed: string[];
let removeError: Error | null;

const provider = {
	provider: "plaid",
	remove: async (credential: string) => {
		if (removeError) throw removeError;
		removed.push(credential);
	},
} as unknown as BankConnectionProvider;

const deps = (setUp = true) => ({
	db,
	bank: setUp
		? {
				providerFor: () => provider,
				openCredential: async (c: { credential: string }) => `opened:${c.credential}`,
			}
		: null,
});

beforeEach(async () => {
	db = testDb();
	removed = [];
	removeError = null;
	for (const [id, parent] of [
		[householdId, parentId],
		["other", "other-parent"],
	] as const) {
		await createHouseholdForParent(db, {
			clerkUserId: `clerk-${parent}`,
			householdId: id,
			householdName: "The Rinks",
			timeZone: "America/Chicago",
			parentId: parent,
			parentName: "Alex",
		});
	}
	await addBankConnection(db, {
		householdId,
		connectionId: "conn-1",
		provider: "plaid",
		externalId: "item-1",
		institution: "Chase",
		credential: "v1:sealed",
		createdByMemberId: parentId,
	});
	await chooseBankAccounts(db, {
		householdId,
		connectionId: "conn-1",
		createdByMemberId: parentId,
		choices: (
			[
				["acc-chk", "checking", "checking"],
				["acc-cc", "credit-card", "card"],
			] as const
		).map(([externalId, kind, accountId]) => ({
			balanceId: `${accountId}-b`,
			account: { externalId, name: accountId, mask: null, kind, balance: 10_000 },
			choice: { kind: "add" as const, accountId },
		})),
	});
});

const linked = async () =>
	(await loadBankConnectionToImport(db, householdId, "conn-1"))?.accounts.map((a) => a.id);

describe("unlinkBankAccount", () => {
	it("unlinks one Account and leaves its sibling syncing, without telling the bank", async () => {
		expect(await unlinkBankAccount(deps(), { householdId, accountId: "card" })).toEqual({
			ok: true,
			disconnected: false,
		});
		expect(removed).toEqual([]);
		expect(await linked()).toEqual(["checking"]);
		expect((await loadBankConnections(db, householdId))[0]?.status).not.toBe("disconnected");
		// Unlinked already: nothing to do.
		expect(await unlinkBankAccount(deps(), { householdId, accountId: "card" })).toEqual({
			ok: false,
			reason: "not-found",
		});
	});

	it("removes the Bank Connection, at the bank too, when the last Account is unlinked", async () => {
		await unlinkBankAccount(deps(), { householdId, accountId: "card" });
		expect(await unlinkBankAccount(deps(), { householdId, accountId: "checking" })).toEqual({
			ok: true,
			disconnected: true,
		});
		expect(removed).toEqual(["opened:v1:sealed"]);
		expect(await loadBankConnections(db, householdId)).toEqual([]);
		const row = await loadBankConnectionToImport(db, householdId, "conn-1");
		expect(row).toMatchObject({ credential: "", status: "disconnected", accounts: [] });
		// Both Accounts stay, kept by hand.
		const accounts = (await loadGoals(db, viewer)).accounts;
		expect(accounts.map((a) => [a.id, a.bankConnectionId])).toEqual([
			["card", null],
			["checking", null],
		]);
	});

	it("changes nothing when the bank can't be told, or Plaid isn't set up", async () => {
		await unlinkBankAccount(deps(), { householdId, accountId: "card" });
		removeError = new BankProviderError("down", "INTERNAL_SERVER_ERROR");
		expect(await unlinkBankAccount(deps(), { householdId, accountId: "checking" })).toEqual({
			ok: false,
			reason: "bank",
		});
		expect(await unlinkBankAccount(deps(false), { householdId, accountId: "checking" })).toEqual({
			ok: false,
			reason: "not-set-up",
		});
		expect(await linked()).toEqual(["checking"]);
	});

	it("refuses another Household's Account", async () => {
		expect(await unlinkBankAccount(deps(), { householdId: "other", accountId: "card" })).toEqual({
			ok: false,
			reason: "not-found",
		});
		expect(await linked()).toEqual(["checking", "card"]);
	});
});

describe("archiveAccountAndUnlink", () => {
	it("unlinks an Account that still syncs, then archives it; its sibling goes on", async () => {
		expect(await archiveAccountAndUnlink(deps(), { householdId, accountId: "card" })).toEqual({
			ok: true,
		});
		expect(removed).toEqual([]);
		expect(await linked()).toEqual(["checking"]);
		const records = await loadGoals(db, viewer);
		expect(records.accounts.map((a) => a.id)).toEqual(["checking"]);
		expect(records.archivedAccounts.map((a) => a.id)).toEqual(["card"]);
	});

	it("refuses, before unlinking anything, while a Goal is kept in it", async () => {
		await addGoal(db, {
			householdId,
			goalId: "goal",
			accountId: "checking",
			name: "Vacation",
			targetCents: 100_000,
			targetDate: null,
			fromMonth: "2026-09",
			claimId: "claim",
			claimCents: 0,
			createdByMemberId: parentId,
		});
		expect(await archiveAccountAndUnlink(deps(), { householdId, accountId: "checking" })).toEqual({
			ok: false,
			reason: "goals",
			goals: ["Vacation"],
		});
		expect(await linked()).toEqual(["checking", "card"]);
	});

	it("refuses another Household's Account", async () => {
		expect(
			await archiveAccountAndUnlink(deps(), { householdId: "other", accountId: "card" }),
		).toEqual({ ok: false, reason: "not-found" });
		expect((await loadGoals(db, viewer)).archivedAccounts).toEqual([]);
	});
});
