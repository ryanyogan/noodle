import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	createHouseholdForParent,
	type Db,
	fileTransactions,
	loadTransactionsPage,
	summarizeDeletion,
	type TransactionSort,
} from "./index";
import { transactions } from "./schema";
import { testDb } from "./test-db";

// More than a month on the Transactions page (issue 99): the list, its total and a selection over
// "the last 3 months", "this year" and "all time", each ending at the month in the address.

const householdId = "household";
const viewer = { householdId, memberId: "alex" };
const stranger = { householdId: "elsewhere", memberId: "sam" };
const month = "2026-10";

let db: Db;

// [id, date, cents, name]: two per day on some days, the same amount and name here and there, so
// only the date and the ID tell some rows apart.
const ROWS = [
	["t01", "2026-10-03", 1000, "Shell"],
	["t02", "2026-10-03", 1000, "Shell"],
	["t03", "2026-10-01", 2500, "Aldi"],
	["t04", "2026-09-30", 2500, "Aldi"],
	["t05", "2026-09-30", 1000, "Shell"],
	["t06", "2026-09-01", 700, "Cafe"],
	["t07", "2026-08-31", 700, "Cafe"],
	["t08", "2026-08-31", 1000, "Shell"],
	["t09", "2026-08-01", 4000, "Zoo"],
	["t10", "2026-07-31", 9000, "July"],
	["t11", "2025-12-31", 300, "Last year"],
] as const;

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-other",
		householdId: stranger.householdId,
		householdName: "Elsewhere",
		timeZone: "America/Chicago",
		parentId: stranger.memberId,
		parentName: "Sam",
	});
	await addBucket(db, {
		...viewer,
		bucketId: "groceries",
		name: "Groceries",
		color: 1,
		month: "2026-08",
		allowanceCents: 50_000,
	});
	for (const [id, date, amountCents, note] of ROWS) {
		await db.insert(transactions).values({
			id,
			householdId,
			source: "quick-add",
			date,
			amountCents,
			note,
			createdByMemberId: "alex",
			bucketId: id === "t09" ? "groceries" : null,
		});
	}
});

const idsOf = async (query: Partial<Parameters<typeof loadTransactionsPage>[2]>, as = viewer) =>
	(await loadTransactionsPage(db, as, { limit: 50, ...query })).transactions.map((t) => t.id);

describe("a list of more than a month", () => {
	it("is one month unless it says where it starts", async () => {
		expect(await idsOf({ month })).toEqual(["t02", "t01", "t03"]);
	});

	it("starts at the first day of `fromMonth` and ends with the month", async () => {
		expect(await idsOf({ month, fromMonth: "2026-08" })).toEqual([
			"t02",
			"t01",
			"t03",
			"t05",
			"t04",
			"t06",
			"t08",
			"t07",
			"t09",
		]);
		expect(await idsOf({ month, fromMonth: "2026-01" })).toHaveLength(10);
		// Ends at the month in the address, not today.
		expect(await idsOf({ month: "2026-09", fromMonth: "2026-08" })).toEqual([
			"t05",
			"t04",
			"t06",
			"t08",
			"t07",
			"t09",
		]);
	});

	it("is every month up to the month with `andEarlier`", async () => {
		expect(await idsOf({ month, andEarlier: true })).toHaveLength(11);
		expect(await idsOf({ month: "2026-07", andEarlier: true })).toEqual(["t10", "t11"]);
	});

	it("totals the range on its first page, and only what the filters leave", async () => {
		const three = await loadTransactionsPage(db, viewer, { month, fromMonth: "2026-08", limit: 2 });
		expect(three.total).toBe(4500 + 3500 + 700 + 1700 + 4000);
		const all = await loadTransactionsPage(db, viewer, { month, andEarlier: true, limit: 2 });
		expect(all.total).toBe(14_400 + 9000 + 300);
		const shell = await loadTransactionsPage(db, viewer, {
			month,
			fromMonth: "2026-08",
			search: "shell",
			limit: 2,
		});
		expect(shell.total).toBe(4000);
		const next = await loadTransactionsPage(db, viewer, {
			month,
			fromMonth: "2026-08",
			after: three.next ?? undefined,
			limit: 2,
		});
		expect(next.total).toBeNull();
	});

	it.each<TransactionSort>([
		"newest",
		"oldest",
		"largest",
		"smallest",
		"name-az",
		"name-za",
		"assigned-az",
	])("pages %s across the months without repeating or skipping a row", async (sort) => {
		const whole = await idsOf({ month, fromMonth: "2026-08", sort });
		expect(whole).toHaveLength(9);
		const paged: string[] = [];
		let after: Parameters<typeof loadTransactionsPage>[2]["after"];
		let pages = 0;
		do {
			const page = await loadTransactionsPage(db, viewer, {
				month,
				fromMonth: "2026-08",
				sort,
				after,
				limit: 3,
			});
			paged.push(...page.transactions.map((t) => t.id));
			after = page.next ?? undefined;
			pages++;
		} while (after && pages < 10);
		expect(pages).toBe(3);
		expect(paged).toEqual(whole);
	});

	it("names what a row is assigned to, whatever month's Plan the screen has", async () => {
		const page = await loadTransactionsPage(db, viewer, { month, fromMonth: "2026-08", limit: 50 });
		const named = Object.fromEntries(page.transactions.map((t) => [t.id, t.assignedName]));
		expect(named.t09).toBe("Groceries");
		expect(named.t01).toBeNull();
	});

	it("shows another Household nothing", async () => {
		expect(await idsOf({ month, andEarlier: true }, stranger)).toEqual([]);
		const page = await loadTransactionsPage(db, stranger, { month, andEarlier: true, limit: 5 });
		expect(page.total).toBe(0);
	});
});

describe("a selection of more than a month", () => {
	it("is the rows the list shows for that range", async () => {
		for (const range of [
			{},
			{ fromMonth: "2026-08" },
			{ fromMonth: "2026-01" },
			{ andEarlier: true },
		] as const) {
			const listed = await idsOf({ month, ...range });
			const summary = await summarizeDeletion(db, viewer, { all: { month, ...range } });
			expect(summary.count).toBe(listed.length);
			expect(summary.firstDate).toBe(listed.length ? ROWS[listed.length - 1]?.[1] : null);
		}
		const but = await summarizeDeletion(db, viewer, {
			all: { month, fromMonth: "2026-08", search: "shell" },
			except: ["t08"],
		});
		expect(but.count).toBe(3);
	});

	it("is nothing for another Household", async () => {
		const summary = await summarizeDeletion(db, stranger, {
			all: { month, fromMonth: "2026-08" },
		});
		expect(summary.count).toBe(0);
	});

	it("is not filed in one go: a Transaction is filed in its own month's Plan", async () => {
		const answer = await fileTransactions(db, viewer, {
			selection: { all: { month, fromMonth: "2026-08" } },
			month,
			assignment: { bucketId: "groceries" },
		});
		expect(answer).toEqual({ ok: false, reason: "more-than-a-month" });
		// By ID, rows of other months are left as they are and counted.
		const byId = await fileTransactions(db, viewer, {
			selection: { ids: ["t01", "t04", "t07"] },
			month,
			assignment: { bucketId: "groceries" },
		});
		expect(byId.ok && byId.filed).toBe(1);
		expect(byId.ok && byId.skipped.otherMonth).toBe(2);
	});
});
