import type { Cents, DayKey, MonthKey, StatementLine } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBucket,
	addIncome,
	createHouseholdForParent,
	type Db,
	decideExtraIncome,
	editMoneyIn,
	importStatement,
	loadFreeCarryMonths,
	loadIncome,
	loadIncomeCells,
	loadMoneyIn,
	loadMoneyInLine,
	loadPlanRecords,
	matchPayDays,
	removeIncome,
	setParentPay,
	setPayDayByHand,
	setTakeHomePay,
	stateWhosePay,
} from "./index";
import { members, monthCloses } from "./schema";
import { testDb } from "./test-db";

// A paycheck counts on its pay day (issue 156, phase 2; ADR-0063): every read that puts Income in
// a month takes the month from the pay day kept on the line, and from its date when it has none.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const sep: MonthKey = "2026-09";
const oct: MonthKey = "2026-10";

let db: Db;

const receive = (incomeId: string, date: string, dollars: number) =>
	addIncome(db, {
		householdId,
		incomeId,
		date: date as DayKey,
		amountCents: (dollars * 100) as Cents,
		note: null,
		createdByMemberId: parentId,
	});

/** The Parent is on a salary: $2,500 on the 1st and the 15th. */
const salaried = () =>
	setParentPay(db, {
		householdId,
		memberId: parentId,
		pay: { paycheck: 250_000 as Cents, schedule: { kind: "twice-a-month", days: [1, 15] } },
	});

/** Income counted in each month, by the two reads every total comes from. */
async function counted() {
	const months = async (from: MonthKey, until: MonthKey) =>
		(await loadIncome(db, householdId, from, until)).reduce((sum, i) => sum + i.amount, 0);
	const cells = await loadIncomeCells(
		db,
		householdId,
		{ from: "2026-09-01" as DayKey, until: "2026-11-01" as DayKey },
		"month",
	);
	const cell = (month: MonthKey) =>
		cells.filter((c) => c.period === month).reduce((sum, c) => sum + c.amount, 0);
	const totals = { sep: await months(sep, oct), oct: await months(oct, "2026-11") };
	// Reports and the Carry-over chain read the same months as This Month and the Plan.
	expect({ sep: cell(sep), oct: cell(oct) }).toEqual(totals);
	return totals;
}

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
	await setTakeHomePay(db, { householdId, memberId: parentId, month: sep, amountCents: 500_000 });
	await receive("pay-sep-15", "2026-09-15", 2500);
	await receive("pay-oct-01", "2026-09-30", 2450);
	await receive("pay-oct-15", "2026-10-15", 2500);
});

