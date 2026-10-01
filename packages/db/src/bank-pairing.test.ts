import type { BankLine, DayKey } from "@noodle/domain";
import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBankConnection,
	type BankAccountChoice,
	chooseBankAccounts,
	createHouseholdForParent,
	type Db,
	importStatement,
	loadBankConnectionsToSync,
	loadGoals,
	loadImports,
	syncBankLines,
	unpairAccount,
} from "./index";
import { accounts, income, transactions } from "./schema";
import { testDb } from "./test-db";

// Connecting a bank pairs with the Accounts already there (ADR-0020): the pairing write, and the
// bank's lines that a statement already brought in, and the other way round.

const householdId = "household";
const parentId = "parent";

let db: Db;
let ids = 0;
const newId = () => `id-${String(++ids).padStart(4, "0")}`;

beforeEach(async () => {
	db = testDb();
	ids = 0;
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: "Alex",
	});
	for (const [accountId, name, kind] of [
		["costco", "Costco Anywhere Visa", "credit-card"],
		["chase", "Chase checking", "checking"],
	] as const) {
		await addAccount(db, {
			householdId,
			accountId,
			name,
			kind,
			balanceCents: 50_000,
			balanceId: `${accountId}-b0`,
			createdByMemberId: parentId,
		});
	}
	await addBankConnection(db, {
		householdId,
		connectionId: "conn-1",
		provider: "plaid",
		externalId: "item-1",
		institution: "First Platypus Bank",
		credential: "v1:sealed",
		createdByMemberId: parentId,
	});
});

const bankCard = {
	externalId: "acc-cc",
	name: "Costco ··3333",
	mask: "3333",
	kind: "credit-card" as const,
	balance: 61_240,
};
const bankChecking = {
	externalId: "acc-chk",
	name: "Checking ··0000",
	mask: "0000",
	kind: "checking" as const,
	balance: 125_040,
};

const choose = (choices: BankAccountChoice[]) =>
	chooseBankAccounts(db, {
		householdId,
		connectionId: "conn-1",
		createdByMemberId: parentId,
		choices,
	});

const pair = (
	account: typeof bankCard | typeof bankChecking,
	accountId: string,
): BankAccountChoice => ({
	account,
	balanceId: newId(),
	choice: { kind: "pair", accountId },
});

describe("chooseBankAccounts", () => {
	it("waits, reading nothing, until a Parent has chosen", async () => {
		expect(await loadBankConnectionsToSync(db)).toEqual([]);
		const result = await choose([
			pair(bankCard, "costco"),
			{ account: bankChecking, balanceId: newId(), choice: { kind: "leave-out" } },
		]);
		expect(result).toEqual({ ok: true, accounts: 1, first: true, refused: [] });
		expect(await loadBankConnectionsToSync(db)).toMatchObject([
			{ connectionId: "conn-1", status: "importing" },
		]);
	});

	it("keeps the paired Account, its name and kind, and makes the bank's balance its newest", async () => {
		await choose([pair(bankCard, "costco")]);
		const { accounts: held } = await loadGoals(db, { householdId, memberId: parentId });
		expect(held.find((a) => a.id === "costco")).toMatchObject({
			name: "Costco Anywhere Visa",
			kind: "credit-card",
			bankConnectionId: "conn-1",
			latestBalance: { amount: 61_240 },
		});
		// Choosing again later doesn't count as the first time.
		expect(await choose([pair(bankCard, "costco")])).toMatchObject({
			ok: true,
			first: false,
			refused: [],
		});
	});

	it("refuses a pairing across sides, an Account twice, or one connected already", async () => {
		const result = await choose([
			pair(bankChecking, "costco"),
			pair(bankCard, "costco"),
			{ ...pair(bankCard, "costco"), account: { ...bankCard, externalId: "acc-cc-2" } },
		]);
		expect(result).toMatchObject({ ok: true, accounts: 1, refused: ["acc-chk", "acc-cc-2"] });
		const [row] = await db.select().from(accounts).where(eq(accounts.id, "costco"));
		expect(row).toMatchObject({ bankConnectionId: "conn-1", externalId: "acc-cc" });
	});

	it("adds a new Account for a bank account, once", async () => {
		const add: BankAccountChoice = {
			account: bankChecking,
			balanceId: "b",
			choice: { kind: "add", accountId: "new-chk" },
		};
		await choose([add]);
		expect(
			await choose([{ ...add, choice: { kind: "add", accountId: "new-chk-2" } }]),
		).toMatchObject({
			accounts: 1,
			refused: ["acc-chk"],
		});
	});

	it("unpairs an Account, keeping it, and lets the bank account be chosen again", async () => {
		await choose([pair(bankCard, "costco")]);
		expect(await unpairAccount(db, householdId, "costco")).toBe(true);
		expect(await unpairAccount(db, householdId, "costco")).toBe(false);
		const [row] = await db.select().from(accounts).where(eq(accounts.id, "costco"));
		expect(row).toMatchObject({
			name: "Costco Anywhere Visa",
			bankConnectionId: null,
			externalId: null,
		});
		expect(await choose([pair(bankCard, "costco")])).toMatchObject({ accounts: 1, refused: [] });
	});
});

