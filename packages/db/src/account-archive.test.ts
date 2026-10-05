import type { BankLine } from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBankConnection,
	addGoal,
	archiveAccount,
	archiveGoal,
	chooseBankAccounts,
	createHouseholdForParent,
	type Db,
	loadAccountNames,
	loadAccountToArchive,
	loadArchivedAccounts,
	loadBankConnections,
	loadBankConnectionToImport,
	loadGoals,
	loadPairableAccounts,
	refreshBankBalances,
	restoreAccount,
	syncBankLines,
	unpairAccount,
} from "./index";
import { accountBalances, accounts, transactions } from "./schema";
import { testDb } from "./test-db";

// Archiving an Account, and unlinking one from its bank (ADR-0046).

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };

let db: Db;
let ids = 0;

const bankAccount = (externalId: string, kind: "checking" | "credit-card") => ({
	externalId,
	name: externalId,
	mask: null,
	kind,
	balance: 10_000,
});

beforeEach(async () => {
	db = testDb();
	ids = 0;
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
	await addAccount(db, {
		householdId,
		accountId: "practice",
		name: "Plaid Checking ••0000",
		kind: "checking",
		balanceCents: 110_00,
		balanceId: "practice-b0",
		createdByMemberId: parentId,
	});
	await addAccount(db, {
		householdId,
		accountId: "savings",
		name: "Savings",
		kind: "savings",
		balanceCents: 5_000_00,
		balanceId: "savings-b0",
		createdByMemberId: parentId,
	});
	// One Bank Connection with two Accounts: a checking and a card.
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
		choices: [
			{
				balanceId: "chk-b",
				account: bankAccount("acc-chk", "checking"),
				choice: { kind: "add", accountId: "chase-checking" },
			},
			{
				balanceId: "card-b",
				account: bankAccount("acc-cc", "credit-card"),
				choice: { kind: "add", accountId: "chase-card" },
			},
		],
	});
});

const line = (accountExternalId: string, bankId: string, date: string, amount: number) =>
	({ accountExternalId, bankId, date, amount, description: "Netflix" }) as BankLine;

const sync = (accountId: string, externalId: string, bankId: string) =>
	syncBankLines(db, {
		householdId,
		connectionId: "conn-1",
		accountId,
		importId: `imp-${bankId}`,
		lines: [line(externalId, bankId, "2026-09-10", -9_99)],
		removed: [],
		createdByMemberId: parentId,
		newId: () => `id-${++ids}`,
	});

const transactionsIn = (accountId: string) =>
	db
		.select({ id: transactions.id, externalId: transactions.externalId })
		.from(transactions)
		.where(eq(transactions.accountId, accountId));

const balancesOf = (accountId: string) =>
	db.select().from(accountBalances).where(eq(accountBalances.accountId, accountId));

const goal = (goalId: string, accountId: string) =>
	addGoal(db, {
		householdId,
		goalId,
		accountId,
		name: goalId,
		targetCents: 600_000,
		targetDate: null,
		fromMonth: "2026-09",
		claimId: `claim-${goalId}`,
		claimCents: 0,
		createdByMemberId: parentId,
	});

