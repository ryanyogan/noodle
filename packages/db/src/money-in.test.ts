import type { DayKey, MonthKey, StatementLine } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	changeMoneyInKind,
	createHouseholdForParent,
	type Db,
	decideExtraIncome,
	importStatement,
	loadBetweenUsIncome,
	loadIncome,
	loadMoneyIn,
	loadMoneyInLine,
	loadMoneyInReview,
	loadMoneyInRules,
	saveMoneyInRule,
	setTakeHomePay,
	unmarkTransfer,
} from "./index";
import { testDb } from "./test-db";

// Money in has a kind (issue 131, ADR-0057). Statements go in through importStatement, as an
// upload does; kinds are read and changed through the one read and the one write the app uses.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const month: MonthKey = "2026-09";
const PAY = "ACME CORP PAYROLL 0042";
const ZELLE = "Zelle payment from CASEY LOWE 24816357";
const CHECK = "MOBILE CHECK DEPOSIT";

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
		createdByMemberId: parentId,
		newId,
	});

const counted = async () =>
	(await loadIncome(db, householdId, month, "2026-10")).map((row) => row.note);
const byNote = async (note: string) => {
	const found = (await loadMoneyIn(db, householdId)).find((row) => row.note === note);
	if (!found) throw new Error(`no money in: ${note}`);
	return found;
};
const change = async (note: string, kind: Parameters<typeof changeMoneyInKind>[2]["kind"]) =>
	changeMoneyInKind(db, viewer, { incomeId: (await byNote(note)).id, kind, transferId: newId() });

beforeEach(async () => {
	db = testDb();
	nextId = 0;
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: "Alex",
	});
	await setTakeHomePay(db, { householdId, memberId: parentId, month, amountCents: 600_000 });
	await addAccount(db, {
		householdId,
		accountId: "checking",
		name: "Checking",
		kind: "checking",
		balanceCents: 0,
		balanceId: "checking-balance",
		createdByMemberId: parentId,
	});
});

describe("money in on Import", () => {
	beforeEach(async () => {
		await importInto("checking", "import-1", [
			line("2026-09-01", 600_000, PAY),
			line("2026-09-05", 30_000, ZELLE),
			line("2026-09-09", 12_000, CHECK),
		]);
	});

	it("counts pay and plain deposits as Income, and asks about person-to-person money", async () => {
		expect(await counted()).toEqual([PAY, CHECK]);
		const review = await loadMoneyInReview(db, householdId);
		expect(review.map((row) => [row.note, row.kind, row.needsReview])).toEqual([
			[ZELLE, "income", true],
		]);
		expect((await byNote(PAY)).needsReview).toBe(false);
	});

	it("keeps money in that reads as a refund out of Income until a Parent says what it is", async () => {
		await importInto("checking", "import-2", [
			line("2026-09-12", 4_500, "AMAZON REFUND"),
			line("2026-09-13", 90_000, "IRS TREAS 310 TAX REFUND"),
			line("2026-09-14", 120, "INTEREST PAYMENT"),
			line("2026-09-15", 5_000, "ACME CORP PAYROLL REVERSAL"),
		]);
		expect(await counted()).toEqual([
			PAY,
			CHECK,
			"IRS TREAS 310 TAX REFUND",
			"INTEREST PAYMENT",
			"ACME CORP PAYROLL REVERSAL",
		]);
		const review = await loadMoneyInReview(db, householdId);
		// Not a Refund yet: Review suggests it from the wording, and a Parent says so.
		expect(review.map((row) => [row.note, row.kind, row.needsReview])).toEqual([
			["AMAZON REFUND", "income", true],
			[ZELLE, "income", true],
		]);
		expect((await change("AMAZON REFUND", "refund")).ok).toBe(true);
		expect(await byNote("AMAZON REFUND")).toMatchObject({ kind: "refund", needsReview: false });
	});

	it("lists every line with its kind, newest first", async () => {
		const rows = await loadMoneyIn(db, householdId, { from: "2026-09-01", until: "2026-10-01" });
		expect(rows.map((row) => [row.note, row.kind])).toEqual([
			[CHECK, "income"],
			[ZELLE, "income"],
			[PAY, "income"],
		]);
		expect(rows.every((row) => !row.typed && row.accountId === "checking")).toBe(true);
	});

	it("does not ask again about a line a Parent decided when the statement is imported again", async () => {
		expect((await change(ZELLE, "paid-back")).ok).toBe(true);
		await importInto("checking", "import-2", [line("2026-09-05", 30_000, ZELLE)]);
		expect(await loadMoneyInReview(db, householdId)).toEqual([]);
		expect((await byNote(ZELLE)).kind).toBe("paid-back");
	});
});

