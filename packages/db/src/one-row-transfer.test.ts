import type { DayKey, MonthKey, StatementLine } from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	createHouseholdForParent,
	type Db,
	deleteTransactions,
	importStatement,
	loadTransaction,
	loadTransactionsPage,
	loadTransfer,
	markTransfer,
	summarizeDeletion,
	type TransactionSort,
	unmarkTransfer,
} from "./index";
import { income, transactions } from "./schema";
import { testDb } from "./test-db";

// A Transfer with both sides in Noodle is one row of the Transactions list (issue 152, ADR-0062):
// the side the money left. The arriving side, a Transaction on a card or a line of money in, is
// listed where the list is narrowed to its Account, and nowhere under "Money in".

const householdId = "household";
const viewer = { householdId, memberId: "alex" };
const month: MonthKey = "2026-09";

const SORTS: TransactionSort[] = [
	"newest",
	"oldest",
	"largest",
	"smallest",
	"name-az",
	"name-za",
	"assigned-az",
	"assigned-za",
	"account-az",
	"account-za",
];

let db: Db;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;

const line = (date: DayKey, amount: number, description: string): StatementLine => ({
	date,
	amount,
	description,
	bankId: null,
});

const importInto = (accountId: string, importId: string, lines: StatementLine[]) =>
	importStatement(db, {
		householdId,
		importId,
		accountId,
		source: "csv",
		fileName: null,
		fileKey: null,
		lines,
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: "alex",
		newId,
	});

type Query = Omit<Parameters<typeof loadTransactionsPage>[2], "limit" | "after">;

/** Every page of the Transactions page's list, `limit` at a time. */
async function paged(query: Query, limit: number) {
	const rows = [];
	let after: Parameters<typeof loadTransactionsPage>[2]["after"];
	let pages = 0;
	do {
		const page = await loadTransactionsPage(db, viewer, {
			month,
			moneyIn: true,
			...query,
			after,
			limit,
		});
		expect(page.transactions.length).toBeLessThanOrEqual(limit);
		rows.push(...page.transactions);
		after = page.next ?? undefined;
		pages += 1;
	} while (after && pages < 50);
	return rows;
}

const first = (query: Query = {}) =>
	loadTransactionsPage(db, viewer, { month, moneyIn: true, ...query, limit: 50 });

const notes = (rows: { note: string | null }[]) => rows.map((row) => row.note).sort();

const CARD_OUT = "ONLINE PMT TO KESTREL CARD";
const CARD_IN = "PAYMENT RECEIVED THANK YOU";
const SAVE_OUT = "MOVE TO RAINY DAY";
const SAVE_IN = "FROM EVERYDAY ACCT";
const ALONE_OUT = "PMT TO A CARD ELSEWHERE";
const ALONE_IN = "PAYMENT FROM A BANK ELSEWHERE";

beforeEach(async () => {
	db = testDb();
	nextId = 0;
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	for (const [accountId, name, kind] of [
		["everyday", "Everyday", "checking"],
		["rainy", "Rainy Day", "savings"],
		["kestrel", "Kestrel Card", "credit-card"],
	] as const) {
		await addAccount(db, {
			householdId,
			accountId,
			name,
			kind,
			balanceCents: 0,
			balanceId: `${accountId}-balance`,
			createdByMemberId: "alex",
		});
	}
	await importInto("everyday", "i-1", [
		line("2026-09-01", 300_000, "ACME PAYROLL"),
		line("2026-09-02", -4_200, "Corner Grocer"),
		line("2026-09-05", -61_300, CARD_OUT),
		line("2026-09-08", -40_000, SAVE_OUT),
		line("2026-09-12", -7_700, ALONE_OUT),
		line("2026-09-20", -900, "Pine Street Cafe"),
	]);
	await importInto("kestrel", "i-2", [
		line("2026-09-03", -2_500, "Harbor Hardware"),
		line("2026-09-06", 61_300, CARD_IN),
		line("2026-09-14", 3_300, ALONE_IN),
	]);
	await importInto("rainy", "i-3", [
		line("2026-09-08", 40_000, SAVE_IN),
		line("2026-09-09", 25, "Interest paid"),
	]);
});

/** A row of `transactions` or of `income` by its wording, whatever the list shows. */
async function idOf(note: string): Promise<string> {
	const rows = [
		...(await db
			.select({ id: transactions.id })
			.from(transactions)
			.where(eq(transactions.note, note))),
		...(await db.select({ id: income.id }).from(income).where(eq(income.note, note))),
	];
	expect(rows).toHaveLength(1);
	return rows[0]?.id ?? "";
}