describe("archiveAccount", () => {
	it("takes it out of the lists and pickers, keeps its Transactions, and Restore brings it back", async () => {
		await unpairAccount(db, householdId, "chase-card");
		await sync("chase-checking", "acc-chk", "t1");
		const before = await transactionsIn("chase-checking");
		expect(before).toHaveLength(1);

		expect(await archiveAccount(db, { householdId, accountId: "practice" })).toEqual({ ok: true });
		const records = await loadGoals(db, viewer);
		expect(records.accounts.map((a) => a.id)).not.toContain("practice");
		expect(records.archivedAccounts.map((a) => a.id)).toEqual(["practice"]);
		expect((await loadArchivedAccounts(db, householdId)).map((a) => a.name)).toEqual([
			"Plaid Checking ••0000",
		]);
		expect((await loadPairableAccounts(db, householdId)).map((a) => a.id)).not.toContain(
			"practice",
		);
		expect((await loadAccountNames(db, householdId)).map((a) => a.name)).not.toContain(
			"Plaid Checking ••0000",
		);
		// Its balances and every other Account's rows are as they were.
		expect(await balancesOf("practice")).toHaveLength(1);
		expect(await transactionsIn("chase-checking")).toEqual(before);
		// Archived twice is refused, not rewritten.
		expect(await archiveAccount(db, { householdId, accountId: "practice" })).toEqual({
			ok: false,
			reason: "not-found",
		});

		expect(await restoreAccount(db, { householdId, accountId: "practice" })).toBe(true);
		expect(await restoreAccount(db, { householdId, accountId: "practice" })).toBe(false);
		const restored = await loadGoals(db, viewer);
		expect(restored.accounts.map((a) => a.id)).toContain("practice");
		expect(restored.archivedAccounts).toEqual([]);
	});

	it("keeps an archived Account's Transactions where they are", async () => {
		await sync("chase-card", "acc-cc", "t1");
		const before = await transactionsIn("chase-card");
		await unpairAccount(db, householdId, "chase-card");
		expect(await archiveAccount(db, { householdId, accountId: "chase-card" })).toEqual({
			ok: true,
		});
		expect(await transactionsIn("chase-card")).toEqual(before);
		expect(before[0]?.externalId).toBe("id:t1");
	});

	it("refuses another Household's Account, to archive or to restore", async () => {
		expect(await archiveAccount(db, { householdId: "other", accountId: "practice" })).toEqual({
			ok: false,
			reason: "not-found",
		});
		expect(await loadAccountToArchive(db, "other", "practice")).toBeNull();
		await archiveAccount(db, { householdId, accountId: "practice" });
		expect(await restoreAccount(db, { householdId: "other", accountId: "practice" })).toBe(false);
		expect(await loadArchivedAccounts(db, "other")).toEqual([]);
		expect((await loadGoals(db, viewer)).archivedAccounts).toHaveLength(1);
	});

	it("refuses while a Goal that isn't archived is kept in it, naming the Goal", async () => {
		expect(await goal("Vacation", "savings")).toEqual({ ok: true });
		expect(await archiveAccount(db, { householdId, accountId: "savings" })).toEqual({
			ok: false,
			reason: "goals",
			goals: ["Vacation"],
		});
		expect((await loadGoals(db, viewer)).accounts.map((a) => a.id)).toContain("savings");
		await archiveGoal(db, { householdId, goalId: "Vacation" });
		expect(await archiveAccount(db, { householdId, accountId: "savings" })).toEqual({ ok: true });
		// And no new Goal can be kept in an archived Account.
		expect(await goal("Car", "savings")).toMatchObject({ ok: false });
	});

	it("refuses one that still syncs with its bank: it's unlinked first", async () => {
		expect(await archiveAccount(db, { householdId, accountId: "chase-card" })).toEqual({
			ok: false,
			reason: "connected",
		});
		expect(await loadAccountToArchive(db, householdId, "chase-card")).toMatchObject({
			bankConnectionId: "conn-1",
			siblings: 1,
			goals: [],
			archived: false,
		});
	});
});

describe("sync, for an unlinked or archived Account", () => {
	it("skips an unlinked Account while its sibling still syncs", async () => {
		await sync("chase-card", "acc-cc", "t1");
		expect(await unpairAccount(db, householdId, "chase-card")).toBe(true);
		const balances = await balancesOf("chase-card");

		expect(await sync("chase-card", "acc-cc", "t2")).toBeNull();
		await refreshBankBalances(db, {
			householdId,
			connectionId: "conn-1",
			balances: [
				{ accountId: "chase-card", balanceId: "card-b2", amountCents: 99_999 },
				{ accountId: "chase-checking", balanceId: "chk-b2", amountCents: 12_345 },
			],
		});
		expect(await transactionsIn("chase-card")).toHaveLength(1);
		expect(await balancesOf("chase-card")).toEqual(balances);
		const toImport = await loadBankConnectionToImport(db, householdId, "conn-1");
		expect(toImport?.accounts).toEqual([{ id: "chase-checking", externalId: "acc-chk" }]);

		expect(await sync("chase-checking", "acc-chk", "t3")).toMatchObject({ importId: "imp-t3" });
		expect(await transactionsIn("chase-checking")).toHaveLength(1);
		expect((await balancesOf("chase-checking")).map((b) => b.amountCents)).toContain(12_345);
		const [connection] = await loadBankConnections(db, householdId);
		expect(connection?.accounts.map((a) => a.id)).toEqual(["chase-checking"]);
	});

	it("skips an archived Account even if it were still linked", async () => {
		await db.update(accounts).set({ archivedAt: new Date() }).where(eq(accounts.id, "chase-card"));
		const balances = await balancesOf("chase-card");
		expect(await sync("chase-card", "acc-cc", "t1")).toBeNull();
		await refreshBankBalances(db, {
			householdId,
			connectionId: "conn-1",
			balances: [{ accountId: "chase-card", balanceId: "card-b2", amountCents: 99_999 }],
		});
		expect(await transactionsIn("chase-card")).toEqual([]);
		expect(await balancesOf("chase-card")).toEqual(balances);
		const toImport = await loadBankConnectionToImport(db, householdId, "conn-1");
		expect(toImport?.accounts).toEqual([{ id: "chase-checking", externalId: "acc-chk" }]);
		expect(await sync("chase-checking", "acc-chk", "t2")).toMatchObject({ importId: "imp-t2" });
	});
});
