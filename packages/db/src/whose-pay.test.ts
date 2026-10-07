import type { Cents, DayKey, MonthKey, StatementLine } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addIncome,
	createHouseholdForParent,
	type Db,
	decideExtraIncome,
	editMoneyIn,
	importStatement,
	loadMoneyIn,
	loadMoneyInLine,
	loadMoneyInRules,
	saveMoneyInRule,
	setTakeHomePay,
	stateWhosePay,
} from "./index";
import { members } from "./schema";
import { testDb } from "./test-db";

// Income says whose pay it is: a Parent's or the Household's (issue 133, ADR-0057). Whose pay and
// the note can always be changed; amount and date only on Income a Parent typed in. Every change
// is made on a version (ADR-0041).

const householdId = "household";
const parentId = "parent";
const otherId = "other-parent";
const viewer = { householdId, memberId: parentId };
const month: MonthKey = "2026-09";
const PAY = "ACME CORP PAYROLL 0042";
const GIG = "STRIPE TRANSFER CORI DESIGN";

let db: Db;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;

const line = (date: DayKey, amount: number, description: string): StatementLine => ({
	date,
	amount,
	description,
	bankId: null,
});

const importInto = (importId: string, lines: StatementLine[]) =>
	importStatement(db, {
		householdId,
		importId,
		accountId: "checking",
		source: "csv",
		fileName: null,
		fileKey: null,
		lines,
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: parentId,
		newId,
	});

const byNote = async (note: string) => {
	const found = (await loadMoneyIn(db, householdId)).find((row) => row.note === note);
	if (!found) throw new Error(`no money in: ${note}`);
	return found;
};

const typed = async (incomeId: string, date: DayKey, amountCents: number, note: string) => {
	await addIncome(db, {
		householdId,
		incomeId,
		date,
		amountCents: amountCents as Cents,
		note,
		createdByMemberId: parentId,
	});
	return incomeId;
};

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
	await db.insert(members).values([
		{ id: otherId, householdId, kind: "parent", name: "Sam" },
		{ id: "child", householdId, kind: "child", name: "Kit", color: 3 },
	]);
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

describe("whose pay", () => {
	it("is the Household's until a Parent says whose", async () => {
		await typed("typed-1", "2026-09-05", 250_000, "Paycheck");
		await importInto("import-1", [line("2026-09-01", 300_000, PAY)]);
		expect((await loadMoneyIn(db, householdId)).map((row) => row.whosePay)).toEqual([null, null]);
	});

	it("is changed to a Parent and back, on the version looked at", async () => {
		const id = await typed("typed-1", "2026-09-05", 250_000, "Paycheck");
		const first = await editMoneyIn(db, viewer, {
			incomeId: id,
			expectedVersion: 0,
			edit: { whosePay: otherId },
		});
		expect(first).toMatchObject({ ok: true, line: { whosePay: otherId, version: 1 } });
		const back = await editMoneyIn(db, viewer, {
			incomeId: id,
			expectedVersion: 1,
			edit: { whosePay: null },
		});
		expect(back).toMatchObject({ ok: true, line: { whosePay: null, version: 2 } });
	});

	it("is never a Child or somebody from another Household", async () => {
		const id = await typed("typed-1", "2026-09-05", 250_000, "Paycheck");
		for (const whosePay of ["child", "nobody"]) {
			expect(await editMoneyIn(db, viewer, { incomeId: id, edit: { whosePay } })).toEqual({
				ok: false,
				reason: "refused",
			});
		}
		expect((await loadMoneyInLine(db, householdId, id))?.version).toBe(0);
	});
});