async function transferIdOf(transactionId: string): Promise<string> {
	const transfer = await loadTransfer(db, viewer, transactionId);
	return transfer.kind === "transfer" ? transfer.transferId : "";
}

describe("a Transfer with both sides in Noodle is one row of the Transactions list", () => {
	it("pairs the card payment and the move to savings when they are brought in", async () => {
		const card = await loadTransfer(db, viewer, await idOf(CARD_OUT));
		expect(card.kind === "transfer" ? card.peer?.note : null).toBe(CARD_IN);
		const save = await loadTransaction(db, viewer, await idOf(SAVE_OUT));
		expect(save?.transfer).toMatchObject({ from: "Everyday", to: "Rainy Day" });
	});

	it("lists the side the money left, with both Accounts and a plain amount", async () => {
		const page = await first();
		const listed = notes(page.transactions);
		expect(listed).toContain(CARD_OUT);
		expect(listed).not.toContain(CARD_IN);
		expect(listed).toContain(SAVE_OUT);
		expect(listed).not.toContain(SAVE_IN);
		const card = page.transactions.find((row) => row.note === CARD_OUT);
		expect(card?.transfer).toMatchObject({ from: "Everyday", to: "Kestrel Card" });
		expect(card?.amountCents).toBe(61_300);
		expect(card?.moneyIn).toBeUndefined();
		const save = page.transactions.find((row) => row.note === SAVE_OUT);
		expect(save?.transfer).toMatchObject({ from: "Everyday", to: "Rainy Day" });
		expect(save?.amountCents).toBe(40_000);
		// Nothing with a Transfer's wording is money coming in.
		expect(page.transactions.filter((row) => row.transfer?.from && row.transfer.to)).toHaveLength(
			2,
		);
	});

	for (const sort of SORTS) {
		it(`lists each once by ${sort}, whatever the page's size`, async () => {
			const whole = await paged({ sort }, 50);
			const ids = whole.map((row) => row.id);
			expect(new Set(ids).size).toBe(ids.length);
			expect(notes(whole).filter((note) => note === CARD_OUT || note === SAVE_OUT)).toHaveLength(2);
			expect(notes(whole).filter((note) => note === CARD_IN || note === SAVE_IN)).toEqual([]);
			for (const limit of [1, 2, 3, 4, 7]) {
				expect((await paged({ sort }, limit)).map((row) => row.id)).toEqual(ids);
			}
		});
	}

	it("lists a side under its own Account, where it is the only side there", async () => {
		expect(notes(await paged({ accountId: "kestrel" }, 2))).toEqual(
			[ALONE_IN, CARD_IN, "Harbor Hardware"].sort(),
		);
		expect(notes(await paged({ accountId: "rainy" }, 1))).toEqual(
			["Interest paid", SAVE_IN].sort(),
		);
		const everyday = notes(await paged({ accountId: "everyday" }, 3));
		expect(everyday).toContain(CARD_OUT);
		expect(everyday).toContain(SAVE_OUT);
		expect(everyday).toHaveLength(6);
		// An Account's own list, which doesn't ask for money in, has the card's side as before.
		const own = await loadTransactionsPage(db, viewer, { accountId: "kestrel", limit: 50 });
		expect(notes(own.transactions)).toContain(CARD_IN);
		// And a list that isn't the Transactions page's (the export) has both sides.
		const every = await loadTransactionsPage(db, viewer, { sort: "oldest", limit: 50 });
		expect(notes(every.transactions)).toEqual(expect.arrayContaining([CARD_OUT, CARD_IN]));
	});

	it("leaves the arriving side out of Money in, and the leaving side in Money out", async () => {
		const onlyIn = notes(await paged({ show: "in" }, 2));
		expect(onlyIn).toEqual(["ACME PAYROLL", "Interest paid"]);
		// Narrowed to the Account it came into as well: it is still not money in to the Household.
		expect(notes(await paged({ show: "in", accountId: "rainy" }, 2))).toEqual(["Interest paid"]);
		const onlyOut = notes(await paged({ show: "out" }, 3));
		expect(onlyOut).toEqual(expect.arrayContaining([CARD_OUT, SAVE_OUT]));
		expect(onlyOut).not.toContain(CARD_IN);
	});

	it("has figures that agree with the rows listed", async () => {
		const page = await first();
		const counted = page.transactions.filter((row) => !row.transfer);
		const out = counted.filter((row) => !row.moneyIn);
		const came = counted.filter((row) => row.moneyIn && !row.moneyIn.needsReview);
		expect(page.summary?.outCents).toBe(out.reduce((sum, row) => sum + row.amountCents, 0));
		expect(page.summary?.inCents).toBe(came.reduce((sum, row) => sum + -row.amountCents, 0));
		expect(page.summary?.inCents).toBe(300_000 + 25);
		expect(page.total).toBe(page.summary?.outCents);
		// As they were with both sides listed: neither side of a Transfer ever counted.
		const both = await loadTransactionsPage(db, viewer, { month, limit: 50 });
		expect(both.summary?.outCents).toBe(page.summary?.outCents);
		expect(page.summary?.needsReview).toBe(
			page.transactions.filter((row) => row.waits || row.moneyIn?.needsReview).length,
		);
	});

	it("finds the one row by either side's wording", async () => {
		expect(notes(await paged({ search: "thank you" }, 50))).toEqual([CARD_OUT]);
		expect(notes(await paged({ search: "everyday acct" }, 50))).toEqual([SAVE_OUT]);
		expect(notes(await paged({ search: "kestrel" }, 50))).toEqual([CARD_OUT]);
		// Narrowed to the card, the card's side is found by its own words alone.
		expect(notes(await paged({ search: "thank you", accountId: "kestrel" }, 50))).toEqual([
			CARD_IN,
		]);
		expect(await paged({ search: "online pmt", accountId: "kestrel" }, 50)).toEqual([]);
	});

	it("leaves a side marked alone as it was", async () => {
		const before = await first();
		const outId = await idOf(ALONE_OUT);
		const inId = await idOf(ALONE_IN);
		await markTransfer(db, viewer, { transferId: newId(), transactionId: outId });
		await markTransfer(db, viewer, { transferId: newId(), transactionId: inId });
		const after = await first();
		expect(after.transactions.map((row) => row.id)).toEqual(
			before.transactions.map((row) => row.id),
		);
		const out = after.transactions.find((row) => row.id === outId);
		expect(out?.transfer).toMatchObject({ from: "Everyday", to: null });
		// A payment arriving on the card from an Account that isn't followed: listed, as money back.
		const arrived = after.transactions.find((row) => row.id === inId);
		expect(arrived?.transfer).toMatchObject({ from: null, to: "Kestrel Card" });
		expect(arrived?.amountCents).toBe(-3_300);
	});

	it("brings both rows back when it is unmarked, and opens either side by its ID", async () => {
		const cardOut = await idOf(CARD_OUT);
		const cardIn = await idOf(CARD_IN);
		// The side that isn't listed still opens, as the other side's detail links to it.
		expect((await loadTransaction(db, viewer, cardIn))?.note).toBe(CARD_IN);
		expect((await unmarkTransfer(db, viewer, await transferIdOf(cardOut))).ok).toBe(true);
		const page = await first();
		expect(notes(page.transactions)).toEqual(expect.arrayContaining([CARD_OUT, CARD_IN]));
		expect(page.transactions.find((row) => row.id === cardIn)?.amountCents).toBe(-61_300);

		const saveOut = await idOf(SAVE_OUT);
		expect((await unmarkTransfer(db, viewer, await transferIdOf(saveOut))).ok).toBe(true);
		const again = notes((await first()).transactions);
		expect(again).toEqual(expect.arrayContaining([SAVE_OUT, SAVE_IN]));
		expect(new Set(again).size).toBe(again.length);
	});

	it("selects what is listed, and deleting the one row leaves the other side's own row", async () => {
		const listed = (await first({ show: "out" })).transactions;
		const all = await summarizeDeletion(db, viewer, { all: { month } });
		expect(all.count).toBe(listed.length);
		expect(all.transfers).toBe(2);
		// Found by the arriving side's words, the selection is the row the search lists.
		expect(
			(await summarizeDeletion(db, viewer, { all: { month, search: "thank you" } })).count,
		).toBe(1);
		// Narrowed to the card, it is the card's side.
		const onCard = await summarizeDeletion(db, viewer, { all: { month, accountId: "kestrel" } });
		expect(onCard.count).toBe(3);

		const cardIn = await idOf(CARD_IN);
		const saveIn = await idOf(SAVE_IN);
		const done = await deleteTransactions(db, viewer, { all: { month } });
		expect(done.deleted).toBe(listed.length);
		// Each arriving side is kept, no longer a Transfer's: a row of the list again.
		const left = await first();
		expect(notes(left.transactions)).toEqual(
			["ACME PAYROLL", "Interest paid", CARD_IN, SAVE_IN].sort(),
		);
		expect(left.transactions.find((row) => row.id === cardIn)?.transfer).toBeNull();
		expect(left.transactions.find((row) => row.id === saveIn)?.moneyIn).toBeTruthy();
	});
});
