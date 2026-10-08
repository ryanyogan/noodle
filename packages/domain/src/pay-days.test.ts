import { describe, expect, it } from "vitest";
import type { Cents, DayKey, MonthKey } from "./index";
import {
	expectedPaychecks,
	latePay,
	type PaycheckLine,
	type PaySchedule,
	parsePaySchedule,
	payDayMatches,
	payDaysIn,
	usualPayDays,
} from "./pay-days";

// Pay days (issue 156, phase 1): the pay days a schedule gives a month, and which Income is read
// as each one's paycheck.

const cents = (dollars: number) => Math.round(dollars * 100) as Cents;
const line = (id: string, date: string, dollars: number): PaycheckLine => ({
	id,
	date: date as DayKey,
	amount: cents(dollars),
});
const twice = (a = 1, b = 15): PaySchedule => ({ kind: "twice-a-month", days: [a, b] });
const monthly = (day: number): PaySchedule => ({ kind: "monthly", day });

describe("parsePaySchedule", () => {
	it("reads the two schedules there are", () => {
		expect(parsePaySchedule({ kind: "monthly", day: 28 })).toEqual(monthly(28));
		expect(parsePaySchedule({ kind: "twice-a-month", days: [1, 15] })).toEqual(twice());
	});

	it("puts the earlier of two pay days first", () => {
		expect(parsePaySchedule({ kind: "twice-a-month", days: [20, 5] })).toEqual(twice(5, 20));
	});

	it("drops what the stored value never said", () => {
		expect(parsePaySchedule({ kind: "monthly", day: 15, anchor: "2026-10-02" })).toEqual(
			monthly(15),
		);
	});

	it.each([
		["nothing", null],
		["text", "monthly"],
		["a kind added later", { kind: "every-four-weeks", anchor: "2026-10-02" }],
		["every two weeks from no day", { kind: "every-two-weeks" }],
		["weekly from a day there isn't", { kind: "weekly", anchor: "2026-02-30" }],
		["weekly from a day as a number", { kind: "weekly", anchor: 20261002 }],
		["no day", { kind: "monthly" }],
		["day 0", { kind: "monthly", day: 0 }],
		["day 32", { kind: "monthly", day: 32 }],
		["half a day", { kind: "monthly", day: 1.5 }],
		["a day as text", { kind: "monthly", day: "15" }],
		["one pay day of two", { kind: "twice-a-month", days: [1] }],
		["three pay days", { kind: "twice-a-month", days: [1, 10, 20] }],
		["the same day twice", { kind: "twice-a-month", days: [15, 15] }],
		["a pay day out of the month", { kind: "twice-a-month", days: [1, 40] }],
	])("is no schedule for %s", (_name, value) => {
		expect(parsePaySchedule(value)).toBeNull();
	});
});

describe("payDaysIn", () => {
	it("gives twice a month its two days, earliest first", () => {
		expect(payDaysIn(twice(), "2026-10")).toEqual(["2026-10-01", "2026-10-15"]);
		expect(payDaysIn(twice(5, 20), "2026-01")).toEqual(["2026-01-05", "2026-01-20"]);
	});

	it("gives monthly its one day", () => {
		expect(payDaysIn(monthly(28), "2026-10")).toEqual(["2026-10-28"]);
	});

	it("pays on the month's last day when the month has no such day", () => {
		expect(payDaysIn(monthly(31), "2026-10")).toEqual(["2026-10-31"]);
		expect(payDaysIn(monthly(31), "2026-11")).toEqual(["2026-11-30"]);
		expect(payDaysIn(monthly(31), "2026-02")).toEqual(["2026-02-28"]);
		expect(payDaysIn(monthly(30), "2028-02")).toEqual(["2028-02-29"]);
		expect(payDaysIn(twice(15, 31), "2026-04")).toEqual(["2026-04-15", "2026-04-30"]);
	});

	it("is one pay day when both land on the month's last day", () => {
		expect(payDaysIn(twice(30, 31), "2026-02")).toEqual(["2026-02-28"]);
		expect(payDaysIn(twice(30, 31), "2026-03")).toEqual(["2026-03-30", "2026-03-31"]);
	});
});

