import type { BankLine, DayKey, MonthKey } from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBankConnection,
	addBucket,
	addCommitment,
	addCommitmentPayment,
	addQuickAdd,
	changeTransactionDate,
	chooseBankAccounts,
	closeMonth,
	createHouseholdForParent,
	type Db,
	linkCommitment,
	loadExportData,
	loadSpending,
	loadTransactionsPage,
	owedNow,
	setTakeHomePay,
	splitTransaction,
	syncBankLines,
	updateAccountBalance,
	updateTransaction,
} from "./index";
import { matches, refunds, transactions } from "./schema";
import { testDb } from "./test-db";

// A Parent changes the day a Transaction counts on (issue 148, ADR-0060). The bank's own day is
// kept beside it, and everything that recognises the bank's line goes by that one.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const today = "2026-10-07" as DayKey;
const august: MonthKey = "2026-08";
const september: MonthKey = "2026-09";
const october: MonthKey = "2026-10";

let db: Db;
let ids = 0;
const newId = () => `id-${++ids}`;

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
	await setTakeHomePay(db, {
		householdId,
		memberId: parentId,
		month: september,
		amountCents: 600_000,
	});
	await addBucket(db, {
		householdId,
		memberId: parentId,
		bucketId: "eating",
		name: "Eating out",
		color: 1,
		month: september,
		allowanceCents: 40_000,
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
		description: "Nopa",
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
		newId,
		today,
	});

const stored = () =>
	db
		.select({
			id: transactions.id,
			externalId: transactions.externalId,
			date: transactions.date,
			bankDate: transactions.bankDate,
			amountCents: transactions.amountCents,
			pending: transactions.pending,
		})
		.from(transactions);

/** The one bank line of a test, brought in dated `date` and filed in Eating out. */
async function bankLine(date: string, cents = 42_50) {
	await sync("imp-1", [line("t1", date, -cents)]);
	const [row] = await stored();
	const id = row?.id ?? "";
	await updateTransaction(db, {
		householdId,
		memberId: parentId,
		transactionId: id,
		amountCents: cents,
		assignment: { bucketId: "eating" },
		note: "Nopa",
		forMemberIds: [],
		today,
	});
	return id;
}

const move = (
	transactionId: string,
	date: string,
	expectedVersion?: number,
	refile?: { bucketId: string } | { commitmentId: string },
) =>
	changeTransactionDate(db, {
		householdId,
		memberId: parentId,
		transactionId,
		date: date as DayKey,
		today,
		expectedVersion,
		refile,
	});

const spentIn = async (month: MonthKey) =>
	(await loadSpending(db, viewer, month)).reduce((sum, spend) => sum + spend.amount, 0);

const listed = async (month: MonthKey) =>
	(await loadTransactionsPage(db, viewer, { month, limit: 50 })).transactions;

