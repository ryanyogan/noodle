import type { BankLine } from "@noodle/domain";
import { asc } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { importStatement } from "./imports";
import {
	addBankConnection,
	chooseBankAccounts,
	createHouseholdForParent,
	type Db,
	deleteTransaction,
	deleteTransactions,
	loadTransactionsPage,
	summarizeDeletion,
	syncBankLines,
} from "./index";
import {
	deletedBankLines,
	income,
	monthCloses,
	refunds,
	splits,
	transactions,
	transfers,
} from "./schema";
import { testDb } from "./test-db";

// Deleting Transactions for good (#97, ADR-0045): one, or many at once; a bank or statement line
// a Parent deleted never comes back with a later Import.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };

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
			{
				balanceId: "checking-b",
				account: {
					externalId: "acc-chk",
					name: "Checking",
					mask: null,
					kind: "checking",
					balance: null,
				},
				choice: { kind: "add", accountId: "checking" },
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
		description: `Shop ${bankId}`,
		...extra,
	}) as BankLine;

const sync = (importId: string, lines: BankLine[], accountId = "card") =>
	syncBankLines(db, {
		householdId,
		connectionId: "conn-1",
		accountId,
		importId,
		lines,
		removed: [],
		createdByMemberId: parentId,
		newId: () => `id-${++ids}`,
	});

const rows = () =>
	db
		.select({
			id: transactions.id,
			externalId: transactions.externalId,
			version: transactions.version,
		})
		.from(transactions)
		.orderBy(asc(transactions.externalId));
const kept = async () => (await rows()).map((row) => row.externalId);
const idOf = async (bankId: string) =>
	(await rows()).find((row) => row.externalId === `id:${bankId}`)?.id as string;
const remembered = async () =>
	(await db.select().from(deletedBankLines).orderBy(asc(deletedBankLines.externalId))).map(
		(row) => `${row.accountId} ${row.externalId}`,
	);
const deleteOne = async (bankId: string) =>
	deleteTransaction(db, { householdId, memberId: parentId, transactionId: await idOf(bankId) });

describe("a deleted bank line stays deleted", () => {
	it("when the bank sends it again, or changes it", async () => {
		await sync("imp-1", [line("n1", "2026-09-03", -1599), line("n2", "2026-09-04", -900)]);
		expect(await deleteOne("n1")).toEqual({ ok: true, version: null });
		expect(await kept()).toEqual(["id:n2"]);
		expect(await remembered()).toEqual(["card id:n1"]);

		const again = await sync("imp-2", [line("n1", "2026-09-03", -1599)]);
		// Nothing new, so no Import is recorded for it.
		expect(again?.importId).toBeNull();
		await sync("imp-3", [line("n1", "2026-09-05", -1699), line("n3", "2026-09-06", -100)]);
		expect(await kept()).toEqual(["id:n2", "id:n3"]);
	});

	it("when it was pending and its posted copy arrives, and when that copy changes later", async () => {
		await sync("imp-1", [line("p1", "2026-09-03", -1599, { pending: true })]);
		await deleteOne("p1");
		await sync("imp-2", [line("q1", "2026-09-04", -1650, { replaces: "p1" })]);
		expect(await kept()).toEqual([]);
		await sync("imp-3", [line("q1", "2026-09-04", -1700)]);
		expect(await kept()).toEqual([]);
		expect(await remembered()).toEqual(["card id:p1", "card id:q1"]);
	});

	it("when the same statement is uploaded again", async () => {
		const upload = (importId: string) =>
			importStatement(db, {
				householdId,
				importId,
				accountId: "card",
				source: "csv",
				fileName: "september.csv",
				fileKey: null,
				lines: [
					{ date: "2026-09-03", amount: -1599, description: "Netflix" },
					{ date: "2026-09-04", amount: -900, description: "Hulu" },
				] as never,
				closingBalance: null,
				csvMapping: null,
				createdByMemberId: parentId,
				newId: () => `id-${++ids}`,
			});
		await upload("s1");
		const all = await db.select().from(transactions);
		const netflix = all.find((row) => row.note === "Netflix");
		await deleteTransaction(db, {
			householdId,
			memberId: parentId,
			transactionId: netflix?.id as string,
		});
		const second = await upload("s2");
		expect(second.ok && second.import.transactionCount).toBe(0);
		expect(second.ok && second.import.duplicateCount).toBe(2);
		expect((await db.select().from(transactions)).map((row) => row.note)).toEqual(["Hulu"]);
	});

	it("a Quick Add has no line to remember", async () => {
		await db.insert(transactions).values({
			id: "qa",
			householdId,
			source: "quick-add",
			date: "2026-09-03",
			amountCents: 500,
			createdByMemberId: parentId,
		});
		await deleteTransaction(db, { householdId, memberId: parentId, transactionId: "qa" });
		expect(await db.select().from(transactions)).toEqual([]);
		expect(await remembered()).toEqual([]);
	});
});

