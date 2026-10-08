import type { DayKey, MonthKey, StatementLine } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	changeMoneyInKind,
	createHouseholdForParent,
	type Db,
	importStatement,
	listOrder,
	loadMoneyInRow,
	loadTransaction,
	loadTransactionsPage,
	summarizeDeletion,
	type TransactionSort,
} from "./index";
import { testDb } from "./test-db";

// Money in as rows of the Transactions table (issue 152, ADR-0061): `income` and `transactions`
// read as one list, in every order, a page at a time, under the list's filters, with figures that
// agree with what is listed.

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

/** Every page of the list, `limit` at a time. */
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
		["checking", "Checking", "checking"],
		["savings", "Savings", "savings"],
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
	// Money in and money out on the same days, with the same amounts and wording here and there,
	// so every order has ties that only the date and the ID settle.
	await importInto("checking", "i-1", [
		line("2026-09-01", 300_000, "ACME PAYROLL"),
		line("2026-09-01", -4_200, "Corner Grocer"),
		line("2026-09-03", -4_200, "Pine Street Cafe"),
		line("2026-09-03", 4_200, "Zelle payment from PAT MOSS 10293847"),
		line("2026-09-10", -12_000, "Harbor Hardware"),
		line("2026-09-10", 1_500, "HARBOR HARDWARE REFUND"),
		line("2026-09-15", 300_000, "ACME PAYROLL"),
		line("2026-09-15", -900, "Pine Street Cafe"),
		line("2026-09-20", -31_000, "Lakeside Electric"),
	]);
	await importInto("savings", "i-2", [
		line("2026-09-02", 25, "Interest paid"),
		line("2026-09-18", 50_000, "Deposit at branch"),
		line("2026-09-18", -700, "Monthly fee"),
	]);
});