describe("expectedPaychecks", () => {
	const pay = { paycheck: cents(2500), schedule: twice() };
	const read = (lines: PaycheckLine[], today = "2026-10-20", month: MonthKey = "2026-10") =>
		expectedPaychecks({ pay, month, lines, today: today as DayKey });

	it("lists one per pay day, expected until it is in", () => {
		expect(read([], "2026-10-01")).toEqual([
			{ day: "2026-10-01", expected: cents(2500), state: "expected" },
			{ day: "2026-10-15", expected: cents(2500), state: "expected" },
		]);
	});

	it("reads Income near a pay day as in, with what came and the day it landed", () => {
		const [first, second] = read([line("a", "2026-10-02", 2480.55)]);
		expect(first).toEqual({
			day: "2026-10-01",
			expected: cents(2500),
			state: "in",
			lineId: "a",
			amount: cents(2480.55),
			postedOn: "2026-10-02",
		});
		expect(second?.state).toBe("expected");
	});

	it("takes a paycheck from five days before to five days after, both counted", () => {
		const on = (date: string) => read([line("a", date, 2500)])[1]?.state;
		expect(on("2026-10-09")).toBe("expected");
		expect(on("2026-10-10")).toBe("in");
		expect(on("2026-10-20")).toBe("in");
		expect(on("2026-10-21")).toBe("expected");
	});

	it("takes a paycheck within $300 either way, the $300 counted", () => {
		const of = (dollars: number) => read([line("a", "2026-10-15", dollars)])[1]?.state;
		expect(of(2200)).toBe("in");
		expect(of(2199.99)).toBe("expected");
		expect(of(2800)).toBe("in");
		expect(of(2800.01)).toBe("expected");
	});

	it("reaches into the month before for a paycheck that landed early", () => {
		const [first] = read([line("a", "2026-09-30", 2500)]);
		expect(first).toMatchObject({ state: "in", postedOn: "2026-09-30" });
	});

	it("reaches into the month after for a paycheck that landed late", () => {
		const late = { paycheck: cents(2500), schedule: monthly(31) };
		const [only] = expectedPaychecks({
			pay: late,
			month: "2026-10",
			lines: [line("a", "2026-11-03", 2500)],
			today: "2026-11-10" as DayKey,
		});
		expect(only).toMatchObject({ day: "2026-10-31", state: "in", postedOn: "2026-11-03" });
	});

	it("gives the pay day to the closest in amount when several fit", () => {
		const [first] = read([
			line("a", "2026-10-01", 2300),
			line("b", "2026-10-03", 2490),
			line("c", "2026-09-29", 2600),
		]);
		expect(first).toMatchObject({ state: "in", lineId: "b" });
	});

	it("gives the pay day to the closest in days when amounts are as close", () => {
		const [first] = read([line("a", "2026-10-04", 2450), line("b", "2026-09-30", 2550)]);
		expect(first).toMatchObject({ state: "in", lineId: "b" });
	});

	it("gives the pay day to the earliest when amount and days are as close", () => {
		const [first] = read([line("b", "2026-10-02", 2500), line("a", "2026-09-30", 2500)]);
		expect(first).toMatchObject({ state: "in", lineId: "a" });
	});

	it("uses one Income line for one pay day only", () => {
		const close = { paycheck: cents(2500), schedule: twice(10, 14) };
		const days = expectedPaychecks({
			pay: close,
			month: "2026-10",
			lines: [line("a", "2026-10-12", 2500)],
			today: "2026-10-13" as DayKey,
		});
		expect(days.map((day) => day.state)).toEqual(["in", "expected"]);
	});

	it("gives each of two close pay days its own line", () => {
		const close = { paycheck: cents(2500), schedule: twice(10, 14) };
		const days = expectedPaychecks({
			pay: close,
			month: "2026-10",
			lines: [line("a", "2026-10-13", 2500), line("b", "2026-10-11", 2400)],
			today: "2026-10-13" as DayKey,
		});
		expect(days).toMatchObject([
			{ day: "2026-10-10", state: "in", lineId: "b" },
			{ day: "2026-10-14", state: "in", lineId: "a" },
		]);
	});

	it("leaves last month's late paycheck with last month's pay day", () => {
		// Paid on the 28th and the 3rd: Oct 1 is three days after Sep 28 and two before Oct 3.
		const near = { paycheck: cents(2500), schedule: twice(3, 28) };
		const read = (lines: PaycheckLine[]) =>
			expectedPaychecks({ pay: near, month: "2026-10", lines, today: "2026-10-02" as DayKey });
		// Alone it is the nearer pay day's, Oct 3.
		expect(read([line("a", "2026-10-01", 2500)])[0]).toMatchObject({ state: "in", lineId: "a" });
		// With a closer amount for Oct 3 it is Sep 28's, and not also Oct 28's.
		const days = read([line("a", "2026-10-01", 2450), line("b", "2026-10-02", 2500)]);
		expect(days).toMatchObject([
			{ day: "2026-10-03", state: "in", lineId: "b" },
			{ day: "2026-10-28", state: "expected" },
		]);
	});

	it("says a pay day hasn't come in once its five days after have passed", () => {
		const state = (today: string) => read([], today)[0]?.state;
		expect(state("2026-09-20")).toBe("expected");
		expect(state("2026-10-06")).toBe("expected");
		expect(state("2026-10-07")).toBe("late");
	});

	it("lists a short month's last day for a pay day it doesn't have", () => {
		const end = { paycheck: cents(4000), schedule: monthly(31) };
		const days = expectedPaychecks({
			pay: end,
			month: "2026-02",
			lines: [line("a", "2026-02-27", 4100)],
			today: "2026-02-27" as DayKey,
		});
		expect(days).toMatchObject([{ day: "2026-02-28", state: "in", amount: cents(4100) }]);
	});

	it("ignores Income nowhere near a paycheck or a pay day", () => {
		const days = read([line("a", "2026-10-08", 2500), line("b", "2026-10-15", 40)]);
		expect(days.map((day) => day.state)).toEqual(["late", "expected"]);
	});
});

