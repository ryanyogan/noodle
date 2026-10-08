import type { Cents, DayKey, MonthKey } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addIncome,
	createHouseholdForParent,
	type Db,
	decideExtraIncome,
	editMoneyIn,
	loadIncome,
	loadIncomeCells,
	loadMoneyInLine,
	matchPayDays,
	removeIncome,
	setParentPay,
	setPayDayByHand,
	setTakeHomePay,
} from "./index";
import { monthCloses } from "./schema";
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
