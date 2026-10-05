import type { DayKey, MonthKey, StatementLine } from "@noodle/domain";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { extraIncomeLeftSql } from "./extra-income";
import {
	addAccount,
	addBucket,
	addPersonalAllowance,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	deleteTransaction,
	importStatement,
	linkRefund,
	loadIncome,
	loadRefund,
	loadSpending,
	loadTransactionsPage,
	loadTransfer,
	loadUncategorized,
	markTransfer,
	setTakeHomePay,
	unlinkRefund,
	unmarkTransfer,
} from "./index";
import { bucketLeftSql } from "./moves";
import { members, transactions } from "./schema";
import { testDb } from "./test-db";

// The ingest seam for Transfers and Refunds: statements go in through importStatement, as an
// upload does, and what counts is read back through the same reads the app makes.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const sam = { householdId, memberId: "sam" };
const month: MonthKey = "2026-09";

let db: Db;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;

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
	await db.insert(members).values({
		id: "sam",
		householdId,
		kind: "parent",
		name: "Sam",
		clerkUserId: "clerk-sam",
	});
	await setTakeHomePay(db, { householdId, memberId: parentId, month, amountCents: 600_000 });
	await addBucket(db, {
		householdId,
		memberId: parentId,
		bucketId: "gear",
		name: "Gear",
		color: 1,
		month,
		allowanceCents: 40_000,
	});
	for (const [accountId, name, kind] of [
		["checking", "Checking", "checking"],
		["savings", "Savings", "savings"],
		["card", "Visa", "credit-card"],
	] as const) {
		await addAccount(db, {
			householdId,
			accountId,
			name,
			kind,
			balanceCents: 0,
			balanceId: `${accountId}-balance`,
			createdByMemberId: parentId,
		});
	}
});

/** A statement line: money out of the Account is negative, money in positive. */
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
		createdByMemberId: parentId,
		newId,
	});

/** The Transactions listed this month, by note. */
async function listed() {
	const page = await loadTransactionsPage(db, viewer, { month, limit: 50 });
	return new Map(page.transactions.map((row) => [row.note, row]));
}

/** What the month's Gear spending adds up to; the Cover guard's SQL agrees. */
async function gearSpent() {
	const spending = await loadSpending(db, viewer, month);
	const [left] = await db.values<[number]>(
		sql`select ${bucketLeftSql(householdId, "gear", month)}`,
	);
	const spent = spending.reduce((sum, spend) => sum + spend.amount, 0);
	expect(left?.[0]).toBe(40_000 - spent);
	return spent;
}

/** Assigns a Transaction to Gear directly, as a Parent editing it would. */
const assignToGear = (id: string) =>
	db.update(transactions).set({ bucketId: "gear" }).where(eq(transactions.id, id));

const idOf = async (note: string) => (await listed()).get(note)?.id as string;

