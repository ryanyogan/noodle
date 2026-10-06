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
			{ whosePay: "cori", soFar: 0, usual: null, varies: false, countOn: 0 },
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