describe("latePay", () => {
	const pay = { paycheck: cents(2500), schedule: twice() };
	const of = (lines: PaycheckLine[], today: string, since: string | null = "2026-08-01") =>
		latePay(
			[
				{
					memberId: "m1",
					name: "Robin",
					payDays: (["2026-09", "2026-10"] as MonthKey[]).flatMap((month) =>
						expectedPaychecks({ pay, month, lines, today: today as DayKey }),
					),
				},
			],
			since as DayKey | null,
		);

	it("is nothing while a pay day's days are not over, and the pay day once they are", () => {
		const september = [line("a", "2026-09-01", 2500), line("b", "2026-09-15", 2500)];
		expect(of(september, "2026-10-06")).toEqual([]);
		expect(of(september, "2026-10-07")).toEqual([
			{ memberId: "m1", name: "Robin", day: "2026-10-01", expected: cents(2500) },
		]);
	});

	it("goes once the paycheck is in, by the rule or kept by hand on a line far from the day", () => {
		const september = [line("a", "2026-09-01", 2500), line("b", "2026-09-15", 2500)];
		expect(of([...september, line("c", "2026-10-06", 2440)], "2026-10-07")).toEqual([]);
		const byHand = { ...line("d", "2026-10-12", 1900), payDay: "2026-10-01" as DayKey };
		expect(of([...september, byHand], "2026-10-13")).toEqual([]);
	});

	it("lists the month before's with this month's, earliest first", () => {
		expect(of([], "2026-10-07").map((late) => late.day)).toEqual([
			"2026-09-01",
			"2026-09-15",
			"2026-10-01",
		]);
	});

	it("leaves out a pay day whose days were over before the earliest Income Noodle has", () => {
		// Sep 15's days end Sep 20: Income from the 20th can still be it, from the 21st cannot.
		expect(of([], "2026-10-07", "2026-09-20").map((late) => late.day)).toEqual([
			"2026-09-15",
			"2026-10-01",
		]);
		expect(of([], "2026-10-07", "2026-09-21").map((late) => late.day)).toEqual(["2026-10-01"]);
		expect(of([], "2026-10-07", null)).toEqual([]);
	});
});