describe("changeTransactionDate", () => {
	it("moves a bank line to another day of its month and keeps the bank's own day", async () => {
		const id = await bankLine("2026-10-02");
		const result = await move(id, "2026-10-05");
		expect(result).toMatchObject({
			ok: true,
			from: "2026-10-02",
			bankDate: "2026-10-02",
			months: [october],
		});
		expect(await listed(october)).toMatchObject([
			{ id, date: "2026-10-05", bankDate: "2026-10-02" },
		]);
		expect(await spentIn(october)).toBe(42_50);
	});

	it("moves one into last month while it has not been closed: it counts there, not here", async () => {
		const id = await bankLine("2026-10-02");
		expect(await move(id, "2026-09-30")).toMatchObject({
			ok: true,
			months: [september, october],
			// September's Plan has Eating out: it stays filed in it.
			unassigned: null,
		});
		expect(await listed(october)).toEqual([]);
		expect(await listed(september)).toMatchObject([
			{ id, date: "2026-09-30", bankDate: "2026-10-02", bucketId: "eating" },
		]);
		expect(await spentIn(september)).toBe(42_50);
		expect(await spentIn(october)).toBe(0);
	});

	it("is refused into, and out of, a month that has been closed", async () => {
		const id = await bankLine("2026-10-02");
		const inSeptember = await bankLine2("2026-09-12");
		await closeMonth(db, {
			householdId,
			closeId: "close-sep",
			month: september,
			decidedByMemberId: parentId,
			sweeps: [],
			windfall: [],
		});
		expect(await move(id, "2026-09-30")).toEqual({
			ok: false,
			reason: "month-closed",
			month: september,
		});
		expect(await move(inSeptember, "2026-10-01")).toEqual({
			ok: false,
			reason: "month-closed",
			month: september,
		});
		// Within the closed month too: its days are part of how it ended.
		expect(await move(inSeptember, "2026-09-13")).toMatchObject({ reason: "month-closed" });
		expect((await stored()).map((row) => row.date).sort()).toEqual(["2026-09-12", "2026-10-02"]);
		// The running month is still free.
		expect(await move(id, "2026-10-03")).toMatchObject({ ok: true });
	});

	it("is refused for a day that hasn't come", async () => {
		const id = await bankLine("2026-10-02");
		expect(await move(id, "2026-10-08")).toEqual({ ok: false, reason: "future" });
		expect(await move(id, "2026-10-07")).toMatchObject({ ok: true });
	});

	it("moves into a month whose Plan didn't have its Bucket, and is left unassigned: it counts in no Bucket", async () => {
		const id = await bankLine("2026-10-02");
		await updateTransaction(db, {
			householdId,
			memberId: parentId,
			transactionId: id,
			amountCents: 42_50,
			assignment: { bucketId: "eating" },
			note: "Nopa",
			forMemberIds: [parentId],
			today,
		});
		const [before] = await listed(october);
		const moved = await move(id, "2026-08-30", before?.version);
		expect(moved).toEqual({
			ok: true,
			version: (before?.version ?? 0) + 1,
			from: "2026-10-02",
			bankDate: "2026-10-02",
			months: [august, october],
			unassigned: { kind: "bucket", id: "eating", name: "Eating out" },
		});
		expect(await listed(october)).toEqual([]);
		// Filed nowhere, on its new day, and still For who it was For.
		expect(await listed(august)).toMatchObject([
			{ id, date: "2026-08-30", bucketId: null, commitmentId: null, for: [parentId] },
		]);
		expect(await spentIn(august)).toBe(0);
		expect(await spentIn(october)).toBe(0);
	});

	it("goes back with Undo to its day and its Bucket in one write", async () => {
		const id = await bankLine("2026-10-02");
		const moved = await move(id, "2026-08-30");
		if (!moved.ok || !moved.unassigned) throw new Error("not moved and unassigned");
		// What it is filed in again must be in the Plan of the month it lands in: not August's.
		expect(await move(id, "2026-08-29", moved.version, { bucketId: "eating" })).toMatchObject({
			ok: true,
			version: moved.version + 1,
		});
		expect(await listed(august)).toMatchObject([{ id, bucketId: null }]);
		expect(
			await move(id, moved.from, moved.version + 1, { bucketId: moved.unassigned.id }),
		).toMatchObject({ ok: true, version: moved.version + 2, bankDate: null, unassigned: null });
		expect(await listed(august)).toEqual([]);
		expect(await listed(october)).toMatchObject([
			{ id, date: "2026-10-02", bankDate: null, bucketId: "eating" },
		]);
		expect(await spentIn(october)).toBe(42_50);
		// Filed somewhere, nothing is filed over it.
		await addBucket(db, {
			householdId,
			memberId: parentId,
			bucketId: "fun",
			name: "Fun",
			color: 2,
			month: september,
			allowanceCents: 10_000,
		});
		await move(id, "2026-10-03", undefined, { bucketId: "fun" });
		expect(await listed(october)).toMatchObject([{ id, bucketId: "eating" }]);
	});

	it("leaves a Commitment that month's Plan didn't have, and its pay-down with it; Undo puts both back", async () => {
		await addAccount(db, {
			householdId,
			accountId: "visa",
			name: "Visa",
			kind: "credit-card",
			balanceCents: null,
			balanceId: "visa-none",
			createdByMemberId: parentId,
		});
		await updateAccountBalance(db, {
			householdId,
			balanceId: "visa-aug",
			accountId: "visa",
			amountCents: 100_000,
			createdByMemberId: parentId,
			asOf: "2026-08-01" as DayKey,
		});
		await addCommitment(db, {
			householdId,
			memberId: parentId,
			commitmentId: "visa-bill",
			name: "Visa bill",
			month: september,
			amountCents: 20_000,
			cadence: "monthly",
			dueDate: "2026-09-05",
		});
		await linkCommitment(db, {
			householdId,
			memberId: parentId,
			commitmentId: "visa-bill",
			accountId: "visa",
			carriedBalance: false,
			month: september,
			today,
		});
		expect(
			await addCommitmentPayment(db, {
				householdId,
				transactionId: "paid",
				commitmentId: "visa-bill",
				date: "2026-09-10" as DayKey,
				amountCents: 20_000,
				createdByMemberId: parentId,
			}),
		).toEqual({ ok: true });
		const owed = () => owedNow(db, { householdId, accountId: "visa" });
		expect(await owed()).toBe(80_000);

		const moved = await move("paid", "2026-08-30");
		expect(moved).toMatchObject({
			ok: true,
			unassigned: { kind: "commitment", id: "visa-bill", name: "Visa bill" },
		});
		expect(await listed(august)).toMatchObject([
			{ id: "paid", bucketId: null, commitmentId: null },
		]);
		// After the balance's day still, but it pays the card down no longer.
		expect(await owed()).toBe(100_000);

		if (!moved.ok) throw new Error("not moved");
		expect(
			await move("paid", moved.from, moved.version, { commitmentId: "visa-bill" }),
		).toMatchObject({ ok: true, unassigned: null });
		expect(await listed(september)).toMatchObject([
			{ id: "paid", date: "2026-09-10", commitmentId: "visa-bill" },
		]);
		expect(await owed()).toBe(80_000);
	});

	it("is refused for a split one while a Split's Bucket was not in the Plan that month", async () => {
		const id = await bankLine("2026-10-02");
		await splitTransaction(db, {
			householdId,
			memberId: parentId,
			transactionId: id,
			amountCents: 42_50,
			note: "Nopa",
			splits: [
				{ id: "s1", amountCents: 40_00, assignment: { bucketId: "eating" }, forMemberIds: [] },
				{ id: "s2", amountCents: 2_50, assignment: { bucketId: "eating" }, forMemberIds: [] },
			],
			today,
		});
		// A Split is never unassigned, so the whole Transaction stays where it is.
		expect(await move(id, "2026-08-30")).toEqual({
			ok: false,
			reason: "not-in-plan",
			part: "split",
			name: "Eating out",
		});
		expect(await listed(october)).toMatchObject([{ id, date: "2026-10-02" }]);
		expect(await spentIn(october)).toBe(42_50);
		// Every Split's Bucket in that month's Plan: it moves, split as it was.
		expect(await move(id, "2026-09-30")).toMatchObject({ ok: true, unassigned: null });
		expect(await spentIn(september)).toBe(42_50);
	});

	it("is still refused into a closed month, whatever its Plan had", async () => {
		const id = await bankLine("2026-10-02");
		await closeMonth(db, {
			householdId,
			closeId: "close-aug",
			month: august,
			decidedByMemberId: parentId,
			sweeps: [],
			windfall: [],
		});
		expect(await move(id, "2026-08-30")).toEqual({
			ok: false,
			reason: "month-closed",
			month: august,
		});
		expect(await listed(october)).toMatchObject([{ id, date: "2026-10-02", bucketId: "eating" }]);
	});

	it("is refused once the Transaction has changed on another screen", async () => {
		const id = await bankLine("2026-10-02");
		const [row] = await listed(october);
		const version = row?.version ?? 0;
		const first = await move(id, "2026-10-03", version);
		expect(first).toMatchObject({ ok: true, version: version + 1 });
		expect(await move(id, "2026-10-04", version)).toEqual({
			ok: false,
			reason: "changed-elsewhere",
		});
	});

	it("goes back with Undo: the bank's day again, and nothing kept beside it", async () => {
		const id = await bankLine("2026-10-02");
		const moved = await move(id, "2026-09-30");
		if (!moved.ok) throw new Error("not moved");
		expect(await move(id, moved.from, moved.version)).toMatchObject({
			ok: true,
			bankDate: null,
			months: [september, october],
		});
		expect(await stored()).toMatchObject([{ date: "2026-10-02", bankDate: null }]);
		// Moved twice, the bank's day is still the bank's.
		await move(id, "2026-10-04");
		await move(id, "2026-10-06");
		expect(await stored()).toMatchObject([{ date: "2026-10-06", bankDate: "2026-10-02" }]);
	});

	it("changes a line typed in where it is: there is no bank's day to keep", async () => {
		await addQuickAdd(db, {
			householdId,
			transactionId: "coffee",
			bucketId: "eating",
			date: "2026-10-06" as DayKey,
			amountCents: 5_00,
			note: "Coffee",
			forMemberIds: [],
			createdByMemberId: parentId,
		});
		expect(await move("coffee", "2026-09-30")).toMatchObject({ ok: true, bankDate: null });
		expect(await stored()).toMatchObject([{ id: "coffee", date: "2026-09-30", bankDate: null }]);
	});
});

