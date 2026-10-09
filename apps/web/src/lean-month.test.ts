import type { Cents, DayKey, LeanMonth } from "@noodle/domain";
import { describe, expect, test } from "vitest";
import { leanMonthText } from "./lean-month";

const lean = (over: Partial<Record<keyof LeanMonth, unknown>> = {}) =>
	({
		planned: 400_000 as Cents,
		inSoFar: 280_000 as Cents,
		gap: 120_000 as Cents,
		short: false,
		daysLeft: 23,
		toCome: 250_000 as Cents,
		by: "2026-10-24" as DayKey,
		overdue: false,
		noDay: 0 as Cents,
		after: 0 as Cents,
		...over,
	}) as LeanMonth;

describe("leanMonthText", () => {
	test("early in the month it is what is in so far, and what is to come against the rest", () => {
		expect(leanMonthText(lean(), "2026-10")).toBe(
			"$2,800 of the $4,000 your Plan counts on is in so far, $1,200 to go. $2,500 of pay to come is expected by Oct 24, which would cover it.",
		);
	});

	test("in the last days it is short, and late pay and pay with no day are said as they are", () => {
		expect(
			leanMonthText(
				lean({
					short: true,
					daysLeft: 3,
					toCome: 50_000,
					by: "2026-10-03",
					overdue: true,
					noDay: 30_000,
					after: 70_000,
				}),
				"2026-10",
			),
		).toBe(
			"October is $1,200 short of the $4,000 your Plan counts on, with 3 days left. $500 of pay to come was expected by Oct 3 and isn’t in yet; it would leave $700 to go. Another $300 is to come with no day expected.",
		);
		expect(leanMonthText(lean({ short: true, daysLeft: 0, toCome: 0, by: null }), "2026-10")).toBe(
			"October is $1,200 short of the $4,000 your Plan counts on, on its last day.",
		);
	});
});
