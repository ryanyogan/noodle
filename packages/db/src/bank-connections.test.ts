import { beforeEach, describe, expect, it } from "vitest";
import {
	addBankConnection,
	BANK_SYNC_STALE_MS,
	chooseBankAccounts,
	claimBankSync,
	createHouseholdForParent,
	type Db,
	findBankConnectionsByExternal,
	loadBankConnections,
	loadBankConnectionsToMoveWebhook,
	loadBankConnectionsToSync,
	loadBankConnectionToImport,
	loadGoals,
	loadImports,
	markBankConnectionDisconnected,
	markBankConnectionReconnect,
	markBankConnectionReconnected,
	markBankImportFailed,
	markBankNewAccounts,
	recordBankWebhook,
	refreshBankBalances,
	releaseBankSync,
	saveBankImport,
	saveBankNotice,
	saveBankWebhookUrl,
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

/** Connects a Bank Connection, and adds both its accounts as new Accounts. */
async function connect(connectionId = "conn-1", externalId = "item-1") {
	const added = await addBankConnection(db, {
		householdId,
		connectionId,
		provider: "plaid",
		externalId,
		institution: "First Platypus Bank",
		credential: "v1:sealed",
		createdByMemberId: parentId,
	});
	if (!added.ok) return added;
	const chosen = await chooseBankAccounts(db, {
		householdId,
		connectionId,
		createdByMemberId: parentId,
		choices: [
			{
				balanceId: `${connectionId}-b1`,
				account: {
					externalId: "acc-chk",
					name: "Checking ··0000",
					mask: "0000",
					kind: "checking",
					balance: 110_00,
				},
				choice: { kind: "add", accountId: `${connectionId}-1` },
			},
			{
				balanceId: `${connectionId}-b2`,
				account: {
					externalId: "acc-cc",
					name: "Card ··3333",
					mask: "3333",
					kind: "credit-card",
					balance: null,
				},
				choice: { kind: "add", accountId: `${connectionId}-2` },
			},
		],
	});
	return chosen.ok ? { ok: true, accounts: chosen.accounts } : chosen;
}

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
			saveBankImport(db, {
				householdId,
				connectionId: "conn-1",
				from,
				to,
				status: "ready",
				notice: null,
			});
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

	it("keeps what the provider said with the last read, and nothing once it says nothing", async () => {
		await connect();
		const notice = async () => (await loadBankConnections(db, householdId))[0]?.notice;
		expect(await notice()).toBeNull();
		const save = (from: string | null, to: string, said: string | null) =>
			saveBankImport(db, {
				householdId,
				connectionId: "conn-1",
				from,
				to,
				status: "ready",
				notice: said,
			});
		await save(null, "c1", "This institution is not currently responding.");
		expect(await notice()).toBe("This institution is not currently responding.");
		await save("c1", "c2", null);
		expect(await notice()).toBeNull();
	});
});