describe("a paycheck counts on its pay day", () => {
	it("counts every line on its date while none has a pay day", async () => {
		expect(await counted()).toEqual({ sep: 495_000, oct: 250_000 });
		// Nobody is on a salary: nothing is matched and nothing moves.
		expect(await matchPayDays(db, householdId, { claim: true })).toEqual({
			matched: 0,
			months: [],
			notMoved: [],
		});
		expect(await counted()).toEqual({ sep: 495_000, oct: 250_000 });
	});

	it("moves the paycheck posted on the 30th into the month of the 1st, and leaves its date", async () => {
		await salaried();
		const result = await matchPayDays(db, householdId, { claim: true });
		expect(result).toMatchObject({ matched: 3, notMoved: [] });
		expect(await counted()).toEqual({ sep: 250_000, oct: 495_000 });
		const line = await loadMoneyInLine(db, householdId, "pay-oct-01");
		expect(line).toMatchObject({
			date: "2026-09-30",
			amount: 245_000,
			payDay: "2026-10-01",
			payDayByHand: false,
			// Nobody had said whose pay it was: it is the only salaried Parent's.
			whosePay: parentId,
		});
		expect(await loadIncome(db, householdId, oct, "2026-11")).toContainEqual({
			id: "pay-oct-01",
			amount: 245_000,
			date: "2026-09-30",
			note: null,
			payDay: "2026-10-01",
		});
		// Asked again, nothing changes.
		expect(await matchPayDays(db, householdId, { claim: true })).toMatchObject({ matched: 0 });
		expect(await counted()).toEqual({ sep: 250_000, oct: 495_000 });
	});

	it("only matches Income that is already the Parent's pay unless a Parent has just said how they are paid", async () => {
		await salaried();
		expect(await matchPayDays(db, householdId)).toMatchObject({ matched: 0 });
		await editMoneyIn(db, viewer, { incomeId: "pay-oct-01", edit: { whosePay: parentId } });
		expect(await matchPayDays(db, householdId, { only: ["pay-oct-01"] })).toMatchObject({
			matched: 1,
			months: [sep, oct],
		});
		expect(await counted()).toEqual({ sep: 250_000, oct: 495_000 });
	});

	it("crosses the year: December 31 for January 1", async () => {
		await receive("pay-jan-01", "2026-12-31", 2500);
		await salaried();
		await matchPayDays(db, householdId, { claim: true });
		expect(await loadIncome(db, householdId, "2026-12", "2027-01")).toEqual([]);
		expect(await loadIncome(db, householdId, "2027-01", "2027-02")).toMatchObject([
			{ id: "pay-jan-01", date: "2026-12-31", payDay: "2027-01-01" },
		]);
	});

	it("sends it back by hand, and never matches it again", async () => {
		await salaried();
		await matchPayDays(db, householdId, { claim: true });
		const said = await setPayDayByHand(db, viewer, { incomeId: "pay-oct-01", payDay: null });
		expect(said).toMatchObject({ ok: true, line: { payDay: null, payDayByHand: true } });
		expect(await counted()).toEqual({ sep: 495_000, oct: 250_000 });
		expect(await matchPayDays(db, householdId, { claim: true })).toMatchObject({ matched: 0 });
		expect(await counted()).toEqual({ sep: 495_000, oct: 250_000 });
		// And by hand again, for the pay day a Parent picks.
		const back = await setPayDayByHand(db, viewer, {
			incomeId: "pay-oct-01",
			payDay: "2026-10-01" as DayKey,
		});
		expect(back).toMatchObject({ ok: true, line: { payDay: "2026-10-01", payDayByHand: true } });
		expect(await counted()).toEqual({ sep: 250_000, oct: 495_000 });
	});

	it("refuses a day that is not a nearby pay day, or is another line's", async () => {
		await salaried();
		await matchPayDays(db, householdId, { claim: true });
		const by = (incomeId: string, payDay: string) =>
			setPayDayByHand(db, viewer, { incomeId, payDay: payDay as DayKey });
		expect(await by("pay-oct-01", "2026-10-03")).toEqual({ ok: false, reason: "refused" });
		expect(await by("pay-oct-01", "2026-12-01")).toEqual({ ok: false, reason: "refused" });
		expect(await by("pay-oct-01", "2026-09-15")).toEqual({ ok: false, reason: "refused" });
	});

	it("leaves a paycheck where it landed while Extra income decided in that month needs it", async () => {
		// September: $4,950 of pay and a $3,000 bonus, $2,950 beyond the take-home pay, all decided.
		await receive("bonus", "2026-09-20", 3000);
		const decided = await decideExtraIncome(db, {
			householdId,
			moveId: "extra",
			month: sep,
			to: { kind: "free-to-spend" },
			amountCents: 295_000 as Cents,
			createdByMemberId: parentId,
		});
		expect(decided).toEqual({ ok: true });
		await salaried();
		const result = await matchPayDays(db, householdId, { claim: true });
		// The two that stay in their month are kept; the one that would leave September is not.
		expect(result.matched).toBe(2);
		expect(result.notMoved).toEqual([
			{
				lineId: "pay-oct-01",
				note: null,
				amount: 245_000,
				date: "2026-09-30",
				payDay: "2026-10-01",
				reason: "extra-income",
				month: sep,
			},
		]);
		expect(await counted()).toEqual({ sep: 795_000, oct: 250_000 });
		// By hand it is refused the way removing that Income would be.
		await editMoneyIn(db, viewer, { incomeId: "pay-oct-01", edit: { whosePay: parentId } });
		expect(
			await setPayDayByHand(db, viewer, { incomeId: "pay-oct-01", payDay: "2026-10-01" as DayKey }),
		).toEqual({ ok: false, reason: "extra-income" });
	});

	it("never moves Income into or out of a month that has been closed", async () => {
		await db.insert(monthCloses).values({ id: "close-sep", householdId, month: sep });
		await salaried();
		const result = await matchPayDays(db, householdId, { claim: true });
		expect(result.matched).toBe(2);
		expect(result.notMoved).toMatchObject([
			{ lineId: "pay-oct-01", reason: "month-closed", month: sep },
		]);
		expect(await counted()).toEqual({ sep: 495_000, oct: 250_000 });
		await editMoneyIn(db, viewer, { incomeId: "pay-oct-01", edit: { whosePay: parentId } });
		expect(
			await setPayDayByHand(db, viewer, { incomeId: "pay-oct-01", payDay: "2026-10-01" as DayKey }),
		).toEqual({ ok: false, reason: "month-closed" });
	});

	it("removes a paycheck from the month it counts in, and forgets the pay day with whose pay it is", async () => {
		await salaried();
		await matchPayDays(db, householdId, { claim: true });
		// Listed under October, so September has no such Income to remove: it stays.
		await removeIncome(db, { householdId, incomeId: "pay-oct-01", month: sep });
		expect(await loadMoneyInLine(db, householdId, "pay-oct-01")).not.toBeNull();
		// Given to the Household, it is nobody's paycheck and counts where it landed again.
		const given = await editMoneyIn(db, viewer, {
			incomeId: "pay-oct-01",
			edit: { whosePay: null },
		});
		expect(given).toMatchObject({ ok: true, line: { payDay: null, whosePay: null } });
		expect(await counted()).toEqual({ sep: 495_000, oct: 250_000 });
		expect(await removeIncome(db, { householdId, incomeId: "pay-oct-01", month: sep })).toEqual({
			ok: true,
		});
	});
});

