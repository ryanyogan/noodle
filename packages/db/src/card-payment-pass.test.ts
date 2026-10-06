import type { DayKey, MonthKey, StatementLine } from "@noodle/domain";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	createHouseholdForParent,
	type Db,
	importStatement,
	loadTransactionsPage,
	loadTransfer,
	markCardPayment,
	runCardPaymentPass,
	runCardPaymentPasses,
	unmarkTransfer,
} from "./index";
import { householdPasses, transactions, transfers } from "./schema";
import { testDb } from "./test-db";

// The one-time pass of issue 136 over card payments that came in before the card's side of a
// payment was read by its words, and the card a payment names when only one side is in Noodle.

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

async function listed() {
	const page = await loadTransactionsPage(db, viewer, { month, limit: 50 });
	return new Map(page.transactions.map((row) => [row.note, row.transfer]));
}

const count = async (table: typeof transfers | typeof transactions) =>
	(await db.select({ n: sql<number>`count(*)` }).from(table))[0]?.n;

/** As production was before the card's side was read: the lines are here, nothing is marked. */
async function asItWas() {
	await importInto("checking", "i-1", [line("2026-09-02", -50_000, "CHASE CREDIT CRD AUTOPAY")]);
	await importInto("card", "i-2", [
		line("2026-09-20", 50_000, "AUTOPAY PAYMENT - THANK YOU"),
		line("2026-09-25", 12_000, "MOBILE PAYMENT - THANK YOU"),
		line("2026-09-26", 2_000, "TARGET REFUND"),
	]);
	await db.delete(transfers);
}

describe("the one-time pass over card payments that read Money back", () => {
	it("marks them as Transfers, deletes nothing, and the second run does nothing", async () => {
		await asItWas();
		const lines = await count(transactions);
		expect((await listed()).get("AUTOPAY PAYMENT - THANK YOU")).toBeNull();

		expect(await runCardPaymentPass(db, householdId, { runId: "run-1", newId })).toEqual({
			ran: true,
			marked: 2,
			months: ["2026-09"],
		});
		const rows = await listed();
		expect(rows.get("AUTOPAY PAYMENT - THANK YOU")).toEqual({
			from: "Checking",
			to: "Visa",
			reason: null,
		});
		expect(rows.get("MOBILE PAYMENT - THANK YOU")).toEqual({
			from: null,
			to: "Visa",
			reason: null,
		});
		expect(rows.get("TARGET REFUND")).toBeNull();
		expect(await count(transactions)).toBe(lines);
		expect(await db.select().from(householdPasses)).toMatchObject([
			{ householdId, pass: "card-payments-2026-10", runId: "run-1", changed: 2, snapshotId: null },
		]);

		// A Parent unmarks one; the pass has run, so it is never looked at again.
		const marks = await db.select().from(transfers);
		await unmarkTransfer(db, viewer, marks[0]?.id ?? "");
		const after = await db.select().from(transfers);
		expect(await runCardPaymentPass(db, householdId, { runId: "run-2", newId })).toEqual({
			ran: false,
			marked: 0,
			months: [],
		});
		expect(await db.select().from(transfers)).toEqual(after);
		expect(await db.select().from(householdPasses)).toHaveLength(1);
	});

	it("runs for every Household that hasn't had it, once", async () => {
		await asItWas();
		expect(await runCardPaymentPasses(db, newId)).toEqual({ households: 1, marked: 2, failed: 0 });
		expect(await runCardPaymentPasses(db, newId)).toEqual({ households: 0, marked: 0, failed: 0 });
	});

	it("leaves a marker for a Household with nothing to mark", async () => {
		expect(await runCardPaymentPasses(db, newId)).toEqual({ households: 1, marked: 0, failed: 0 });
		expect(await runCardPaymentPasses(db, newId)).toEqual({ households: 0, marked: 0, failed: 0 });
	});
});

describe("a card payment with only the paying side in Noodle names its card", () => {
	it("reads Checking → Visa in the list and in its detail", async () => {
		await importInto("checking", "i-1", [line("2026-09-02", -50_000, "ONLINE PMT VISA 4411")]);
		const [out] = await db.select().from(transactions);
		const result = await markCardPayment(db, viewer, {
			transferId: "t-1",
			transactionId: out?.id ?? "",
			cardAccountId: "card",
			ruleId: "r-1",
		});
		expect(result.ok).toBe(true);
		expect((await listed()).get("ONLINE PMT VISA 4411")).toEqual({
			from: "Checking",
			to: "Visa",
			reason: null,
		});
		expect(await loadTransfer(db, viewer, out?.id ?? "")).toMatchObject({
			kind: "transfer",
			from: "Checking",
			to: "Visa",
			peer: null,
		});
	});

	it("names no card for one that isn't in Noodle", async () => {
		await importInto("checking", "i-1", [line("2026-09-02", -50_000, "ONLINE PMT STORE CARD")]);
		const [out] = await db.select().from(transactions);
		await markCardPayment(db, viewer, {
			transferId: "t-1",
			transactionId: out?.id ?? "",
			cardAccountId: null,
			ruleId: "r-1",
		});
		expect((await listed()).get("ONLINE PMT STORE CARD")).toEqual({
			from: "Checking",
			to: null,
			reason: null,
		});
	});
});
