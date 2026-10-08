import { describe, expect, it } from "vitest";
import { countsOn, extraIncomeOf, type Income, receivedIn } from "./extra-income";
import type { Cents, DayKey, MonthKey } from "./index";
import {
	expectedPaychecks,
	nearbyPayDays,
	type PayDayLine,
	type PaySchedule,
	payDayMatches,
	type SalaryPay,
} from "./pay-days";
import { payRanges } from "./pay-range";

// A paycheck counts on its pay day (issue 156, phase 2; ADR-0063).

const cents = (dollars: number) => Math.round(dollars * 100) as Cents;
const twice: PaySchedule = { kind: "twice-a-month", days: [1, 15] };
const pay = (dollars: number, schedule: PaySchedule = twice): SalaryPay => ({
	paycheck: cents(dollars),
	schedule,
});
const line = (
	id: string,
	date: string,
	dollars: number,
	whosePay: string | null = "alex",
	more: Partial<PayDayLine> = {},
): PayDayLine => ({
	id,
	date: date as DayKey,
	amount: cents(dollars),
	whosePay,
	payDay: null,
	byHand: false,
	...more,
});
const alex = { memberId: "alex", pay: pay(2500) };
const sam = { memberId: "sam", pay: pay(4000, { kind: "monthly", day: 31 }) };

/** `lines` with the pay days `payDayMatches` says, as the write keeps them. */
const kept = (lines: PayDayLine[], matches = payDayMatches({ parents: [alex, sam], lines })) =>
	lines.map((l) => {
		const match = matches.find((m) => m.lineId === l.id);
		return match ? { ...l, payDay: match.payDay, whosePay: match.memberId } : l;
	});

describe("payDayMatches", () => {
	it("gives a deposit on the 30th the 1st of the next month", () => {
		expect(payDayMatches({ parents: [alex], lines: [line("a", "2026-09-30", 2450)] })).toEqual([
			{ lineId: "a", payDay: "2026-10-01", memberId: "alex", claims: false },
		]);
	});

	it("crosses the year: December 31 is the pay for January 1", () => {
		expect(payDayMatches({ parents: [alex], lines: [line("a", "2026-12-31", 2500)] })).toEqual([
			{ lineId: "a", payDay: "2027-01-01", memberId: "alex", claims: false },
		]);
	});

	it("gives one pay day to the closest in amount, and leaves the other ordinary Income", () => {
		const lines = [line("near", "2026-09-30", 2300), line("exact", "2026-10-02", 2500)];
		expect(payDayMatches({ parents: [alex], lines })).toEqual([
			{ lineId: "exact", payDay: "2026-10-01", memberId: "alex", claims: false },
		]);
	});

	it("leaves alone a line more than $300 off, more than 5 days away, or somebody else's", () => {
		const lines = [
			line("small", "2026-10-01", 2199.99),
			line("far", "2026-10-07", 2500),
			line("household", "2026-10-15", 2500, null),
		];
		expect(payDayMatches({ parents: [alex], lines })).toEqual([]);
	});

	it("never matches a line a Parent spoke for by hand, or one that has a pay day", () => {
		const lines = [
			line("no", "2026-09-30", 2500, "alex", { byHand: true }),
			line("has", "2026-10-14", 2500, "alex", { payDay: "2026-10-15" as DayKey }),
			line("late", "2026-10-16", 2500),
		];
		// The 15th is taken by the line that holds it; the 1st stays open, as "no" was said by hand.
		expect(payDayMatches({ parents: [alex], lines })).toEqual([]);
	});

	it("keeps two Parents' paychecks apart", () => {
		const lines = [line("a", "2026-09-30", 2500, "alex"), line("s", "2026-09-30", 4000, "sam")];
		expect(payDayMatches({ parents: [alex, sam], lines })).toEqual([
			{ lineId: "s", payDay: "2026-09-30", memberId: "sam", claims: false },
			{ lineId: "a", payDay: "2026-10-01", memberId: "alex", claims: false },
		]);
	});

	it("claims Income nobody has said whose pay it is only when asked, and only for one Parent", () => {
		const lines = [line("a", "2026-09-30", 2500, null), line("s", "2026-10-30", 4000, null)];
		expect(payDayMatches({ parents: [alex, sam], lines })).toEqual([]);
		expect(payDayMatches({ parents: [alex, sam], lines, claim: true })).toEqual([
			{ lineId: "a", payDay: "2026-10-01", memberId: "alex", claims: true },
			{ lineId: "s", payDay: "2026-10-31", memberId: "sam", claims: true },
		]);
		// A deposit that could be either Parent's paycheck is nobody's until a Parent says.
		const both = [alex, { memberId: "sam", pay: pay(2600) }];
		expect(payDayMatches({ parents: both, lines: [lines[0] as PayDayLine], claim: true })).toEqual(
			[],
		);
	});

	it("matches only the lines that have just arrived when told which", () => {
		const lines = [line("old", "2026-09-30", 2500), line("new", "2026-10-15", 2500)];
		expect(payDayMatches({ parents: [alex], lines, only: ["new"] })).toEqual([
			{ lineId: "new", payDay: "2026-10-15", memberId: "alex", claims: false },
		]);
	});

	it("is the same asked again", () => {
		const lines = [line("a", "2026-09-30", 2450), line("b", "2026-10-15", 2500)];
		const once = kept(lines);
		expect(payDayMatches({ parents: [alex, sam], lines: once })).toEqual([]);
	});
});