describe("the Carry-over with a paycheck across a month's end", () => {
	const nov: MonthKey = "2026-11";
	/** What September and October each left of their own, and what October hands on, both ended. */
	const carried = async () => {
		const months = await loadFreeCarryMonths(
			db,
			viewer,
			await loadPlanRecords(db, householdId, nov),
			nov,
			nov,
		);
		const of = (month: MonthKey) => months.find((one) => one.month === month);
		return { sep: of(sep)?.own, oct: of(oct)?.own, handedOn: of(oct)?.left };
	};

	it("takes it from the month it landed in and gives it to the pay day's, the sum unchanged", async () => {
		await addBucket(db, {
			householdId,
			memberId: parentId,
			bucketId: "fun",
			name: "Fun",
			color: 1,
			month: sep,
			allowanceCents: 100_000,
		});
		// Nothing was spent, so each ended month leaves the Income that counted in it.
		const before = await carried();
		expect(before).toEqual({ sep: 495_000, oct: 250_000, handedOn: 745_000 });

		await salaried();
		await matchPayDays(db, householdId, { claim: true });
		expect(await carried()).toEqual({ sep: 250_000, oct: 495_000, handedOn: 745_000 });
		expect(await counted()).toEqual({ sep: 250_000, oct: 495_000 });

		// And back, by hand.
		await setPayDayByHand(db, viewer, { incomeId: "pay-oct-01", payDay: null });
		expect(await carried()).toEqual(before);
	});
});