const statement = (importId: string, accountId: string, lines: [DayKey, number, string][]) =>
	importStatement(db, {
		householdId,
		importId,
		accountId,
		source: "csv",
		fileName: `${importId}.csv`,
		fileKey: null,
		lines: lines.map(([date, amount, description]) => ({
			date,
			amount,
			description,
			bankId: null,
		})),
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: parentId,
		newId,
	});

const bankLine = (
	accountExternalId: string,
	bankId: string,
	date: DayKey,
	amount: number,
	description: string,
	pending = false,
): BankLine => ({
	accountExternalId,
	bankId,
	date,
	amount,
	description,
	pending,
});

const sync = (accountId: string, lines: BankLine[], removed: string[] = []) =>
	syncBankLines(db, {
		householdId,
		connectionId: "conn-1",
		accountId,
		importId: newId(),
		lines,
		removed,
		createdByMemberId: parentId,
		newId,
	});

const spentOn = (accountId: string) =>
	db
		.select({ date: transactions.date, amount: transactions.amountCents, note: transactions.note })
		.from(transactions)
		.where(and(eq(transactions.accountId, accountId), eq(transactions.householdId, householdId)))
		.orderBy(asc(transactions.date), asc(transactions.amountCents));

describe("the bank's lines and a statement's (ADR-0020)", () => {
	beforeEach(async () => {
		await statement("stmt-1", "costco", [
			["2026-09-25", -11_230, "COSTCO WHSE #1042"],
			["2026-09-28", -3_850, "SHELL OIL 5741"],
		]);
		await choose([pair(bankCard, "costco"), pair(bankChecking, "chase")]);
	});

	it("leaves out the bank's copies of lines a statement brought in, and brings in the rest", async () => {
		const result = await sync("costco", [
			bankLine("acc-cc", "t-shell", "2026-09-29", -3_850, "Shell"),
			bankLine("acc-cc", "t-costco", "2026-09-25", -11_230, "Costco"),
			bankLine("acc-cc", "t-chipotle", "2026-09-19", -2_340, "Chipotle"),
			bankLine("acc-cc", "t-netflix", "2026-09-30", -999, "Netflix", true),
		]);
		expect(result?.importId).not.toBeNull();
		expect(await spentOn("costco")).toEqual([
			{ date: "2026-09-19", amount: 2_340, note: "Chipotle" },
			{ date: "2026-09-25", amount: 11_230, note: "COSTCO WHSE #1042" },
			{ date: "2026-09-28", amount: 3_850, note: "SHELL OIL 5741" },
			{ date: "2026-09-30", amount: 999, note: "Netflix" },
		]);
		const [bankImport] = await loadImports(db, householdId, "costco", result?.importId ?? "");
		expect(bankImport).toMatchObject({ transactionCount: 2, duplicateCount: 2 });

		// The bank sends the same line again (changed, say): it's still the statement's.
		await sync("costco", [bankLine("acc-cc", "t-shell", "2026-09-28", -3_850, "SHELL")]);
		expect(await spentOn("costco")).toHaveLength(4);
	});

	it("never pairs a pending line, or one line twice", async () => {
		await sync("costco", [
			bankLine("acc-cc", "t-shell-pending", "2026-09-28", -3_850, "Shell", true),
			bankLine("acc-cc", "t-shell-1", "2026-09-28", -3_850, "Shell"),
			bankLine("acc-cc", "t-shell-2", "2026-09-28", -3_850, "Shell"),
		]);
		expect((await spentOn("costco")).filter((row) => row.amount === 3_850)).toHaveLength(3);
	});

	it("pairs money in on checking too", async () => {
		await statement("stmt-2", "chase", [["2026-09-15", 240_000, "ACME CORP PAYROLL"]]);
		await sync("chase", [bankLine("acc-chk", "t-pay", "2026-09-16", 240_000, "Acme Payroll")]);
		const received = await db.select().from(income).where(eq(income.accountId, "chase"));
		expect(received).toHaveLength(1);
	});

	it("leaves out a statement's lines the bank brought in already", async () => {
		await sync("costco", [bankLine("acc-cc", "t-chipotle", "2026-09-19", -2_340, "Chipotle")]);
		const result = await statement("stmt-3", "costco", [
			["2026-09-18", -2_340, "CHIPOTLE 0921"],
			["2026-09-12", -4_000, "TARGET"],
		]);
		expect(result).toMatchObject({ ok: true, import: { transactionCount: 1, duplicateCount: 1 } });
		expect((await spentOn("costco")).filter((row) => row.amount === 2_340)).toHaveLength(1);
	});
});
