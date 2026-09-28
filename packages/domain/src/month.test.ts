import { describe, expect, it } from "vitest";
import { dayKeyAt, daysInMonth, lastDayOf, type MonthKey, monthKeyAt } from "./index";

describe("monthKeyAt: the Household's current month in its own time zone", () => {
	it.each([
		// The evening of Oct 31 in Chicago is already Nov 1 in UTC.
		["2026-11-01T02:30:00Z", "America/Chicago", "2026-10"],
		["2026-11-01T02:30:00Z", "UTC", "2026-11"],
		// New Year's Eve in Los Angeles.
		["2027-01-01T07:59:59Z", "America/Los_Angeles", "2026-12"],
		["2027-01-01T08:00:00Z", "America/Los_Angeles", "2027-01"],
		// Leap day.
		["2028-02-29T12:00:00Z", "America/New_York", "2028-02"],
	])("%s in %s is %s", (instant, timeZone, expected) => {
		expect(monthKeyAt(new Date(instant), timeZone)).toBe(expected);
	});
});

describe("dayKeyAt: the Household's current day in its own time zone", () => {
	it.each([
		["2026-11-01T02:30:00Z", "America/Chicago", "2026-10-31"],
		["2026-11-01T02:30:00Z", "UTC", "2026-11-01"],
		["2028-02-29T23:59:59Z", "UTC", "2028-02-29"],
	])("%s in %s is %s", (instant, timeZone, expected) => {
		expect(dayKeyAt(new Date(instant), timeZone)).toBe(expected);
	});
});

describe("daysInMonth and lastDayOf", () => {
	it.each([
		["2026-01", 31, "2026-01-31"],
		["2026-02", 28, "2026-02-28"],
		["2028-02", 29, "2028-02-29"],
		["2100-02", 28, "2100-02-28"], // divisible by 100, not 400
		["2000-02", 29, "2000-02-29"], // divisible by 400
		["2026-04", 30, "2026-04-30"],
		["2026-12", 31, "2026-12-31"],
	] as const)("%s has %i days, ending %s", (month, days, last) => {
		expect(daysInMonth(month as MonthKey)).toBe(days);
		expect(lastDayOf(month as MonthKey)).toBe(last);
	});
});