describe("deleting many at once", () => {
	const upToSeptember = { all: { month: "2026-09" as const, andEarlier: true, accountId: "card" } };

	/** Five charges and money back on the card over three months, with links; a deposit in checking. */
	async function history() {
		await sync("imp-1", [
			line("a", "2026-08-10", -1000),
			line("b", "2026-08-11", -2000),
			line("c", "2026-09-05", -3000),
			line("d", "2026-09-06", -4000),
			line("e", "2026-10-02", -5000),
			line("r", "2026-10-03", 1000),
		]);
		await sync(
			"imp-2",
			[line("pay", "2026-09-15", 250000, { accountExternalId: "acc-chk" })],
			"checking",
		);
		const [a, b, c, e, r] = await Promise.all(["a", "b", "c", "e", "r"].map(idOf));
		// Whatever the Import marked on its own is cleared, so the links are only the ones below.
		await db.delete(transfers);
		await db.insert(splits).values([
			{ id: "s1", householdId, transactionId: b as string, position: 0, amountCents: 1500 },
			{ id: "s2", householdId, transactionId: b as string, position: 1, amountCents: 500 },
		]);
		await db.insert(transfers).values({
			id: "x1",
			householdId,
			outTransactionId: c as string,
			inTransactionId: e as string,
		});
		await db.insert(refunds).values({
			id: "r1",
			householdId,
			refundTransactionId: r as string,
			originalTransactionId: a as string,
		});
		await db.insert(monthCloses).values({ id: "mc", householdId, month: "2026-08" });
	}

	it("says what it would touch before anything happens", async () => {
		await history();
		expect(await summarizeDeletion(db, viewer, upToSeptember)).toEqual({
			count: 4,
			firstDate: "2026-08-10",
			lastDate: "2026-09-06",
			totalCents: 10000,
			accounts: ["Card"],
			filed: 1,
			split: 1,
			transfers: 1,
			refunds: 1,
			receipts: 0,
			closedMonths: 2,
			imported: 4,
			staying: 0,
		});
		expect(await kept()).toHaveLength(6);
	});

	it("selects what the list shows for the same filters", async () => {
		await history();
		const september = { month: "2026-09" as const, accountId: "card" };
		const listed = await loadTransactionsPage(db, viewer, { ...september, limit: 50 });
		const summary = await summarizeDeletion(db, viewer, { all: september });
		expect(summary.count).toBe(listed.transactions.length);
		expect(summary.count).toBe(2);
		// Left out by hand, and by words in the note.
		const except = [listed.transactions[0]?.id as string];
		expect((await summarizeDeletion(db, viewer, { all: september, except })).count).toBe(1);
		expect(
			(await summarizeDeletion(db, viewer, { all: { ...september, search: "shop C" } })).count,
		).toBe(1);
		expect((await summarizeDeletion(db, viewer, { all: { month: "2026-09" } })).count).toBe(2);
		expect((await summarizeDeletion(db, viewer, { ids: except })).count).toBe(1);
		// Another Household's Parent selects nothing here.
		const stranger = { householdId: "other", memberId: "someone" };
		expect((await summarizeDeletion(db, stranger, { ids: except })).count).toBe(0);
	});

	it("deletes them with what hangs off them, after the callback, and a retry changes nothing", async () => {
		await history();
		const told: number[] = [];
		const beforeDeleting = async (count: number) => {
			told.push(count);
			// Nothing has gone yet when the snapshot is taken.
			expect(await kept()).toHaveLength(6);
		};
		expect(await deleteTransactions(db, viewer, upToSeptember, { beforeDeleting })).toEqual({
			deleted: 4,
			kept: 0,
		});
		expect(await kept()).toEqual(["id:e", "id:r"]);
		expect(await db.select().from(splits)).toEqual([]);
		// The other side of the Transfer stays, an ordinary Transaction again.
		expect(await db.select().from(transfers)).toEqual([]);
		// The money back is no longer a Refund of anything.
		expect(await db.select().from(refunds)).toEqual([]);
		expect((await rows()).find((row) => row.externalId === "id:r")?.version).toBe(1);
		// Money in (the income table) isn't a Transaction and stays.
		expect(await db.select().from(income)).toHaveLength(1);
		expect(await remembered()).toEqual(["card id:a", "card id:b", "card id:c", "card id:d"]);

		expect(await deleteTransactions(db, viewer, upToSeptember, { beforeDeleting })).toEqual({
			deleted: 0,
			kept: 0,
		});
		expect(told).toEqual([4]);

		// The bank sending everything again brings none of them back.
		await sync("imp-3", [
			line("a", "2026-08-10", -1000),
			line("b", "2026-08-12", -2100),
			line("c", "2026-09-05", -3000),
			line("d", "2026-09-06", -4000),
			line("e", "2026-10-02", -5000),
		]);
		expect(await kept()).toEqual(["id:e", "id:r"]);
	});

	it("deletes nothing when the callback fails", async () => {
		await history();
		await expect(
			deleteTransactions(db, viewer, upToSeptember, {
				beforeDeleting: async () => {
					throw new Error("no snapshot");
				},
			}),
		).rejects.toThrow("no snapshot");
		expect(await kept()).toHaveLength(6);
		expect(await remembered()).toEqual([]);
		expect(await db.select().from(splits)).toHaveLength(2);
	});

	it("deletes the ones picked by hand", async () => {
		await history();
		const picked = { ids: [await idOf("d"), await idOf("e"), "not-one"] };
		expect(await deleteTransactions(db, viewer, picked)).toEqual({ deleted: 2, kept: 0 });
		expect(await kept()).toEqual(["id:a", "id:b", "id:c", "id:r"]);
	});

	it("deletes more than one batch holds", async () => {
		await sync(
			"imp-1",
			Array.from({ length: 230 }, (_, i) => line(`n${i}`, "2026-09-15", -100 - i)),
		);
		await db.delete(transfers);
		const all = { all: { month: "2026-09" as const } };
		expect((await summarizeDeletion(db, viewer, all)).count).toBe(230);
		expect(await deleteTransactions(db, viewer, all)).toEqual({ deleted: 230, kept: 0 });
		expect(await kept()).toEqual([]);
		expect(await remembered()).toHaveLength(230);
	});
});