describe("a paycheck that arrives by Import", () => {
	const PAY = "NORTHWIND PAYROLL";
	let nextId = 0;
	const line = (date: string, amount: number, description = PAY): StatementLine => ({
		date: date as DayKey,
		amount: amount as Cents,
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
			newId: () => `row-${String(++nextId).padStart(4, "0")}`,
		});
	const landed = async (date: string) => {
		const found = (await loadMoneyIn(db, householdId)).find((row) => row.date === date);
		if (!found) throw new Error(`no money in on ${date}`);
		return found;
	};
	const sum = (lines: { amount: number }[]) => lines.reduce((total, l) => total + l.amount, 0);

	beforeEach(async () => {
		nextId = 0;
		await addAccount(db, {
			householdId,
			accountId: "checking",
			name: "Checking",
			kind: "checking",
			balanceCents: 0,
			balanceId: "checking-balance",
			createdByMemberId: parentId,
		});
		await salaried();
		await stateWhosePay(db, viewer, { ruleId: "rule-pay", wording: PAY, payMemberId: parentId });
	});

	it("is the pay for the pay day it landed near, and counts in that day's month", async () => {
		await importInto("import-1", [
			line("2026-10-30", 248_000),
			// Nobody's pay by any Rule: it counts where it landed, though it fits a pay day.
			line("2026-10-31", 250_000, "MOBILE DEPOSIT"),
			// The Parent's pay, and nowhere near a paycheck.
			line("2026-10-29", 40_000),
		]);
		expect(await landed("2026-10-30")).toMatchObject({
			whosePay: parentId,
			payDay: "2026-11-01",
			payDayByHand: false,
		});
		expect(await landed("2026-10-31")).toMatchObject({ whosePay: null, payDay: null });
		expect(await landed("2026-10-29")).toMatchObject({ whosePay: parentId, payDay: null });
		// October: its own typed paycheck and the two lines that stayed.
		expect(sum(await loadIncome(db, householdId, oct, "2026-11"))).toBe(540_000);
		expect(sum(await loadIncome(db, householdId, "2026-11", "2026-12"))).toBe(248_000);
		// The same statement again writes nothing and moves nothing.
		await importInto("import-2", [line("2026-10-30", 248_000)]);
		expect(sum(await loadIncome(db, householdId, "2026-11", "2026-12"))).toBe(248_000);
	});

	it("leaves a second deposit near the same pay day as ordinary Income", async () => {
		await importInto("import-1", [line("2026-10-30", 248_000), line("2026-10-31", 262_000)]);
		// The closest in amount takes the pay day (the owner's rule on the issue).
		expect(await landed("2026-10-30")).toMatchObject({ payDay: "2026-11-01" });
		expect(await landed("2026-10-31")).toMatchObject({ payDay: null });
		expect(sum(await loadIncome(db, householdId, oct, "2026-12"))).toBe(760_000);
	});
});

describe("two salaried Parents", () => {
	const otherId = "other-parent";
	const whose = async (incomeId: string) => {
		const line = await loadMoneyInLine(db, householdId, incomeId);
		return { whosePay: line?.whosePay, payDay: line?.payDay };
	};

	beforeEach(async () => {
		await db.insert(members).values({ id: otherId, householdId, kind: "parent", name: "Sam" });
		await salaried();
		// Sam: $2,600 once a month on the 1st, within $300 of Alex's paycheck.
		await setParentPay(db, {
			householdId,
			memberId: otherId,
			pay: { paycheck: 260_000 as Cents, schedule: { kind: "monthly", day: 1 } },
		});
	});

	it("never guesses whose paycheck a deposit is when it could be either Parent's", async () => {
		const result = await matchPayDays(db, householdId, { claim: true });
		// The 15ths are only Alex's pay day; the deposit for the 1st fits both.
		expect(result.matched).toBe(2);
		expect(await whose("pay-sep-15")).toEqual({ whosePay: parentId, payDay: "2026-09-15" });
		expect(await whose("pay-oct-01")).toEqual({ whosePay: null, payDay: null });
		expect(await counted()).toEqual({ sep: 495_000, oct: 250_000 });
	});

	it("gives each Parent their own pay day on the same day, each line counted once", async () => {
		await receive("sam-oct-01", "2026-10-02", 2600);
		await editMoneyIn(db, viewer, { incomeId: "pay-oct-01", edit: { whosePay: parentId } });
		await editMoneyIn(db, viewer, { incomeId: "sam-oct-01", edit: { whosePay: otherId } });
		await matchPayDays(db, householdId, { claim: true });
		expect(await whose("pay-oct-01")).toEqual({ whosePay: parentId, payDay: "2026-10-01" });
		expect(await whose("sam-oct-01")).toEqual({ whosePay: otherId, payDay: "2026-10-01" });
		expect(await counted()).toEqual({ sep: 250_000, oct: 755_000 });
	});
});
