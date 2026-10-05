import { type DayKey, dayKeyAt } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import {
	BANK_HISTORY_CHOICES,
	BANK_HISTORY_OPTIONS,
	bankHistorySchema,
	bankHistorySpan,
	withinBankHistory,
} from "./bank-history";

const day = (key: string) => key as DayKey;

describe("bankHistorySpan", () => {
	it("this month only runs from the 1st through today", () => {
		expect(bankHistorySpan("month", day("2026-10-05"))).toEqual({ days: 5, start: "2026-10-01" });
		expect(bankHistorySpan("month", day("2026-12-31"))).toEqual({ days: 31, start: "2026-12-01" });
	});

	it("on the 1st it's one day, never none", () => {
		expect(bankHistorySpan("month", day("2026-11-01"))).toEqual({ days: 1, start: "2026-11-01" });
	});

	it("counts the month in the Household's time zone, not the server's", () => {
		// 03:30 UTC on 1 November is still 31 October in Chicago.
		const now = new Date("2026-11-01T03:30:00Z");
		expect(bankHistorySpan("month", dayKeyAt(now, "America/Chicago"))).toEqual({
			days: 31,
			start: "2026-10-01",
		});
		expect(bankHistorySpan("month", dayKeyAt(now, "UTC"))).toEqual({
			days: 1,
			start: "2026-11-01",
		});
		// And already 2 November in Auckland.
		expect(bankHistorySpan("month", dayKeyAt(now, "Pacific/Auckland")).start).toBe("2026-11-01");
	});

	it("the last so many days start that many calendar days back", () => {
		expect(bankHistorySpan("30", day("2026-10-05"))).toEqual({ days: 30, start: "2026-09-05" });
		expect(bankHistorySpan("60", day("2026-10-05"))).toEqual({ days: 60, start: "2026-08-06" });
		expect(bankHistorySpan("90", day("2026-10-05"))).toEqual({ days: 90, start: "2026-07-07" });
		expect(bankHistorySpan("120", day("2026-10-05"))).toEqual({ days: 120, start: "2026-06-07" });
		expect(bankHistorySpan("365", day("2026-10-05"))).toEqual({ days: 365, start: "2025-10-05" });
	});

	it("isn't moved by a leap day or a clock change", () => {
		// February has 29 days in 2028, 28 in 2027.
		expect(bankHistorySpan("30", day("2028-03-01")).start).toBe("2028-01-31");
		expect(bankHistorySpan("30", day("2027-03-01")).start).toBe("2027-01-30");
		expect(bankHistorySpan("365", day("2028-03-01")).start).toBe("2027-03-02");
		expect(bankHistorySpan("month", day("2028-02-29"))).toEqual({ days: 29, start: "2028-02-01" });
		// Across the US clock changes (8 March and 1 November 2026).
		expect(bankHistorySpan("30", day("2026-03-09")).start).toBe("2026-02-07");
		expect(bankHistorySpan("30", day("2026-11-02")).start).toBe("2026-10-03");
	});

	it("every choice asks Plaid for a span it takes (1 to 730 days)", () => {
		for (const choice of BANK_HISTORY_CHOICES) {
			for (const today of ["2026-01-01", "2026-03-31", "2028-02-29"]) {
				const { days } = bankHistorySpan(choice, day(today));
				expect(Number.isInteger(days)).toBe(true);
				expect(days).toBeGreaterThanOrEqual(1);
				expect(days).toBeLessThanOrEqual(730);
			}
		}
	});
});

describe("the choices", () => {
	it("are offered in order, this month first and recommended", () => {
		expect(BANK_HISTORY_OPTIONS.map((option) => option.value)).toEqual([...BANK_HISTORY_CHOICES]);
		expect(BANK_HISTORY_OPTIONS.map((option) => option.label)).toEqual([
			"This month only",
			"Last 30 days",
			"Last 60 days",
			"Last 90 days",
			"Last 120 days",
			"Last 365 days (a year)",
		]);
		expect(BANK_HISTORY_OPTIONS[0]?.description).toMatch(/^Recommended\./);
	});

	it("the server takes only those, and this month only when none is said", () => {
		expect(bankHistorySchema.parse(undefined)).toBe("month");
		expect(bankHistorySchema.parse("90")).toBe("90");
		for (const refused of ["45", "730", "", "all", 90, null]) {
			expect(bankHistorySchema.safeParse(refused).success).toBe(false);
		}
	});
});

describe("withinBankHistory", () => {
	it("keeps the start day and after, and everything when there's no start", () => {
		expect(withinBankHistory(day("2026-10-01"), "2026-10-01")).toBe(true);
		expect(withinBankHistory(day("2026-10-02"), "2026-10-01")).toBe(true);
		expect(withinBankHistory(day("2026-09-30"), "2026-10-01")).toBe(false);
		expect(withinBankHistory(day("2019-01-01"), null)).toBe(true);
	});
});
