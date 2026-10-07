import type { BankLine } from "@noodle/domain";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBankConnection,
	changeMoneyInKind,
	chooseBankAccounts,
	createHouseholdForParent,
	type Db,
	loadMoneyIn,
	loadTransactionsPage,
	nameTransactions,
	rememberAccountPair,
	renameTransaction,
	saveMerchantNames,
	syncBankLines,
} from "./index";
import { merchantNames, transactions, transfers } from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const parentId = "parent";

let db: Db;
let ids = 0;

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
	await addBankConnection(db, {
		householdId,
		connectionId: "conn-1",
		provider: "plaid",
		externalId: "item-1",
		institution: "First Platypus Bank",
		credential: "v1:sealed",
		createdByMemberId: parentId,
	});
	await chooseBankAccounts(db, {
		householdId,
		connectionId: "conn-1",
		createdByMemberId: parentId,
		choices: [
			{
				balanceId: "card-b",
				account: {
					externalId: "acc-cc",
					name: "Card",
					mask: null,
					kind: "credit-card",
					balance: null,
				},
				choice: { kind: "add", accountId: "card" },
			},
		],
	});
});

const line = (bankId: string, date: string, amount: number, extra: Partial<BankLine> = {}) =>
	({
		accountExternalId: "acc-cc",
		bankId,
		date,
		amount,
		description: "Netflix",
		...extra,
	}) as BankLine;

const sync = (importId: string, lines: BankLine[], removed: string[] = []) =>
	syncBankLines(db, {
		householdId,
		connectionId: "conn-1",
		accountId: "card",
		importId,
		lines,
		removed,
		createdByMemberId: parentId,
		newId: () => `id-${++ids}`,
	});

const rows = () =>
	db
		.select({
			id: transactions.id,
			externalId: transactions.externalId,
			date: transactions.date,
			amountCents: transactions.amountCents,
			pending: transactions.pending,
			note: transactions.note,
		})
		.from(transactions)
		.orderBy(asc(transactions.date), asc(transactions.id));

describe("syncBankLines", () => {
	it("brings a pending charge in as pending, then lets its posted copy take over its row", async () => {
		const first = await sync("imp-1", [line("p1", "2026-09-10", -9_99, { pending: true })]);
		expect(first).toMatchObject({ importId: "imp-1", changed: 0, removed: 0, months: ["2026-09"] });
		const [pending] = await rows();
		expect(pending).toMatchObject({ pending: true, externalId: "id:p1" });
		await db
			.update(transactions)
			.set({ note: "Kids' profile" })
			.where(eq(transactions.id, pending?.id ?? ""));

		// Posted a day later, for a little more, and the pending line is gone.
		const second = await sync(
			"imp-2",
			[line("t1", "2026-09-11", -10_49, { replaces: "p1" })],
			["p1"],
		);
		expect(second).toMatchObject({ importId: null, changed: 1, removed: 0 });
		expect(await rows()).toEqual([
			{
				id: pending?.id,
				externalId: "id:t1",
				date: "2026-09-11",
				amountCents: pending ? Math.sign(pending.amountCents) * 10_49 : 0,
				pending: false,
				note: "Kids' profile",
			},
		]);

		// The same sync again changes nothing twice.
		expect(
			await sync("imp-3", [line("t1", "2026-09-11", -10_49, { replaces: "p1" })], ["p1"]),
		).toMatchObject({ importId: null, changed: 0, removed: 0 });
		expect(await rows()).toHaveLength(1);
	});

	it("drops a pending row whose posted copy is in already", async () => {
		await sync("imp-1", [line("p1", "2026-09-10", -9_99, { pending: true })]);
		await sync("imp-2", [line("t1", "2026-09-11", -9_99)]);
		expect(await rows()).toHaveLength(2);
		await sync("imp-3", [line("t1", "2026-09-11", -9_99, { replaces: "p1" })], ["p1"]);
		expect(await rows()).toMatchObject([{ externalId: "id:t1", pending: false }]);
	});

	it("moves a modified line, and deletes one the bank removed", async () => {
		await sync("imp-1", [line("t1", "2026-09-10", -20_00), line("t2", "2026-09-12", -5_00)]);
		const result = await sync("imp-2", [line("t1", "2026-08-31", -21_00)], ["t2"]);
		expect(result).toMatchObject({ changed: 1, removed: 1, months: ["2026-08", "2026-09"] });
		expect(await rows()).toMatchObject([{ externalId: "id:t1", date: "2026-08-31" }]);
	});

	it("is null for an Account that isn't the Bank Connection's", async () => {
		expect(
			await syncBankLines(db, {
				householdId,
				connectionId: "conn-other",
				accountId: "card",
				importId: "imp-1",
				lines: [line("t1", "2026-09-10", -1_00)],
				removed: [],
				createdByMemberId: parentId,
				newId: () => "x",
			}),
		).toBeNull();
	});
});

describe("a sync that brings nothing new", () => {
	it("still marks a payment on the card that came in reading Money back", async () => {
		await sync("import-1", [
			line("b-1", "2026-09-11", 50_000, { description: "PAYMENT THANK YOU" }),
		]);
		// As it was before the card's side of a payment was read by its words.
		await db.delete(transfers);

		const result = await sync("import-2", [
			line("b-1", "2026-09-11", 50_000, { description: "PAYMENT THANK YOU" }),
		]);
		expect(result).toMatchObject({ importId: null, months: ["2026-09"] });
		const marks = await db.select().from(transfers);
		expect(marks).toHaveLength(1);
		expect(marks[0]).toMatchObject({ outTransactionId: null, createdByMemberId: null });

		// And nothing more the next time.
		expect(await sync("import-3", [])).toMatchObject({ importId: null, months: [] });
		expect(await db.select().from(transfers)).toHaveLength(1);
	});
});