describe("a Parent changes the kind", () => {
	beforeEach(async () => {
		await importInto("checking", "import-1", [
			line("2026-09-01", 600_000, PAY),
			line("2026-09-05", 30_000, ZELLE),
			line("2026-09-09", 12_000, CHECK),
		]);
	});

	it("takes a line out of Review as Income, and counts it", async () => {
		const result = await change(ZELLE, "income");
		expect(result).toMatchObject({ ok: true, line: { kind: "income", needsReview: false } });
		expect(await counted()).toEqual([PAY, ZELLE, CHECK]);
		expect(await loadMoneyInReview(db, householdId)).toEqual([]);
	});

	it("keeps a Refund and Paid back out of Income", async () => {
		expect(await change(ZELLE, "paid-back")).toMatchObject({
			ok: true,
			line: { kind: "paid-back", version: 1 },
		});
		expect(await change(CHECK, "refund")).toMatchObject({ ok: true, line: { kind: "refund" } });
		expect(await counted()).toEqual([PAY]);
		expect(await change(CHECK, "income")).toMatchObject({ ok: true, line: { kind: "income" } });
		expect(await counted()).toEqual([PAY, CHECK]);
	});

	it("moves between Transfer, Between us and back to Income", async () => {
		expect(await change(ZELLE, "between-us")).toMatchObject({
			ok: true,
			line: { kind: "between-us" },
		});
		expect((await loadBetweenUsIncome(db, householdId, month, "2026-10")).length).toBe(1);
		expect(await change(ZELLE, "transfer")).toMatchObject({ ok: true, line: { kind: "transfer" } });
		expect(await loadBetweenUsIncome(db, householdId, month, "2026-10")).toEqual([]);
		expect(await counted()).toEqual([PAY, CHECK]);
		expect(await change(ZELLE, "income")).toMatchObject({
			ok: true,
			line: { kind: "income", transferId: null },
		});
		expect(await counted()).toEqual([PAY, ZELLE, CHECK]);
	});

	it("stays out of Review once decided, even when its Transfer is unmarked", async () => {
		const marked = await change(ZELLE, "between-us");
		if (!marked.ok || !marked.line.transferId) throw new Error("not marked");
		await unmarkTransfer(db, viewer, marked.line.transferId);
		expect(await byNote(ZELLE)).toMatchObject({ kind: "income", needsReview: false });
	});

	it("refuses a change away from Income that decided Extra income needs", async () => {
		const decided = await decideExtraIncome(db, {
			householdId,
			moveId: "move-1",
			month,
			amountCents: 12_000,
			to: { kind: "free-to-spend" },
			createdByMemberId: parentId,
		});
		expect(decided.ok).toBe(true);
		for (const kind of ["refund", "paid-back", "transfer", "between-us"] as const)
			expect(await change(CHECK, kind)).toEqual({ ok: false, reason: "extra-income" });
		expect((await byNote(CHECK)).version).toBe(0);
		// A line that isn't counted yet is no part of that Extra income.
		expect((await change(ZELLE, "paid-back")).ok).toBe(true);
	});

	it("refuses a change made on an older version, and knows its own retry", async () => {
		const { id } = await byNote(CHECK);
		const first = await changeMoneyInKind(db, viewer, {
			incomeId: id,
			kind: "refund",
			transferId: newId(),
			expectedVersion: 0,
		});
		expect(first).toMatchObject({ ok: true, line: { version: 1 } });
		const retry = await changeMoneyInKind(db, viewer, {
			incomeId: id,
			kind: "refund",
			transferId: newId(),
			expectedVersion: 0,
		});
		expect(retry).toMatchObject({ ok: true, line: { version: 1 } });
		const stale = await changeMoneyInKind(db, viewer, {
			incomeId: id,
			kind: "paid-back",
			transferId: newId(),
			expectedVersion: 0,
		});
		expect(stale).toMatchObject({
			ok: false,
			reason: "changed-elsewhere",
			current: { kind: "refund", version: 1 },
		});
	});

	it("is refused for another Household's line", async () => {
		const { id } = await byNote(CHECK);
		const other = { householdId: "other", memberId: "someone" };
		expect(
			await changeMoneyInKind(db, other, { incomeId: id, kind: "refund", transferId: newId() }),
		).toEqual({ ok: false, reason: "refused" });
		expect(await loadMoneyInLine(db, "other", id)).toBeNull();
	});
});

describe("a Rule states a kind", () => {
	it("decides the next Import's lines without asking", async () => {
		expect(
			await saveMoneyInRule(db, viewer, { ruleId: "rule-1", wording: ZELLE, kind: "paid-back" }),
		).toBe("zelle from casey lowe");
		await saveMoneyInRule(db, viewer, {
			ruleId: "rule-2",
			wording: "GUSTO TRANSFER 8841",
			kind: "transfer",
		});
		await saveMoneyInRule(db, viewer, { ruleId: "rule-3", wording: "VENMO", kind: "income" });
		expect((await loadMoneyInRules(db, householdId)).length).toBe(3);
		await importInto("checking", "import-1", [
			line("2026-09-05", 30_000, ZELLE),
			line("2026-09-06", 250_000, "GUSTO TRANSFER 9917"),
			line("2026-09-07", 4_000, "VENMO CASHOUT 5521"),
		]);
		expect(await loadMoneyInReview(db, householdId)).toEqual([]);
		expect((await byNote(ZELLE)).kind).toBe("paid-back");
		expect((await byNote("GUSTO TRANSFER 9917")).kind).toBe("transfer");
		expect(await counted()).toEqual(["VENMO CASHOUT 5521"]);
	});

	it("keeps one Rule per wording, and never marks again what a Parent unmarked", async () => {
		await saveMoneyInRule(db, viewer, { ruleId: "rule-1", wording: "GUSTO", kind: "income" });
		await saveMoneyInRule(db, viewer, { ruleId: "rule-2", wording: "GUSTO", kind: "transfer" });
		expect(await loadMoneyInRules(db, householdId)).toMatchObject([
			{ id: "rule-1", pattern: "gusto", kind: "transfer" },
		]);
		const lines = [line("2026-09-06", 250_000, "GUSTO 9917")];
		await importInto("checking", "import-1", lines);
		const { transferId } = await byNote("GUSTO 9917");
		if (!transferId) throw new Error("not marked");
		await unmarkTransfer(db, viewer, transferId);
		await importInto("checking", "import-2", lines);
		expect((await byNote("GUSTO 9917")).kind).toBe("income");
	});
});