describe("Transfers on Import", () => {
	it("pairs paying the card from checking, and neither side counts", async () => {
		await importInto("checking", "i-1", [line("2026-09-09", -50_000, "AUTOPAY VISA")]);
		const result = await importInto("card", "i-2", [
			line("2026-09-11", 50_000, "PAYMENT THANK YOU"),
			line("2026-09-11", -3_000, "REI"),
		]);
		expect(result.ok && result.transfers).toBe(1);
		expect(result.ok && result.import.transferCount).toBe(1);

		const rows = await listed();
		expect(rows.get("AUTOPAY VISA")?.transfer).toEqual({
			from: "Checking",
			to: "Visa",
			reason: null,
		});
		expect(rows.get("PAYMENT THANK YOU")?.transfer).toEqual({
			from: "Checking",
			to: "Visa",
			reason: null,
		});
		expect(rows.get("REI")?.transfer).toBeNull();
		// Even assigned to a Bucket, a Transfer's side isn't spending.
		await assignToGear(await idOf("AUTOPAY VISA"));
		await assignToGear(await idOf("REI"));
		expect(await gearSpent()).toBe(3_000);
	});

	it("never offers a Transfer's side to categorization", async () => {
		await importInto("card", "i-1", [line("2026-09-11", 50_000, "PAYMENT THANK YOU")]);
		await importInto("checking", "i-2", [
			line("2026-09-09", -50_000, "AUTOPAY VISA"),
			line("2026-09-10", -4_200, "COSTCO WHSE #123"),
		]);
		const waiting = await loadUncategorized(db, householdId, "i-2");
		expect(waiting.map((row) => row.note)).toEqual(["COSTCO WHSE #123"]);
	});

	it("pairs savings into checking, and the deposit isn't income", async () => {
		await importInto("savings", "i-1", [line("2026-09-03", -700_000, "TRANSFER TO CHECKING")]);
		await importInto("checking", "i-2", [
			line("2026-09-04", 700_000, "TRANSFER FROM SAVINGS"),
			line("2026-09-15", 610_000, "ACME PAYROLL"),
		]);
		const income = await loadIncome(db, householdId, month, "2026-10");
		expect(income.map((row) => row.note)).toEqual(["ACME PAYROLL"]);
		// The Extra income is payroll beyond take-home pay, not the money from savings.
		const [left] = await db.values<[number]>(sql`select ${extraIncomeLeftSql(householdId, month)}`);
		expect(left?.[0]).toBe(10_000);
		const out = await loadTransfer(db, viewer, await idOf("TRANSFER TO CHECKING"));
		expect(out).toMatchObject({
			kind: "transfer",
			automatic: true,
			from: "Savings",
			to: "Checking",
			peer: { note: "TRANSFER FROM SAVINGS", amountCents: 700_000, account: "Checking" },
		});
	});

	it("leaves near misses and ambiguous pairs alone", async () => {
		await importInto("checking", "i-1", [
			line("2026-09-09", -50_000, "AUTOPAY VISA"),
			line("2026-09-09", -20_000, "ZELLE"),
		]);
		await importInto("card", "i-2", [
			// A cent off; and a week later.
			line("2026-09-10", 49_999, "PAYMENT A"),
			line("2026-09-16", 20_000, "PAYMENT B"),
		]);
		await importInto("savings", "i-3", [
			// Two equally good arrivals for one payment: a Parent decides.
			line("2026-09-10", 30_000, "FROM CHECKING 1"),
		]);
		await importInto("card", "i-4", [line("2026-09-10", 30_000, "PAYMENT C")]);
		await importInto("checking", "i-5", [line("2026-09-10", -30_000, "TO SAVINGS")]);
		const rows = await listed();
		for (const row of rows.values()) expect(row.transfer).toBeNull();
		expect(await loadIncome(db, householdId, month, "2026-10")).toHaveLength(1);
	});

	it("never marks again what a Parent unmarked, even when it comes in again", async () => {
		await importInto("checking", "i-1", [line("2026-09-09", -50_000, "AUTOPAY VISA")]);
		await importInto("card", "i-2", [line("2026-09-10", 50_000, "PAYMENT THANK YOU")]);
		const view = await loadTransfer(db, viewer, await idOf("AUTOPAY VISA"));
		if (view.kind !== "transfer") throw new Error("not a Transfer");
		expect(await unmarkTransfer(db, viewer, view.transferId)).toEqual({
			ok: true,
			months: [month],
		});
		await importInto("card", "i-3", [line("2026-09-10", 50_000, "PAYMENT THANK YOU")]);
		expect((await listed()).get("AUTOPAY VISA")?.transfer).toBeNull();
		// Unmarked, it's money out again: it counts once assigned.
		await assignToGear(await idOf("AUTOPAY VISA"));
		expect(await gearSpent()).toBe(50_000);
	});

	it("lets a Parent mark one side, pairing it when its other side is clear", async () => {
		await importInto("checking", "i-1", [
			line("2026-09-09", -50_000, "AUTOPAY VISA"),
			line("2026-09-12", -8_000, "VENMO"),
		]);
		await importInto("card", "i-2", [line("2026-09-10", 50_000, "PAYMENT THANK YOU")]);
		const payment = await idOf("AUTOPAY VISA");
		// Marked, paired; the pair already made isn't made twice.
		expect(await loadTransfer(db, viewer, payment)).toMatchObject({ kind: "transfer" });

		const venmo = await idOf("VENMO");
		expect(await loadTransfer(db, viewer, venmo)).toEqual({ kind: "none", markable: true });
		const marked = await markTransfer(db, viewer, { transferId: "t-1", transactionId: venmo });
		expect(marked).toEqual({ ok: true, months: [month] });
		expect(await markTransfer(db, viewer, { transferId: "t-1", transactionId: venmo })).toEqual(
			marked,
		);
		expect((await listed()).get("VENMO")?.transfer).toEqual({
			from: "Checking",
			to: null,
			reason: null,
		});
		// A Quick Add is spending, never a Transfer.
		await addQuickAdd(db, {
			householdId,
			transactionId: "qa",
			bucketId: "gear",
			date: "2026-09-12",
			amountCents: 1_000,
			note: "Socks",
			forMemberIds: [],
			createdByMemberId: parentId,
		});
		expect(await loadTransfer(db, viewer, "qa")).toEqual({ kind: "none", markable: false });
		expect(await markTransfer(db, viewer, { transferId: "t-2", transactionId: "qa" })).toEqual({
			ok: false,
			reason: "refused",
		});
	});
});