describe("the month a paycheck counts in", () => {
	const september: MonthKey = "2026-09";
	const october: MonthKey = "2026-10";
	// Two months of Alex's pay: the paycheck for October 1 posted on September 30.
	const lines = [
		line("sep-1", "2026-09-01", 2500),
		line("sep-15", "2026-09-15", 2500),
		line("oct-1", "2026-09-30", 2450),
		line("oct-15", "2026-10-15", 2500),
	];
	const totals = (income: Income[]) => ({
		september: receivedIn(income, september),
		october: receivedIn(income, october),
	});
	const extra = (income: Income[], month: MonthKey) =>
		extraIncomeOf({ baseline: cents(5000), received: receivedIn(income, month), decided: 0 })
			.windfall;

	it("counts on the pay day when it has one, else on the day it landed", () => {
		expect(countsOn({ date: "2026-09-30" as DayKey })).toBe("2026-09-30");
		expect(countsOn({ date: "2026-09-30" as DayKey, payDay: null })).toBe("2026-09-30");
		expect(countsOn({ date: "2026-09-30" as DayKey, payDay: "2026-10-01" as DayKey })).toBe(
			"2026-10-01",
		);
	});

	it("moves Income, and the Extra income it made, to the pay day's month", () => {
		// Before: September has three paychecks and $2,450 of Extra income; October is $2,500 short.
		expect(totals(lines)).toEqual({ september: cents(7450), october: cents(2500) });
		expect(extra(lines, september)).toBe(cents(2450));
		const after = kept(lines);
		expect(totals(after)).toEqual({ september: cents(5000), october: cents(4950) });
		expect(extra(after, september)).toBe(0);
		expect(extra(after, october)).toBe(0);
		// Nothing is made or lost: what one month hands on less, the next has more of.
		expect(totals(after).september + totals(after).october).toBe(
			totals(lines).september + totals(lines).october,
		);
		// By the end of the 1st, October has its first paycheck.
		expect(receivedIn(after, october, 1)).toBe(cents(2450));
	});

	it("returns to the month it landed in once its pay day is taken off", () => {
		const after = kept(lines).map((l) => (l.id === "oct-1" ? { ...l, payDay: null } : l));
		expect(totals(after)).toEqual({ september: cents(7450), october: cents(2500) });
	});

	it("reads a Parent's pay by month from the same day", () => {
		const [range] = payRanges(kept(lines), october);
		expect(range?.soFar).toBe(cents(4950));
	});

	it("lists a kept pay day as In whatever the amount, and the rest by the rule", () => {
		const mine = kept(lines).map((l) =>
			l.id === "oct-1"
				? { ...l, amount: cents(1000) }
				: l.id === "oct-15"
					? { ...l, payDay: null }
					: l,
		);
		expect(
			expectedPaychecks({
				pay: alex.pay,
				month: october,
				lines: mine,
				today: "2026-10-20" as DayKey,
			}),
		).toMatchObject([
			{ day: "2026-10-01", state: "in", lineId: "oct-1", postedOn: "2026-09-30" },
			{ day: "2026-10-15", state: "in", lineId: "oct-15" },
		]);
		const byHand = mine.map((l) => (l.id === "oct-15" ? { ...l, byHand: true } : l));
		expect(
			expectedPaychecks({
				pay: alex.pay,
				month: october,
				lines: byHand,
				today: "2026-10-31" as DayKey,
			}),
		).toMatchObject([{ state: "in" }, { day: "2026-10-15", state: "late" }]);
	});

	it("offers by hand the pay days within 20 days of the day it landed", () => {
		expect(nearbyPayDays(twice, "2026-09-30" as DayKey)).toEqual([
			"2026-09-15",
			"2026-10-01",
			"2026-10-15",
		]);
	});
});