describe("editing money in", () => {
	it("changes the amount and date of Income a Parent typed, and says both months", async () => {
		const id = await typed("typed-1", "2026-09-05", 250_000, "Paycheck");
		const result = await editMoneyIn(db, viewer, {
			incomeId: id,
			expectedVersion: 0,
			edit: { amountCents: 260_000 as Cents, date: "2026-08-29", note: "August pay" },
		});
		expect(result).toMatchObject({
			ok: true,
			line: { amount: 260_000, date: "2026-08-29", note: "August pay", version: 1 },
		});
		expect(result.ok && [...result.months].sort()).toEqual(["2026-08", "2026-09"]);
	});

	it("leaves an imported line's amount and date alone, but takes its note and whose pay", async () => {
		await importInto("import-1", [line("2026-09-01", 300_000, PAY)]);
		const before = await byNote(PAY);
		expect(
			await editMoneyIn(db, viewer, { incomeId: before.id, edit: { amountCents: 1 as Cents } }),
		).toEqual({ ok: false, reason: "refused" });
		expect(
			await editMoneyIn(db, viewer, { incomeId: before.id, edit: { date: "2026-09-02" } }),
		).toEqual({ ok: false, reason: "refused" });
		const result = await editMoneyIn(db, viewer, {
			incomeId: before.id,
			edit: { note: "Alex’s pay", whosePay: parentId },
		});
		expect(result).toMatchObject({
			ok: true,
			line: { note: "Alex’s pay", whosePay: parentId, amount: 300_000, date: "2026-09-01" },
		});
	});

	it("is left alone when it was changed on another screen, and a repeat of one that landed is saved", async () => {
		const id = await typed("typed-1", "2026-09-05", 250_000, "Paycheck");
		const edit = { whosePay: otherId };
		await editMoneyIn(db, viewer, { incomeId: id, expectedVersion: 0, edit });
		// The answer was lost and the same change is sent again (ADR-0056).
		expect(await editMoneyIn(db, viewer, { incomeId: id, expectedVersion: 0, edit })).toMatchObject(
			{ ok: true, line: { version: 1 } },
		);
		// Another change made on the old version is not written over it.
		expect(
			await editMoneyIn(db, viewer, { incomeId: id, expectedVersion: 0, edit: { note: "Mine" } }),
		).toMatchObject({ ok: false, reason: "changed-elsewhere", current: { whosePay: otherId } });
	});

	it("won't take Income away that Extra income already decided needs", async () => {
		const id = await typed("typed-1", "2026-09-05", 700_000, "Paycheck");
		const decided = await decideExtraIncome(db, {
			householdId,
			moveId: "move-1",
			month,
			amountCents: 60_000,
			to: { kind: "free-to-spend" },
			createdByMemberId: parentId,
		});
		expect(decided.ok).toBe(true);
		const lower = (amountCents: number) =>
			editMoneyIn(db, viewer, { incomeId: id, edit: { amountCents: amountCents as Cents } });
		expect(await lower(640_000)).toEqual({ ok: false, reason: "extra-income" });
		expect(await editMoneyIn(db, viewer, { incomeId: id, edit: { date: "2026-08-31" } })).toEqual({
			ok: false,
			reason: "extra-income",
		});
		expect(await lower(680_000)).toMatchObject({ ok: true, line: { amount: 680_000 } });
		// More is never refused, nor is whose pay.
		expect(await lower(900_000)).toMatchObject({ ok: true });
	});

	it("refuses a line that isn't the Household's", async () => {
		expect(await editMoneyIn(db, viewer, { incomeId: "nothing", edit: { note: "x" } })).toEqual({
			ok: false,
			reason: "refused",
		});
	});
});

describe("whose pay by Rule", () => {
	it("an Import gives a deposit to the Parent its Rule names", async () => {
		await saveMoneyInRule(db, viewer, {
			ruleId: "rule-1",
			wording: "ACME CORP PAYROLL",
			kind: "income",
			payMemberId: otherId,
		});
		expect(await loadMoneyInRules(db, householdId)).toMatchObject([
			{ pattern: "acme corp payroll", kind: "income", payMemberId: otherId },
		]);
		await importInto("import-1", [
			line("2026-09-01", 300_000, PAY),
			line("2026-09-02", 90_000, GIG),
		]);
		expect((await byNote(PAY)).whosePay).toBe(otherId);
		expect((await byNote(GIG)).whosePay).toBeNull();
	});

	it("stating it from a line also marks the deposits already here that are still the Household's", async () => {
		await importInto("import-1", [
			line("2026-07-01", 300_000, PAY),
			line("2026-08-01", 300_000, PAY),
			line("2026-08-03", 90_000, GIG),
		]);
		await importInto("import-2", [line("2026-09-01", 310_000, "ACME CORP PAYROLL 0077")]);
		const mine = await byNote("ACME CORP PAYROLL 0077");
		await editMoneyIn(db, viewer, { incomeId: mine.id, edit: { whosePay: parentId } });

		const stated = await stateWhosePay(db, viewer, {
			ruleId: "rule-1",
			wording: "ACME CORP PAYROLL",
			payMemberId: otherId,
		});
		expect(stated).toEqual({ pattern: "acme corp payroll", changed: 2 });
		const lines = await loadMoneyIn(db, householdId);
		expect(lines.map((row) => [row.date, row.whosePay])).toEqual([
			["2026-09-01", parentId],
			["2026-08-03", null],
			["2026-08-01", otherId],
			["2026-07-01", otherId],
		]);
		// The lines it changed moved on a version, so a screen that had them open is told.
		expect(lines.find((row) => row.date === "2026-07-01")?.version).toBe(1);
	});

	it("interest a bank paid is Income without asking, and the Household's", async () => {
		await saveMoneyInRule(db, viewer, {
			ruleId: "rule-1",
			wording: "ACME CORP PAYROLL",
			kind: "income",
			payMemberId: otherId,
		});
		await importInto("import-1", [line("2026-09-30", 412, "INTEREST PAID")]);
		expect(await byNote("INTEREST PAID")).toMatchObject({
			kind: "income",
			needsReview: false,
			whosePay: null,
		});
	});

	it("interest worded person to person waits in Review like other money from a person", async () => {
		await importInto("import-1", [
			line("2026-09-30", 5000, "Zelle payment from MARIA LOPEZ loan interest"),
		]);
		expect(await byNote("Zelle payment from MARIA LOPEZ loan interest")).toMatchObject({
			kind: "income",
			needsReview: true,
		});
	});
});