describe("money in is listed in the Transactions table", () => {
	it("is in the list as rows with a negative amount and the line itself", async () => {
		const page = await first();
		const moneyIn = page.transactions.filter((row) => row.moneyIn);
		expect(moneyIn).toHaveLength(6);
		expect(page.transactions).toHaveLength(12);
		for (const row of moneyIn) {
			expect(row.amountCents).toBe(-(row.moneyIn?.amount ?? 0));
			expect(row.id).toBe(row.moneyIn?.id);
		}
		const pay = moneyIn.find((row) => row.note === "ACME PAYROLL");
		expect(pay?.importedFrom).toBe("Checking");
		expect(pay?.moneyIn?.kind).toBe("income");
		// Newest first, with spending and money in of a day together.
		expect(page.transactions.map((row) => row.date)).toEqual(
			[...page.transactions.map((row) => row.date)].sort().reverse(),
		);
	});

	it("is left out unless the list asks for it", async () => {
		const page = await loadTransactionsPage(db, viewer, { month, limit: 50 });
		expect(page.transactions.some((row) => row.moneyIn)).toBe(false);
		expect(page.transactions).toHaveLength(6);
	});

	for (const sort of SORTS) {
		it(`pages ${sort} with no row missing or twice, whatever the page's size`, async () => {
			const whole = await paged({ sort }, 50);
			expect(whole).toHaveLength(12);
			expect(new Set(whole.map((row) => row.id)).size).toBe(12);
			for (const limit of [1, 2, 3, 5, 7, 11, 12]) {
				const rows = await paged({ sort }, limit);
				expect(rows.map((row) => row.id)).toEqual(whole.map((row) => row.id));
			}
		});
	}

	it("orders both kinds of row together under each sort", async () => {
		const byAmount = (await paged({ sort: "largest" }, 4)).map((row) => row.amountCents);
		expect(byAmount).toEqual([...byAmount].sort((a, b) => b - a));
		// Money in is the smallest there is: it ends a list by largest and starts one by smallest.
		expect(byAmount.at(-1)).toBe(-300_000);
		const smallest = (await paged({ sort: "smallest" }, 4)).map((row) => row.amountCents);
		expect(smallest).toEqual([...byAmount].reverse());

		const names = (await paged({ sort: "name-az" }, 4)).map((row) =>
			(row.merchantName ?? row.note ?? "").toLowerCase(),
		);
		// Both tables' rows run through one another: money in isn't a block of its own.
		const kinds = (await paged({ sort: "name-az" }, 4)).map((row) => Boolean(row.moneyIn));
		expect(new Set(kinds.slice(0, 6)).size).toBe(2);
		expect(names).toHaveLength(12);

		const accounts = (await paged({ sort: "account-az" }, 4)).map((row) => row.importedFrom);
		expect(accounts).toEqual([...accounts].sort());
		const back = (await paged({ sort: "account-za" }, 4)).map((row) => row.id);
		expect(back).toEqual((await paged({ sort: "account-az" }, 5)).map((row) => row.id).reverse());

		const oldest = (await paged({ sort: "oldest" }, 5)).map((row) => row.id);
		expect(oldest).toEqual((await paged({ sort: "newest" }, 5)).map((row) => row.id).reverse());
	});

	it("follows the list's filters", async () => {
		const savings = await paged({ accountId: "savings" }, 2);
		expect(savings.map((row) => row.note).sort()).toEqual([
			"Deposit at branch",
			"Interest paid",
			"Monthly fee",
		]);
		const found = await paged({ search: "harbor" }, 50);
		expect(found.map((row) => Boolean(row.moneyIn)).sort()).toEqual([false, true]);
		// A search finds "%" and "_" as typed, in money in as in spending.
		expect(await paged({ search: "100%" }, 50)).toEqual([]);

		const onlyIn = await paged({ show: "in" }, 4);
		expect(onlyIn).toHaveLength(6);
		expect(onlyIn.every((row) => row.moneyIn)).toBe(true);
		const onlyOut = await paged({ show: "out" }, 4);
		expect(onlyOut).toHaveLength(6);
		expect(onlyOut.some((row) => row.moneyIn)).toBe(false);

		// Money in is in no Bucket and For nobody.
		expect((await paged({ forMember: "alex" }, 50)).some((row) => row.moneyIn)).toBe(false);

		// Another month, and a range of months ending at this one.
		expect(await paged({ month: "2026-08" }, 50)).toEqual([]);
		expect(await paged({ month: "2026-10", fromMonth: "2026-08" }, 5)).toHaveLength(12);
		expect(await paged({ month: "2026-10", andEarlier: true, show: "in" }, 5)).toHaveLength(6);
	});

	it("says what came in, what of it is Income and what waits, as the rows do", async () => {
		const page = await first();
		const lines = page.transactions.flatMap((row) => (row.moneyIn ? [row.moneyIn] : []));
		const waiting = lines.filter((one) => one.needsReview);
		// Person-to-person wording, and what reads as a refund, wait in Review until a Parent says
		// what they are.
		expect(waiting.map((one) => one.note).sort()).toEqual([
			"HARBOR HARDWARE REFUND",
			"Zelle payment from PAT MOSS 10293847",
		]);
		const counted = lines.filter((one) => !one.needsReview);
		expect(page.summary?.inCents).toBe(counted.reduce((sum, one) => sum + one.amount, 0));
		expect(page.summary?.inCents).toBe(300_000 + 300_000 + 25 + 50_000);
		expect(page.summary?.needsReview).toBeGreaterThanOrEqual(1);
		const before = page.summary?.needsReview ?? 0;

		// Only what waits, of both kinds.
		const review = await paged({ review: true }, 2);
		expect(
			review
				.filter((row) => row.moneyIn)
				.map((row) => row.id)
				.sort(),
		).toEqual(waiting.map((one) => one.id).sort());
		expect(review).toHaveLength(before);

		// Said to be Paid back: it came in, and isn't Income; a Transfer came in nowhere.
		const zelle = waiting.find((one) => one.note?.startsWith("Zelle"));
		await changeMoneyInKind(db, viewer, {
			incomeId: zelle?.id ?? "",
			kind: "paid-back",
			transferId: newId(),
		});
		const branch = lines.find((one) => one.note === "Deposit at branch");
		await changeMoneyInKind(db, viewer, {
			incomeId: branch?.id ?? "",
			kind: "transfer",
			transferId: newId(),
		});
		const after = await first();
		expect(after.summary?.inCents).toBe(300_000 + 300_000 + 25 + 4_200);
		expect(after.summary?.incomeCents).toBe(300_000 + 300_000 + 25);
		expect(after.summary?.needsReview).toBe(before - 1);
		const moved = after.transactions.find((row) => row.id === branch?.id);
		expect(moved?.transfer).toEqual({ from: null, to: "Savings", reason: null });
		expect(moved?.moneyIn?.kind).toBe("transfer");
		// Under a filter the figures are of what the filter leaves.
		expect((await first({ accountId: "savings" })).summary?.inCents).toBe(25);
		expect((await first({ forMember: "alex" })).summary?.inCents).toBe(0);
	});

	it("opens by its ID, and is no part of a selection", async () => {
		const page = await first();
		const row = page.transactions.find((one) => one.moneyIn);
		expect(await loadMoneyInRow(db, householdId, row?.id ?? "")).toEqual(row);
		expect(await loadMoneyInRow(db, "another-household", row?.id ?? "")).toBeNull();
		expect(await loadTransaction(db, viewer, row?.id ?? "")).toBeNull();
		// "Everything the filters match" is Transactions only: six, not twelve.
		const all = await summarizeDeletion(db, viewer, { all: { month } });
		expect(all.count).toBe(6);
	});
});

describe("listOrder", () => {
	it("orders text as SQLite does, byte by byte", () => {
		const place = (sortKey: string, id = "a") => ({
			sortKey,
			id,
			date: "2026-09-01",
			amountCents: 0,
		});
		const order = listOrder("name-az");
		// U+FF5E sorts before U+1F600 in UTF-8, after it in UTF-16.
		expect(order(place("～"), place("\u{1f600}"))).toBeLessThan(0);
		expect(order(place("cafe"), place("café"))).toBeLessThan(0);
		expect(order(place("same", "a"), place("same", "b"))).toBeLessThan(0);
		expect(listOrder("name-za")(place("same", "a"), place("same", "b"))).toBeGreaterThan(0);
	});
});