describe("saveBankNotice", () => {
	it("keeps a refused read's notice through the failure, in its own Household only", async () => {
		await connect();
		await saveBankNotice(db, "someone-else", "conn-1", "Not theirs");
		await saveBankNotice(
			db,
			householdId,
			"conn-1",
			"This institution is not currently responding.",
		);
		await markBankImportFailed(db, householdId, "conn-1");
		const [summary] = await loadBankConnections(db, householdId);
		expect(summary).toMatchObject({
			status: "failed",
			notice: "This institution is not currently responding.",
		});
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

describe("refreshBankBalances", () => {
	it("records a balance only when it differs from the latest", async () => {
		await connect();
		const refresh = (balanceId: string, checking: number, card: number) =>
			refreshBankBalances(db, {
				householdId,
				connectionId: "conn-1",
				balances: [
					{ accountId: "conn-1-1", balanceId: `${balanceId}-1`, amountCents: checking },
					{ accountId: "conn-1-2", balanceId: `${balanceId}-2`, amountCents: card },
				],
			});
		await refresh("r1", 110_00, 42_00);
		let { accounts } = await loadGoals(db, { householdId, memberId: parentId });
		expect(accounts.map((a) => a.latestBalance?.amount ?? null)).toEqual([110_00, 42_00]);
		await refresh("r2", 95_50, 42_00);
		({ accounts } = await loadGoals(db, { householdId, memberId: parentId }));
		expect(accounts.map((a) => a.latestBalance?.amount ?? null)).toEqual([95_50, 42_00]);
		const { accountBalances } = await import("./schema");
		const rows = await db.select({ id: accountBalances.id }).from(accountBalances);
		// The first balance, the card's first, and checking's change: nothing repeated.
		expect(rows.map((r) => r.id).sort()).toEqual(["conn-1-b1", "r1-2", "r2-1"]);
	});

	it("never writes to another Bank Connection's Accounts", async () => {
		await connect();
		await refreshBankBalances(db, {
			householdId,
			connectionId: "conn-other",
			balances: [{ accountId: "conn-1-1", balanceId: "x", amountCents: 1 }],
		});
		const { accounts } = await loadGoals(db, { householdId, memberId: parentId });
		expect(accounts[0]?.latestBalance?.amount).toBe(110_00);
	});
});

describe("reconnecting a Bank Connection", () => {
	it("waits on the Parent, then is ready again, and syncs skip it meanwhile", async () => {
		await connect();
		expect(await loadBankConnectionsToSync(db)).toEqual([
			{ householdId, connectionId: "conn-1", timeZone: "America/Chicago", status: "importing" },
		]);
		expect(await markBankConnectionReconnect(db, householdId, "conn-1")).toBe(true);
		expect(await markBankConnectionReconnect(db, householdId, "conn-1")).toBe(false);
		expect((await loadBankConnections(db, householdId))[0]?.status).toBe("reconnect");
		expect(await loadBankConnectionsToSync(db)).toEqual([]);
		expect(await markBankConnectionReconnected(db, "other", "conn-1")).toBe(false);
		expect(await markBankConnectionReconnected(db, householdId, "conn-1")).toBe(true);
		expect(await markBankConnectionReconnected(db, householdId, "conn-1")).toBe(false);
		expect((await loadBankConnections(db, householdId))[0]?.status).toBe("ready");
	});

	it("finds a Bank Connection by the provider's ID for its link", async () => {
		await connect();
		expect(await findBankConnectionsByExternal(db, "plaid", "item-1")).toMatchObject([
			{ householdId, connectionId: "conn-1", timeZone: "America/Chicago" },
		]);
		expect(await findBankConnectionsByExternal(db, "plaid", "item-2")).toEqual([]);
	});

	it("disconnects a Bank Connection for good, keeping its Accounts", async () => {
		await connect();
		expect(await markBankConnectionDisconnected(db, householdId, "conn-1")).toBe(true);
		expect(await markBankConnectionDisconnected(db, householdId, "conn-1")).toBe(false);
		const [connection] = await loadBankConnections(db, householdId);
		expect(connection?.status).toBe("disconnected");
		expect(connection?.accounts).toHaveLength(2);
		expect(await loadBankConnectionsToSync(db)).toEqual([]);
		// Neither a lapsed login nor a repaired one changes it, and it has no new accounts to offer.
		expect(await markBankConnectionReconnect(db, householdId, "conn-1")).toBe(false);
		expect(await markBankConnectionReconnected(db, householdId, "conn-1")).toBe(false);
		expect(await markBankNewAccounts(db, householdId, "conn-1", true)).toBe(false);
	});

	it("records new accounts at the bank, webhooks, and where they're sent", async () => {
		await connect();
		expect(await markBankNewAccounts(db, householdId, "conn-1", true)).toBe(true);
		expect(await markBankNewAccounts(db, householdId, "conn-1", true)).toBe(false);
		const at = new Date("2026-09-20T15:00:00Z");
		await recordBankWebhook(db, householdId, "conn-1", at);
		expect((await loadBankConnections(db, householdId))[0]).toMatchObject({
			newAccounts: true,
			lastWebhookAt: at,
		});
		const url = "https://noodle.example/webhooks/plaid";
		expect(await loadBankConnectionsToMoveWebhook(db, "plaid", url)).toMatchObject([
			{ householdId, id: "conn-1" },
		]);
		await saveBankWebhookUrl(db, householdId, "conn-1", "https://old.example/webhooks/plaid");
		expect(await loadBankConnectionsToMoveWebhook(db, "plaid", url)).toHaveLength(1);
		await recordBankWebhook(db, householdId, "conn-1", at, url);
		expect(await loadBankConnectionsToMoveWebhook(db, "plaid", url)).toEqual([]);
	});

	it("lets one sync at a time have a Bank Connection, and folds later ones into the next", async () => {
		await connect();
		const now = new Date("2026-09-20T15:00:00Z");
		expect(await claimBankSync(db, householdId, "conn-1", now)).toBe(true);
		// Two more asked for while it runs: neither starts, and one more run follows.
		expect(await claimBankSync(db, householdId, "conn-1", now)).toBe(false);
		expect(await claimBankSync(db, householdId, "conn-1", now)).toBe(false);
		expect(await releaseBankSync(db, householdId, "conn-1")).toBe(true);
		expect(await claimBankSync(db, householdId, "conn-1", now)).toBe(true);
		expect(await releaseBankSync(db, householdId, "conn-1")).toBe(false);
		// A sync that died holding it is passed over after half an hour.
		expect(await claimBankSync(db, householdId, "conn-1", now)).toBe(true);
		const later = new Date(now.getTime() + BANK_SYNC_STALE_MS + 1);
		expect(await claimBankSync(db, householdId, "conn-1", later)).toBe(true);
	});
});