/** A second bank line, filed in Eating out. */
async function bankLine2(date: string) {
	await sync("imp-2", [line("t2", date, -10_00, { description: "Tartine" })]);
	const row = (await stored()).find((found) => found.externalId === "id:t2");
	const id = row?.id ?? "";
	await updateTransaction(db, {
		householdId,
		memberId: parentId,
		transactionId: id,
		amountCents: 10_00,
		assignment: { bucketId: "eating" },
		note: "Tartine",
		forMemberIds: [],
		today,
	});
	return id;
}

describe("the bank, after a Parent changed the date", () => {
	it("says the same line again: the Parent's day stays and nothing is added", async () => {
		const id = await bankLine("2026-10-02");
		await move(id, "2026-09-30");
		expect(await sync("imp-2", [line("t1", "2026-10-02", -42_50)])).toMatchObject({
			changed: 0,
			removed: 0,
		});
		expect(await stored()).toMatchObject([{ id, date: "2026-09-30", bankDate: "2026-10-02" }]);
	});

	it("changes the line: its amount and the bank's day follow, the Parent's day stays", async () => {
		const id = await bankLine("2026-10-02");
		await move(id, "2026-09-30");
		expect(await sync("imp-2", [line("t1", "2026-10-03", -43_00)])).toMatchObject({
			changed: 1,
			months: expect.arrayContaining([september]),
		});
		expect(await stored()).toMatchObject([
			{ id, date: "2026-09-30", bankDate: "2026-10-03", amountCents: 43_00 },
		]);
		// A line nobody moved still follows the bank's day.
		const other = await bankLine2("2026-10-01");
		await sync("imp-3", [line("t2", "2026-10-02", -10_00, { description: "Tartine" })]);
		expect((await stored()).find((row) => row.id === other)).toMatchObject({
			date: "2026-10-02",
			bankDate: null,
		});
	});

	it("posts a pending line a Parent moved: the posted copy takes the row, on the Parent's day", async () => {
		await sync("imp-1", [line("p1", "2026-10-01", -42_50, { pending: true })]);
		const [pending] = await stored();
		const id = pending?.id ?? "";
		expect(await move(id, "2026-09-30")).toMatchObject({ ok: true });
		expect(
			await sync("imp-2", [line("t1", "2026-10-02", -42_50, { replaces: "p1" })], ["p1"]),
		).toMatchObject({ changed: 1, removed: 0 });
		expect(await stored()).toEqual([
			{
				id,
				externalId: "id:t1",
				date: "2026-09-30",
				bankDate: "2026-10-02",
				amountCents: 42_50,
				pending: false,
			},
		]);
	});

	it("takes the line back: it goes, wherever the Parent had put it", async () => {
		const id = await bankLine("2026-10-02");
		await move(id, "2026-09-30");
		expect(await sync("imp-2", [], ["t1"])).toMatchObject({ removed: 1 });
		expect(await stored()).toEqual([]);
	});

	it("still Matches a Quick Add to its bank copy by the bank's day", async () => {
		// The bank's line came first and a Parent moved it well away from the day it posted.
		await sync("imp-1", [line("t1", "2026-10-02", -42_50)]);
		const [bank] = await stored();
		expect(await move(bank?.id ?? "", "2026-09-20")).toMatchObject({ ok: true });
		await addQuickAdd(db, {
			householdId,
			transactionId: "dinner",
			bucketId: "eating",
			date: "2026-10-01" as DayKey,
			amountCents: 42_50,
			note: "Nopa",
			forMemberIds: [],
			createdByMemberId: parentId,
		});
		// Any later Import that covers the bank's day looks again.
		await sync("imp-2", [line("t9", "2026-10-02", -1_00, { description: "Parking" })]);
		expect(await db.select({ quickAddId: matches.quickAddId }).from(matches)).toEqual([
			{ quickAddId: "dinner" },
		]);
		// Counted once, as the Quick Add (the parking line isn't filed yet).
		expect(await spentIn(october)).toBe(42_50);
		expect(await spentIn(september)).toBe(0);
	});

	it("Matches a Quick Add a Parent moved back a day to the copy the bank sends later", async () => {
		await addQuickAdd(db, {
			householdId,
			transactionId: "dinner",
			bucketId: "eating",
			date: "2026-10-01" as DayKey,
			amountCents: 42_50,
			note: "Nopa",
			forMemberIds: [],
			createdByMemberId: parentId,
		});
		await move("dinner", "2026-09-30");
		await sync("imp-1", [line("t1", "2026-10-02", -42_50)]);
		expect(await db.select({ quickAddId: matches.quickAddId }).from(matches)).toEqual([
			{ quickAddId: "dinner" },
		]);
		expect(await spentIn(september)).toBe(42_50);
		expect(await spentIn(october)).toBe(0);
	});
});