describe("every two weeks and weekly", () => {
	const twoWeekly = (anchor: string): PaySchedule => ({
		kind: "every-two-weeks",
		anchor: anchor as DayKey,
	});
	const weekly = (anchor: string): PaySchedule => ({ kind: "weekly", anchor: anchor as DayKey });

	it("reads both, with the day they are counted from", () => {
		expect(parsePaySchedule({ kind: "every-two-weeks", anchor: "2026-10-02" })).toEqual(
			twoWeekly("2026-10-02"),
		);
		expect(parsePaySchedule({ kind: "weekly", anchor: "2026-10-02" })).toEqual(
			weekly("2026-10-02"),
		);
	});

	it("gives a month every fourteenth day from the anchor: two in most, three in some", () => {
		const fridays = twoWeekly("2026-10-02");
		expect(payDaysIn(fridays, "2026-10")).toEqual(["2026-10-02", "2026-10-16", "2026-10-30"]);
		expect(payDaysIn(fridays, "2026-11")).toEqual(["2026-11-13", "2026-11-27"]);
		expect(payDaysIn(fridays, "2026-12")).toEqual(["2026-12-11", "2026-12-25"]);
		// A year has 26 or 27 of them, and no day is in two months or in none.
		const year = Array.from({ length: 12 }, (_, i) =>
			payDaysIn(fridays, `2026-${String(i + 1).padStart(2, "0")}` as MonthKey),
		);
		expect(year.flat()).toHaveLength(26);
		expect(new Set(year.flat()).size).toBe(26);
		expect(year.map((days) => days.length).filter((n) => n === 3)).toHaveLength(2);
	});

	it("counts back from an anchor that is still to come, and through a short February", () => {
		const fridays = twoWeekly("2027-03-05");
		expect(payDaysIn(fridays, "2027-02")).toEqual(["2027-02-05", "2027-02-19"]);
		expect(payDaysIn(fridays, "2026-10")).toEqual(["2026-10-02", "2026-10-16", "2026-10-30"]);
		// 2028 is a leap year: the 29th is a pay day when the count lands on it.
		expect(payDaysIn(twoWeekly("2028-02-29"), "2028-02")).toEqual([
			"2028-02-01",
			"2028-02-15",
			"2028-02-29",
		]);
	});

	it("gives a month every seventh day weekly: four in most, five in some", () => {
		const fridays = weekly("2026-10-02");
		expect(payDaysIn(fridays, "2026-10")).toEqual([
			"2026-10-02",
			"2026-10-09",
			"2026-10-16",
			"2026-10-23",
			"2026-10-30",
		]);
		expect(payDaysIn(fridays, "2026-11")).toHaveLength(4);
		expect(payDaysIn(fridays, "2027-02")).toEqual([
			"2027-02-05",
			"2027-02-12",
			"2027-02-19",
			"2027-02-26",
		]);
	});

	it("says how many pay days most months have", () => {
		expect(usualPayDays(twoWeekly("2026-10-02"))).toBe(2);
		expect(usualPayDays(weekly("2026-10-02"))).toBe(4);
		expect(usualPayDays(twice())).toBe(2);
		expect(usualPayDays(monthly(1))).toBe(1);
	});

	it("reads a three-paycheck month as three In, the fourth week's deposit nobody's", () => {
		const pay = { paycheck: cents(1800), schedule: twoWeekly("2026-10-02") };
		const lines = [
			line("a", "2026-10-01", 1800),
			line("b", "2026-10-16", 1810),
			line("c", "2026-10-30", 1795),
		];
		const days = expectedPaychecks({ pay, month: "2026-10", lines, today: "2026-10-31" as DayKey });
		expect(days.map((day) => [day.day, day.state])).toEqual([
			["2026-10-02", "in"],
			["2026-10-16", "in"],
			["2026-10-30", "in"],
		]);
		// What came in is each line once: nothing counted twice, nothing dropped.
		const total = days.reduce((sum, day) => sum + (day.state === "in" ? day.amount : 0), 0);
		expect(total).toBe(cents(1800 + 1810 + 1795));
	});

	it("gives each weekly deposit the pay day nearest it, one each, though their days overlap", () => {
		const pay = { paycheck: cents(900), schedule: weekly("2026-10-02") };
		const lines = ["2026-10-01", "2026-10-09", "2026-10-19", "2026-10-23"].map((date, i) => ({
			id: `l${i}`,
			date: date as DayKey,
			amount: cents(900),
			whosePay: "m1",
			payDay: null,
			byHand: false,
		}));
		const matches = payDayMatches({ parents: [{ memberId: "m1", pay }], lines });
		expect(matches.map((match) => [match.lineId, match.payDay]).sort()).toEqual([
			["l0", "2026-10-02"],
			["l1", "2026-10-09"],
			["l2", "2026-10-16"],
			["l3", "2026-10-23"],
		]);
	});

	it("keeps a paycheck posted the day before the month in the month of its pay day", () => {
		const pay = { paycheck: cents(1800), schedule: twoWeekly("2026-10-02") };
		const lines = [
			{
				id: "a",
				date: "2026-09-30" as DayKey,
				amount: cents(1800),
				whosePay: "m1",
				payDay: null,
				byHand: false,
			},
		];
		expect(payDayMatches({ parents: [{ memberId: "m1", pay }], lines })).toEqual([
			{ lineId: "a", payDay: "2026-10-02", memberId: "m1", claims: false },
		]);
	});
});
