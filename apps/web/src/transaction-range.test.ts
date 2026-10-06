import type { MonthKey } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import { monthHeading, rangeBounds, rangeName, totalLabel } from "./transaction-range";

const oct = "2026-10" as MonthKey;

describe("a range of months on the Transactions page", () => {
	it("is the month alone when left out", () => {
		expect(rangeBounds(undefined, oct)).toEqual({});
	});

	it("starts two months back for the last 3 months, across a year's end too", () => {
		expect(rangeBounds("3m", oct)).toEqual({ fromMonth: "2026-08" });
		expect(rangeBounds("3m", "2026-01" as MonthKey)).toEqual({ fromMonth: "2025-11" });
	});

	it("starts in January of the address's year for this year", () => {
		expect(rangeBounds("year", oct)).toEqual({ fromMonth: "2026-01" });
		expect(rangeBounds("year", "2025-03" as MonthKey)).toEqual({ fromMonth: "2025-01" });
	});

	it("is every month up to the address's for all time", () => {
		expect(rangeBounds("all", oct)).toEqual({ andEarlier: true });
	});

	it("names its months", () => {
		expect(rangeName("3m", oct)).toBe("Aug – Oct 2026");
		expect(rangeName("3m", "2026-01" as MonthKey)).toBe("Nov 2025 – Jan 2026");
		expect(rangeName("year", oct)).toBe("Jan – Oct 2026");
		expect(rangeName("year", "2026-01" as MonthKey)).toBe("January 2026");
		expect(rangeName("all", oct)).toBe("all time");
		expect(monthHeading("2026-09")).toBe("September 2026");
	});

	it("says which months the total is of", () => {
		const at = { filtered: false, current: oct };
		expect(totalLabel(undefined, oct, at)).toBe("Spent in October");
		expect(totalLabel(undefined, oct, { ...at, filtered: true })).toBe("Total for these filters");
		expect(totalLabel("3m", oct, at)).toBe("Spent Aug – Oct 2026");
		expect(totalLabel("year", oct, at)).toBe("Spent Jan – Oct 2026");
		expect(totalLabel("all", oct, at)).toBe("Spent, all time");
		expect(totalLabel("all", "2026-08" as MonthKey, at)).toBe("Spent up to August 2026");
		expect(totalLabel("3m", oct, { ...at, filtered: true })).toBe("These filters, Aug – Oct 2026");
	});
});