describe("a Refund linked to its purchase", () => {
	it("keeps its rule: the purchase comes first, within 90 days, or the move is refused", async () => {
		const purchase = await bankLine("2026-09-10");
		const refund = await bankLine2("2026-09-20");
		await db.insert(refunds).values({
			id: "r-1",
			householdId,
			refundTransactionId: refund,
			originalTransactionId: purchase,
		});
		expect(await move(purchase, "2026-09-25")).toEqual({ ok: false, reason: "refund-order" });
		expect(await move(refund, "2026-09-05")).toEqual({ ok: false, reason: "refund-order" });
		expect(await stored()).toMatchObject([{ date: "2026-09-10" }, { date: "2026-09-20" }]);
		// Still before its Refund: the link moves with it.
		expect(await move(purchase, "2026-09-12")).toMatchObject({ ok: true });
		expect(await move(refund, "2026-10-01")).toMatchObject({ ok: true });
		expect(await db.select({ id: refunds.id }).from(refunds)).toEqual([{ id: "r-1" }]);
		// Money back counts where its purchase is filed, so the purchase is not left unassigned.
		expect(await move(purchase, "2026-08-30")).toEqual({
			ok: false,
			reason: "not-in-plan",
			part: "money-back",
			name: "Eating out",
		});
		expect((await stored()).find((row) => row.id === purchase)).toMatchObject({
			date: "2026-09-12",
		});
		// Unlinked, nothing holds it.
		await db.update(refunds).set({ removedAt: new Date() }).where(eq(refunds.id, "r-1"));
		expect(await move(purchase, "2026-10-05")).toMatchObject({ ok: true });
	});
});

describe("Download your data", () => {
	it("has both days of a Transaction a Parent moved", async () => {
		const id = await bankLine("2026-10-02");
		await move(id, "2026-09-30");
		const data = await loadExportData(db, viewer, today, 0);
		expect(data.transactions).toMatchObject([{ id, date: "2026-09-30", bankDate: "2026-10-02" }]);
	});
});