describe("Refunds", () => {
	const jacket = (id = "jacket", by = parentId, bucketId = "gear") =>
		addQuickAdd(db, {
			householdId,
			transactionId: id,
			bucketId,
			date: "2026-09-01",
			amountCents: 8_999,
			note: "REI jacket",
			forMemberIds: [parentId],
			createdByMemberId: by,
		});

	it("links money back to its purchase, restoring the Bucket, and unlinks it", async () => {
		await jacket();
		await importInto("card", "i-1", [line("2026-09-12", 2_499, "REI #11 RETURN")]);
		const back = await idOf("REI #11 RETURN");
		expect(await gearSpent()).toBe(8_999);

		const view = await loadRefund(db, viewer, back);
		expect(view).toMatchObject({ kind: "unlinked", likely: [{ id: "jacket" }] });
		const linked = await linkRefund(db, viewer, {
			refundId: "r-1",
			refundTransactionId: back,
			originalTransactionId: "jacket",
		});
		expect(linked).toEqual({ ok: true, months: [month] });
		expect(await gearSpent()).toBe(8_999 - 2_499);
		const row = (await listed()).get("REI #11 RETURN");
		expect(row).toMatchObject({ bucketId: "gear", for: [parentId], refundOf: "REI jacket" });
		expect(await loadRefund(db, viewer, back)).toMatchObject({
			kind: "refund",
			original: { id: "jacket" },
		});

		expect(await unlinkRefund(db, viewer, "r-1")).toEqual({ ok: true, months: [month] });
		expect(await gearSpent()).toBe(8_999);
		expect((await listed()).get("REI #11 RETURN")).toMatchObject({
			bucketId: null,
			for: [],
			refundOf: null,
		});
	});

	it("refuses a purchase that's smaller, later, or in the other Parent's Personal Allowance", async () => {
		await addPersonalAllowance(db, {
			householdId,
			memberId: "sam",
			bucketId: "sam-pa",
			name: "Sam’s Personal Allowance",
			color: 2,
			month,
			allowanceCents: 20_000,
		});
		await jacket("sams", "sam", "sam-pa");
		await addQuickAdd(db, {
			householdId,
			transactionId: "later",
			bucketId: "gear",
			date: "2026-09-20",
			amountCents: 9_000,
			note: "REI boots",
			forMemberIds: [],
			createdByMemberId: parentId,
		});
		await importInto("card", "i-1", [line("2026-09-12", 2_499, "REI #11 RETURN")]);
		const back = await idOf("REI #11 RETURN");
		expect(await loadRefund(db, viewer, back)).toEqual({ kind: "unlinked", likely: [] });
		for (const original of ["sams", "later"]) {
			expect(
				await linkRefund(db, viewer, {
					refundId: `r-${original}`,
					refundTransactionId: back,
					originalTransactionId: original,
				}),
			).toEqual({ ok: false, reason: "refused" });
		}
		// Sam may link it to their own.
		expect(await loadRefund(db, sam, back)).toMatchObject({ likely: [{ id: "sams" }] });
	});

	it("unassigns the Refund when its purchase is deleted", async () => {
		await jacket();
		await importInto("card", "i-1", [line("2026-09-12", 2_499, "REI #11 RETURN")]);
		const back = await idOf("REI #11 RETURN");
		await linkRefund(db, viewer, {
			refundId: "r-1",
			refundTransactionId: back,
			originalTransactionId: "jacket",
		});
		await deleteTransaction(db, { householdId, memberId: parentId, transactionId: "jacket" });
		expect(await gearSpent()).toBe(0);
		expect((await listed()).get("REI #11 RETURN")).toMatchObject({
			bucketId: null,
			refundOf: null,
		});
	});

	it("isn't offered for a Transfer's side", async () => {
		await jacket();
		await importInto("checking", "i-1", [line("2026-09-09", -2_499, "AUTOPAY VISA")]);
		await importInto("card", "i-2", [line("2026-09-10", 2_499, "PAYMENT")]);
		expect(await loadRefund(db, viewer, await idOf("PAYMENT"))).toEqual({ kind: "none" });
	});
});