describe("a remembered pair of Accounts, from a Bank Connection", () => {
	const viewer = { householdId, memberId: parentId };
	const GUSTO = "GUSTO ACME CORP";
	const into = (accountId: "chk" | "gusto", importId: string, lines: BankLine[]) =>
		syncBankLines(db, {
			householdId,
			connectionId: "conn-1",
			accountId,
			importId,
			lines: lines.map((one) => ({ ...one, accountExternalId: `acc-${accountId}` })),
			removed: [],
			createdByMemberId: parentId,
			newId: () => `id-${++ids}`,
		});
	const on = async (date: string) => {
		const found = (await loadMoneyIn(db, householdId)).find((row) => row.date === date);
		if (!found) throw new Error(`no money in on ${date}`);
		return found;
	};

	beforeEach(async () => {
		await chooseBankAccounts(db, {
			householdId,
			connectionId: "conn-1",
			createdByMemberId: parentId,
			choices: (["chk", "gusto"] as const).map((accountId) => ({
				balanceId: `${accountId}-b`,
				account: {
					externalId: `acc-${accountId}`,
					name: accountId,
					mask: null,
					kind: "checking" as const,
					balance: null,
				},
				choice: { kind: "add" as const, accountId },
			})),
		});
		// The first deposit: a Parent calls it a Transfer and says it came from Gusto.
		await into("chk", "imp-a", [line("d-1", "2026-09-03", 250_000, { description: GUSTO })]);
		const first = await on("2026-09-03");
		await changeMoneyInKind(db, viewer, {
			incomeId: first.id,
			kind: "transfer",
			transferId: "t-1",
		});
		const pair = await rememberAccountPair(db, viewer, {
			incomeId: first.id,
			otherAccountId: "gusto",
			ruleId: "pair-rule",
		});
		expect(pair).toMatchObject({ ok: true });
	});

	it("marks the next deposit the bank sends a Transfer naming the other Account", async () => {
		await into("chk", "imp-b", [line("d-2", "2026-09-17", 261_300, { description: GUSTO })]);
		expect(await on("2026-09-17")).toMatchObject({
			kind: "transfer",
			paired: false,
			otherAccountId: "gusto",
		});
	});

	it("joins money out the bank sends later, and money out that only changed as it posted", async () => {
		await into("chk", "imp-b", [line("d-2", "2026-09-17", 261_300, { description: GUSTO })]);
		// New money out of the other Account: an Import runs, and joins it.
		await into("gusto", "imp-c", [line("o-1", "2026-08-20", -250_000, { description: "PAYOUT" })]);
		expect(await on("2026-09-03")).toMatchObject({ kind: "transfer", paired: true });

		// Money out that came in at another amount, and changed to the deposit's as it posted:
		// nothing new came in, so no Import ran.
		await into("gusto", "imp-d", [
			line("o-2", "2026-09-01", -200_000, { description: "PAYOUT", pending: true }),
		]);
		expect(await on("2026-09-17")).toMatchObject({ paired: false });
		const result = await into("gusto", "imp-e", [
			line("o-2", "2026-09-01", -261_300, { description: "PAYOUT" }),
		]);
		expect(result).toMatchObject({ importId: null, changed: 1 });
		expect(await on("2026-09-17")).toMatchObject({ kind: "transfer", paired: true });
	});
});

describe("a card payment's name", () => {
	it("is a Parent's once they give it one, and background naming's is not", async () => {
		await addAccount(db, {
			householdId,
			accountId: "spare",
			name: "Spare",
			kind: "checking",
			balanceCents: 0,
			balanceId: "spare-balance",
			createdByMemberId: parentId,
		});
		await sync("import-1", [
			line("b-1", "2026-09-11", 50_000, { description: "PAYMENT THANK YOU - WEB" }),
		]);
		const viewer = { householdId, memberId: parentId };
		const row = async () =>
			(await loadTransactionsPage(db, viewer, { month: "2026-09", limit: 10 })).transactions[0];
		expect(await row()).toMatchObject({ paysCard: true, named: false, waits: false });
		// As background naming leaves it.
		await db.update(transactions).set({ merchant: "Thank You" });
		await db
			.insert(merchantNames)
			.values({ householdId, raw: "PAYMENT THANK YOU - WEB", name: "Thank You" });
		expect(await row()).toMatchObject({ merchantName: "Thank You", named: false });
		const id = (await row())?.id as string;
		await renameTransaction(db, { ...viewer, transactionId: id, name: "Visa autopay" });
		expect(await row()).toMatchObject({ merchantName: "Visa autopay", named: true });
	});

	it("is never a Parent's at any step of background naming's writes", async () => {
		await sync("import-1", [
			line("b-1", "2026-09-11", 50_000, { description: "PAYMENT THANK YOU - WEB" }),
		]);
		const viewer = { householdId, memberId: parentId };
		const row = async () =>
			(await loadTransactionsPage(db, viewer, { month: "2026-09", limit: 10 })).transactions[0];
		// The model's name, which is not the normaliser's ("Thank You"), is kept first...
		const names = [{ raw: "PAYMENT THANK YOU - WEB", name: "Visa payment" }];
		await saveMerchantNames(db, householdId, names);
		expect(await row()).toMatchObject({ merchantName: null, named: false });
		// ...and only then given to the line.
		await nameTransactions(db, householdId, new Map(names.map(({ raw, name }) => [raw, name])));
		expect(await row()).toMatchObject({ merchantName: "Visa payment", named: false });
	});
});
