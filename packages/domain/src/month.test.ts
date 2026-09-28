import { describe, expect, it } from "vitest";
import { monthKeyAt } from "./month";

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
