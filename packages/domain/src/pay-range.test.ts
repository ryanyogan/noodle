import { describe, expect, it } from "vitest";
import type { Cents, DayKey } from "./index";
import { countOnOffer, type PayLine, payRanges } from "./pay-range";

// Each Parent's pay over the last three full months (issue 133, ADR-0040 as amended): the range a
// Parent whose pay varies is shown, and the low end the Take-home pay counts on.

const pay = (date: string, dollars: number, whosePay: string | null): PayLine => ({
	date: date as DayKey,
	amount: (dollars * 100) as Cents,
	whosePay,
});
const cents = (dollars: number) => (dollars * 100) as Cents;

const steady = [
	pay("2026-07-15", 4000, "ryan"),
	pay("2026-08-15", 4000, "ryan"),
	pay("2026-09-15", 4010, "ryan"),
	pay("2026-10-15", 4000, "ryan"),
];
const varying = [
	pay("2026-07-03", 1000, "cori"),
	pay("2026-07-20", 1100, "cori"),
	pay("2026-08-11", 2900, "cori"),
	pay("2026-09-09", 2500, "cori"),
	pay("2026-10-02", 1840, "cori"),
];

describe("payRanges", () => {
	it("gives a Parent's pay so far and the lowest and highest of the last three full months", () => {
		expect(payRanges(varying, "2026-10")).toEqual([
			{
				whosePay: "cori",
				soFar: cents(1840),
				usual: { low: cents(2100), high: cents(2900) },
				varies: true,
				countOn: cents(2100),
			},
		]);
	});

	it("does not call pay that lands a few dollars different varying", () => {
		const [range] = payRanges(steady, "2026-10");
		expect(range?.usual).toEqual({ low: cents(4000), high: cents(4010) });
		expect(range?.varies).toBe(false);
	});

	it("says nothing is usual until all three months had pay", () => {
		const lines = [pay("2026-08-11", 2900, "cori"), pay("2026-09-09", 2500, "cori")];
		expect(payRanges(lines, "2026-10")).toEqual([
			// Counted on for the lower of the two months she was paid, not for nothing.
			{ whosePay: "cori", soFar: 0, usual: null, varies: false, countOn: cents(2500) },
		]);
	});

	it("leaves out this month's pay and anything older than three months from what is usual", () => {
		const lines = [pay("2026-06-30", 9000, "cori"), ...varying, pay("2026-11-01", 50, "cori")];
		expect(payRanges(lines, "2026-10")[0]?.usual).toEqual({ low: cents(2100), high: cents(2900) });
	});

	it("keeps each Parent and the Household apart, Parents first", () => {
		const lines = [...varying, pay("2026-10-01", 3, null), ...steady];
		expect(payRanges(lines, "2026-10").map((r) => [r.whosePay, r.soFar])).toEqual([
			["cori", cents(1840)],
			["ryan", cents(4000)],
			[null, cents(3)],
		]);
	});
});

describe("countOnOffer", () => {
	const ranges = payRanges([...steady, ...varying], "2026-10");

	it("offers the sum of the low ends when it has moved away from the Take-home pay", () => {
		expect(countOnOffer({ baseline: cents(5500), ranges })).toBe(cents(6100));
	});

	it("offers nothing when the Take-home pay already is the low end, give or take a few dollars", () => {
		expect(countOnOffer({ baseline: cents(6100), ranges })).toBeNull();
		expect(countOnOffer({ baseline: cents(6120), ranges })).toBeNull();
	});

	it("offers nothing when nobody's pay varies", () => {
		expect(
			countOnOffer({ baseline: cents(3000), ranges: payRanges(steady, "2026-10") }),
		).toBeNull();
	});

	it("offers nothing without Take-home pay", () => {
		expect(countOnOffer({ baseline: null, ranges })).toBeNull();
	});

	it("counts the Household's own pay at its low end and a one-off at nothing", () => {
		const lines = [
			...steady,
			...varying,
			pay("2026-07-31", 10, null),
			pay("2026-08-31", 12, null),
			pay("2026-09-30", 11, null),
			pay("2026-08-20", 3000, "bonus-parent"),
		];
		expect(countOnOffer({ baseline: cents(5500), ranges: payRanges(lines, "2026-10") })).toBe(
			cents(6110),
		);
	});
});

// What each case offers, written down first (review of issue 133, finding C1). Months are the
// three full ones before October, oldest first; "so far" is October's.
describe("what a Parent's pay can be counted on for", () => {
	const person = (who: string | null, months: [number, number, number], soFar = 0): PayLine[] =>
		[
			["2026-07-10", months[0]],
			["2026-08-10", months[1]],
			["2026-09-10", months[2]],
			["2026-10-02", soFar],
		].flatMap(([date, dollars]) =>
			(dollars as number) > 0 ? [pay(date as string, dollars as number, who)] : [],
		);
	const countOn = (lines: PayLine[]) => payRanges(lines, "2026-10")[0]?.countOn;

	it.each([
		["steady", person("a", [4000, 4000, 4010]), 4000],
		["varying", person("a", [2100, 2500, 2900]), 2100],
		["started two months ago", person("a", [0, 4000, 4000]), 4000],
		["started two months ago, not the same twice", person("a", [0, 3000, 4000]), 3000],
		["started one month ago", person("a", [0, 0, 4000]), 4000],
		["a month with no pay day in it", person("a", [4000, 0, 4000]), 4000],
		["no pay last month, paid again this month", person("a", [4000, 4000, 0], 4000), 4000],
		["stopped a month ago", person("a", [4000, 4000, 0]), 0],
		["stopped two months ago", person("a", [4000, 0, 0]), 0],
		["the Household's own, every month", person(null, [10, 12, 11]), 10],
		["the Household's own, a one-off last month", person(null, [0, 0, 3000]), 0],
		["the Household's own, two months of three", person(null, [0, 12, 11]), 0],
	])("%s", (_name, lines, dollars) => {
		expect(countOn(lines)).toBe(cents(dollars));
	});

	it("shows a range, and says pay varies, only with three full months of pay", () => {
		const [started] = payRanges(person("a", [0, 3000, 4000]), "2026-10");
		expect(started).toMatchObject({ usual: null, varies: false });
	});

	const a = person("a", [2100, 2500, 2900]);
	const offer = (lines: PayLine[], baseline: number) =>
		countOnOffer({ baseline: cents(baseline), ranges: payRanges(lines, "2026-10") });

	it("counts the other Parent, who started two months ago, on what they've been paid", () => {
		const lines = [...a, ...person("b", [0, 4000, 4000])];
		expect(offer(lines, 6100)).toBeNull();
		expect(offer(lines, 5500)).toBe(cents(6100));
	});

	it("counts a Parent whose pay stopped at nothing", () => {
		expect(offer([...a, ...person("b", [4000, 4000, 0])], 6100)).toBe(cents(2100));
	});

	it("offers one Parent's low end when theirs is the only pay", () => {
		expect(offer(a, 2500)).toBe(cents(2100));
		expect(offer(a, 2110)).toBeNull();
	});

	it("offers nothing because somebody started or stopped, when nobody's pay varies", () => {
		const steadyA = person("a", [3000, 3000, 3000]);
		expect(offer([...steadyA, ...person("b", [0, 4000, 4000])], 3000)).toBeNull();
		expect(offer([...steadyA, ...person("b", [4000, 4000, 0])], 7000)).toBeNull();
		expect(offer(person("b", [0, 3000, 4000]), 5000)).toBeNull();
		expect(offer(person(null, [0, 0, 3000]), 5000)).toBeNull();
	});
});
