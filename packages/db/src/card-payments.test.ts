import type { DayKey, MonthKey, StatementLine } from "@noodle/domain";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	createHouseholdForParent,
	type Db,
	importStatement,
	loadTransactionsPage,
	markCardPayments,
	unmarkTransfer,
} from "./index";
import { transactions, transfers } from "./schema";
import { testDb } from "./test-db";

// The card's side of a payment (issue 136): statements go in through importStatement, as an
// upload does, and what a line is read back as is what the Transactions list says.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
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
	for (const [accountId, name, kind] of [
		["checking", "Checking", "checking"],
		["card", "Visa", "credit-card"],
		["loan", "Car loan", "loan"],
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

/** The month's Transactions' Transfers, by note. */
async function listed() {
	const page = await loadTransactionsPage(db, viewer, { month, limit: 50 });
	return new Map(page.transactions.map((row) => [row.note, row.transfer]));
}

const count = async (table: typeof transfers | typeof transactions) =>
	(await db.select({ n: sql<number>`count(*)` }).from(table))[0]?.n;

const oneSided = { from: null, to: "Visa", reason: null };
const paired = { from: "Checking", to: "Visa", reason: null };

describe("A payment arriving on a card", () => {
	it("is a Transfer on its own when the paying Account isn't in Noodle; a refund stays money back", async () => {
		const result = await importInto("card", "i-1", [
			line("2026-09-11", 50_000, "PAYMENT THANK YOU"),
			line("2026-09-12", 2_000, "AMAZON.COM AMZN.COM/BILL WA"),
			line("2026-09-13", 1_500, "CASH BACK REWARD"),
			line("2026-09-14", -3_000, "REI"),
		]);
		expect(result.ok && result.transfers).toBe(1);
		const rows = await listed();
		expect(rows.get("PAYMENT THANK YOU")).toEqual(oneSided);
		expect(rows.get("AMAZON.COM AMZN.COM/BILL WA")).toBeNull();
		expect(rows.get("CASH BACK REWARD")).toBeNull();
		expect(rows.get("REI")).toBeNull();
	});

	it("pairs with the paying Account's line of the same amount, whatever the days", async () => {
		await importInto("checking", "i-1", [line("2026-09-02", -50_000, "CHASE CREDIT CRD AUTOPAY")]);
		await importInto("card", "i-2", [line("2026-09-20", 50_000, "AUTOPAY PAYMENT - THANK YOU")]);
		const rows = await listed();
		expect(rows.get("CHASE CREDIT CRD AUTOPAY")).toEqual(paired);
		expect(rows.get("AUTOPAY PAYMENT - THANK YOU")).toEqual(paired);
	});

	it("finds its paying line when that comes in later", async () => {
		await importInto("card", "i-1", [line("2026-09-20", 50_000, "ONLINE PAYMENT - THANK YOU")]);
		expect((await listed()).get("ONLINE PAYMENT - THANK YOU")).toEqual(oneSided);
		await importInto("checking", "i-2", [line("2026-09-02", -50_000, "VISA ONLINE PAYMENT")]);
		const rows = await listed();
		expect(rows.get("VISA ONLINE PAYMENT")).toEqual(paired);
		expect(rows.get("ONLINE PAYMENT - THANK YOU")).toEqual(paired);
		expect(await count(transfers)).toBe(1);
	});

	it("takes the nearest paying line, and never a purchase that only costs the same", async () => {
		await importInto("checking", "i-1", [
			line("2026-09-01", -50_000, "VISA AUTOPAY PAYMENT 1"),
			line("2026-09-12", -50_000, "VISA AUTOPAY PAYMENT 2"),
			line("2026-09-05", -42_000, "COSTCO WHSE #1042"),
		]);
		await importInto("card", "i-2", [
			line("2026-09-19", 50_000, "PAYMENT THANK YOU"),
			line("2026-09-25", 42_000, "PAYMENT RECEIVED"),
		]);
		const rows = await listed();
		expect(rows.get("VISA AUTOPAY PAYMENT 2")).toEqual(paired);
		expect(rows.get("VISA AUTOPAY PAYMENT 1")).toBeNull();
		expect(rows.get("PAYMENT THANK YOU")).toEqual(paired);
		expect(rows.get("COSTCO WHSE #1042")).toBeNull();
		expect(rows.get("PAYMENT RECEIVED")).toEqual(oneSided);
	});

	it("leaves money arriving on a loan as it was", async () => {
		await importInto("loan", "i-1", [line("2026-09-11", 50_000, "PAYMENT RECEIVED")]);
		expect((await listed()).get("PAYMENT RECEIVED")).toBeNull();
	});
});

describe("The pass over card lines already in Noodle", () => {
	/** Lines as they were before this was built: imported, and marked as nothing. */
	async function asItWas() {
		await importInto("checking", "i-1", [
			line("2026-09-02", -50_000, "CHASE CREDIT CRD AUTOPAY"),
			line("2026-09-03", -9_900, "VISA ONLINE PAYMENT"),
		]);
		await importInto("card", "i-2", [
			line("2026-09-20", 50_000, "PAYMENT THANK YOU"),
			line("2026-09-21", 7_500, "MOBILE PAYMENT - THANK YOU"),
			line("2026-09-22", 2_000, "TARGET REFUND"),
		]);
		await db.delete(transfers);
	}

	it("marks the payments, deletes nothing, and does nothing the second time", async () => {
		await asItWas();
		const lines = await count(transactions);
		const first = await markCardPayments(db, householdId, newId);
		expect(first).toEqual({ marked: 2, months: ["2026-09"] });
		const rows = await listed();
		expect(rows.get("PAYMENT THANK YOU")).toEqual(paired);
		expect(rows.get("CHASE CREDIT CRD AUTOPAY")).toEqual(paired);
		expect(rows.get("MOBILE PAYMENT - THANK YOU")).toEqual(oneSided);
		expect(rows.get("TARGET REFUND")).toBeNull();
		expect(rows.get("VISA ONLINE PAYMENT")).toBeNull();

		const marks = await db.select().from(transfers);
		expect(await markCardPayments(db, householdId, newId)).toEqual({ marked: 0, months: [] });
		expect(await db.select().from(transfers)).toEqual(marks);
		expect(await count(transactions)).toBe(lines);
	});

	it("is undone by unmarking, and a line a Parent unmarked is never marked again", async () => {
		await asItWas();
		await markCardPayments(db, householdId, newId);
		const marks = await db.select().from(transfers);
		for (const mark of marks) {
			expect(await unmarkTransfer(db, viewer, mark.id)).toMatchObject({ ok: true });
		}
		expect(await markCardPayments(db, householdId, newId)).toEqual({ marked: 0, months: [] });
		const rows = await listed();
		expect(rows.get("PAYMENT THANK YOU")).toBeNull();
		expect(rows.get("MOBILE PAYMENT - THANK YOU")).toBeNull();
		expect(rows.get("CHASE CREDIT CRD AUTOPAY")).toBeNull();
	});

	it("never pairs with a paying line a Parent unmarked", async () => {
		await importInto("checking", "i-1", [line("2026-09-10", -50_000, "CHASE CREDIT CRD AUTOPAY")]);
		await importInto("card", "i-2", [line("2026-09-11", 50_000, "REI RETURN")]);
		const [pair] = await db.select().from(transfers);
		expect(pair).toBeDefined();
		await unmarkTransfer(db, viewer, pair?.id ?? "");
		await importInto("card", "i-3", [line("2026-09-25", 50_000, "PAYMENT THANK YOU")]);
		const rows = await listed();
		expect(rows.get("CHASE CREDIT CRD AUTOPAY")).toBeNull();
		expect(rows.get("PAYMENT THANK YOU")).toEqual(oneSided);
	});
});
