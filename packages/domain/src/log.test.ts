import { describe, expect, it } from "vitest";
import { compareLogNames, logItemOfEvent, logWhen } from "./log";

describe("logWhen", () => {
	const now = Date.UTC(2026, 9, 7, 12);
	it("says the day and the time of day in the Household's time zone", () => {
		// 20:42 UTC on Oct 6 is 3:42 PM in Chicago (CDT).
		expect(logWhen(Date.UTC(2026, 9, 6, 20, 42), "America/Chicago", now)).toBe("Oct 6, 3:42 PM");
		// Early UTC morning is still the evening before there.
		expect(logWhen(Date.UTC(2026, 9, 6, 4, 5), "America/Chicago", now)).toBe("Oct 5, 11:05 PM");
		expect(logWhen(Date.UTC(2026, 9, 6, 5, 0), "America/Chicago", now)).toBe("Oct 6, 12:00 AM");
		expect(logWhen(Date.UTC(2026, 9, 6, 17, 0), "America/Chicago", now)).toBe("Oct 6, 12:00 PM");
	});
	it("tells two changes on one day apart, and adds the year when it isn't this one", () => {
		const a = logWhen(Date.UTC(2026, 9, 6, 14, 1), "America/New_York", now);
		const b = logWhen(Date.UTC(2026, 9, 6, 14, 2), "America/New_York", now);
		expect([a, b]).toEqual(["Oct 6, 10:01 AM", "Oct 6, 10:02 AM"]);
		expect(logWhen(Date.UTC(2025, 11, 31, 23, 30), "America/Chicago", now)).toBe(
			"Dec 31, 2025, 5:30 PM",
		);
	});
});

describe("compareLogNames", () => {
	it("orders names by code point, as SQLite orders text: accents after Z, emoji last", () => {
		const names = ["😀 Sam", "ﬁona", "Zoë", "Émile", "Alex", "", "alex", "Zoe"];
		expect([...names].sort(compareLogNames)).toEqual([
			"",
			"Alex",
			"Zoe",
			"Zoë",
			"alex",
			"Émile",
			"ﬁona",
			"😀 Sam",
		]);
		// JavaScript's own order has the emoji before "ﬁ": the difference this exists for.
		expect("😀 Sam" < "ﬁona").toBe(true);
		expect(compareLogNames("😀 Sam", "ﬁona")).toBe(1);
		expect(compareLogNames("Sam", "Sam")).toBe(0);
		expect(compareLogNames("Sam", "Samantha")).toBe(-1);
	});
});

describe("logItemOfEvent", () => {
	it("names the kind of item each of the Log's own records is about", () => {
		expect(logItemOfEvent("rule-removed")).toBe("rule");
		expect(logItemOfEvent("money-in-rule-made")).toBe("rule");
		expect(logItemOfEvent("card-payment-rule-removed")).toBe("rule");
		expect(logItemOfEvent("bank-connection-disconnected")).toBe("bank-connection");
		expect(logItemOfEvent("account-archived")).toBe("account");
	});
});
