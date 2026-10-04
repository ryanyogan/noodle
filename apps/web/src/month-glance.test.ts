import type { MonthState } from "@noodle/domain";
import { describe, expect, test } from "vitest";
import { monthSegments } from "./components/month-glance";

const state = (freeToSpend: number) =>
	({
		committed: 250_000,
		buckets: [{ spent: 40_000, available: 120_000 }],
		leftInBuckets: 80_000,
		fundedGoals: 0,
		freeToSpend,
	}) as unknown as MonthState;

describe("where take-home pay goes", () => {
	test("Free to Spend in the legend is the headline's amount when the Plan is over", () => {
		const free = monthSegments(state(-116_600)).find((s) => s.key === "free");
		expect(free?.amount).toBe(-116_600);
	});

	test("Free to Spend is listed at $0, and parts with nothing in them are not", () => {
		expect(monthSegments(state(0)).map((s) => [s.key, s.amount])).toEqual([
			["commitments", 250_000],
			["buckets-spent", 40_000],
			["buckets-left", 80_000],
			["free", 0],
		]);
	});
});