describe("The Transactions list's order and total", () => {
	/** Every page of the month's list in `sort` order, `limit` at a time. */
	async function all(sort: "newest" | "oldest" | "largest" | "smallest") {
		const rows = [];
		let after: Parameters<typeof loadTransactionsPage>[2]["after"];
		do {
			const page = await loadTransactionsPage(db, viewer, { month, sort, after, limit: 2 });
			rows.push(...page.transactions);
			after = page.next ?? undefined;
		} while (after);
		return rows;
	}

	beforeEach(async () => {
		await importInto("checking", "i-1", [
			line("2026-09-10", -4_200, "COSTCO"),
			line("2026-09-12", -3_000, "REI"),
			line("2026-09-12", -9_900, "TARGET"),
			line("2026-09-14", -3_000, "H-E-B"),
		]);
	});

	it("sorts by amount and by date across pages, ties broken the same way every time", async () => {
		const largest = await all("largest");
		expect(largest.map((row) => row.amountCents)).toEqual([9_900, 4_200, 3_000, 3_000]);
		expect(new Set(largest.map((row) => row.note)).size).toBe(4);
		const smallest = await all("smallest");
		expect(smallest.map((row) => row.amountCents)).toEqual([3_000, 3_000, 4_200, 9_900]);
		expect(smallest.map((row) => row.id)).toEqual(largest.map((row) => row.id).reverse());
		const oldest = await all("oldest");
		expect(oldest.map((row) => row.date)).toEqual([
			"2026-09-10",
			"2026-09-12",
			"2026-09-12",
			"2026-09-14",
		]);
		expect((await all("newest")).map((row) => row.id)).toEqual(
			oldest.map((row) => row.id).reverse(),
		);
	});

	it("totals the whole filtered month on the first page, leaving Transfers out", async () => {
		await importInto("checking", "i-2", [line("2026-09-09", -50_000, "AUTOPAY VISA")]);
		await importInto("card", "i-3", [line("2026-09-11", 50_000, "PAYMENT THANK YOU")]);
		const first = await loadTransactionsPage(db, viewer, { month, limit: 2 });
		expect(first.total).toBe(20_100);
		const next = await loadTransactionsPage(db, viewer, {
			month,
			limit: 2,
			after: first.next ?? undefined,
		});
		expect(next.total).toBeNull();
		const searched = await loadTransactionsPage(db, viewer, { month, search: "re", limit: 2 });
		expect(searched.total).toBe(3_000);
	});
});
