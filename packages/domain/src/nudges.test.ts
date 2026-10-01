import { describe, expect, it } from "vitest";
import {
	bucketsPassingPace,
	type DayKey,
	defaultNudgePreferences,
	isQuietAt,
	type MonthKey,
	minuteOfDayAt,
	monthState,
	nextLocalMinute,
	nudgeDeliveryTime,
	type Plan,
	type Spend,
	wantsNudge,
} from "./index";

const at = (iso: string) => new Date(iso);
const hm = (hours: number, minutes = 0) => hours * 60 + minutes;
const night = { start: hm(22), end: hm(7) };

describe("quiet hours", () => {
	it("reads the local time in the Parent's own time zone", () => {
		expect(minuteOfDayAt(at("2026-09-15T02:30:00Z"), "America/New_York")).toBe(hm(22, 30));
		expect(minuteOfDayAt(at("2026-09-15T02:30:00Z"), "Asia/Kolkata")).toBe(hm(8));
		expect(minuteOfDayAt(at("2026-09-15T00:00:00Z"), "UTC")).toBe(0);
	});

	it("crosses midnight when it starts later than it ends", () => {
		const zone = "America/Chicago";
		expect(isQuietAt(at("2026-09-15T03:00:00Z"), night, zone)).toBe(true); // 22:00
		expect(isQuietAt(at("2026-09-15T08:00:00Z"), night, zone)).toBe(true); // 03:00
		expect(isQuietAt(at("2026-09-15T12:00:00Z"), night, zone)).toBe(false); // 07:00, the end
		expect(isQuietAt(at("2026-09-15T02:59:00Z"), night, zone)).toBe(false); // 21:59
	});

	it("can sit inside one day, or be off", () => {
		const nap = { start: hm(13), end: hm(15) };
		expect(isQuietAt(at("2026-09-15T18:30:00Z"), nap, "America/Chicago")).toBe(true);
		expect(isQuietAt(at("2026-09-15T21:00:00Z"), nap, "America/Chicago")).toBe(false);
		expect(isQuietAt(at("2026-09-15T18:30:00Z"), null, "America/Chicago")).toBe(false);
		expect(isQuietAt(at("2026-09-15T18:30:00Z"), { start: 600, end: 600 }, "UTC")).toBe(false);
	});

	it("delivers at once outside quiet hours", () => {
		const now = at("2026-09-15T17:00:00Z");
		expect(nudgeDeliveryTime(now, night, "America/New_York")).toEqual(now);
		expect(nudgeDeliveryTime(now, null, "America/New_York")).toEqual(now);
	});

	it("holds a Nudge until quiet hours end, the same night or the next morning", () => {
		// 23:30 in New York: 07:00 tomorrow.
		expect(nudgeDeliveryTime(at("2026-09-15T03:30:00Z"), night, "America/New_York")).toEqual(
			at("2026-09-15T11:00:00Z"),
		);
		// 06:00: 07:00 the same morning.
		expect(nudgeDeliveryTime(at("2026-09-15T10:00:00Z"), night, "America/New_York")).toEqual(
			at("2026-09-15T11:00:00Z"),
		);
	});

	it("uses each Parent's own zone, including half-hour offsets", () => {
		// 23:00 in Kolkata (UTC+5:30) is 17:30 UTC; quiet ends at 07:00 there, 01:30 UTC.
		expect(nudgeDeliveryTime(at("2026-09-15T17:30:00Z"), night, "Asia/Kolkata")).toEqual(
			at("2026-09-16T01:30:00Z"),
		);
		// The same instant is 13:30 in New York, so that Parent gets it now.
		expect(isQuietAt(at("2026-09-15T17:30:00Z"), night, "America/New_York")).toBe(false);
	});

	it("ends on the local wall-clock time across a daylight saving change", () => {
		// Clocks fall back at 02:00 on Nov 1, 2026: 07:00 that morning is EST (UTC−5).
		expect(nudgeDeliveryTime(at("2026-11-01T02:00:00Z"), night, "America/New_York")).toEqual(
			at("2026-11-01T12:00:00Z"),
		);
		// Clocks spring forward at 02:00 on Mar 8, 2026: 07:00 that morning is EDT (UTC−4).
		expect(nudgeDeliveryTime(at("2026-03-08T04:00:00Z"), night, "America/New_York")).toEqual(
			at("2026-03-08T11:00:00Z"),
		);
	});

	it("lands after a skipped local time rather than before it", () => {
		// 02:30 doesn't happen on Mar 8, 2026 in New York; 03:30 EDT is the first time past it.
		const next = nextLocalMinute(at("2026-03-08T04:00:00Z"), hm(2, 30), "America/New_York");
		expect(next).toEqual(at("2026-03-08T07:30:00Z"));
	});

	it("is always later than the moment it starts from", () => {
		const now = at("2026-09-15T11:00:00Z"); // exactly 07:00 in New York
		expect(nextLocalMinute(now, hm(7), "America/New_York")).toEqual(at("2026-09-16T11:00:00Z"));
	});
});

describe("preferences", () => {
	it("defaults to Pace and Extra income, not the other Parent's Quick Adds, quiet overnight", () => {
		const preferences = defaultNudgePreferences("America/Chicago");
		expect(wantsNudge(preferences, "bucket-pace")).toBe(true);
		expect(wantsNudge(preferences, "windfall")).toBe(true);
		expect(wantsNudge(preferences, "quick-add")).toBe(false);
		expect(preferences.quietHours).toEqual({ start: hm(21), end: hm(7) });
		expect(preferences.timeZone).toBe("America/Chicago");
	});

	it("always lets a test through", () => {
		const none = {
			...defaultNudgePreferences("UTC"),
			bucketPace: false,
			windfalls: false,
		};
		expect(wantsNudge(none, "bucket-pace")).toBe(false);
		expect(wantsNudge(none, "test")).toBe(true);
	});
});

describe("bucketsPassingPace", () => {
	const plan = (month: MonthKey): Plan => ({
		month,
		baseline: 500_000,
		commitments: [],
		buckets: [
			{ id: "groceries", name: "Groceries", color: 1, allowance: 120_000, rolling: false },
			{ id: "hockey", name: "Hockey", color: 2, allowance: 30_000, rolling: false },
			{ id: "gifts", name: "Gifts", color: 3, allowance: 0, rolling: false },
		],
	});
	const spend = (bucketId: string, amount: number, date: DayKey): Spend => ({
		bucketId,
		amount,
		date,
	});
	const stateOn = (asOf: DayKey, spending: Spend[]) =>
		monthState({ plan: plan("2026-09"), spending, asOf });
	const ids = (buckets: { id: string }[]) => buckets.map((bucket) => bucket.id);

	it("nudges about a Bucket that just got ahead of Pace", () => {
		// Sep 10 of 30: Pace for Groceries is $400.
		const state = stateOn("2026-09-10", [spend("groceries", 60_000, "2026-09-09")]);
		const check = bucketsPassingPace(state, []);
		expect(ids(check.nudge)).toEqual(["groceries"]);
		expect(check.pastPace).toEqual(["groceries"]);
	});

	it("counts going over the allowance as passing Pace", () => {
		const state = stateOn("2026-09-10", [spend("hockey", 31_000, "2026-09-02")]);
		expect(ids(bucketsPassingPace(state, []).nudge)).toEqual(["hockey"]);
	});

	it("nudges once per crossing", () => {
		const state = stateOn("2026-09-12", [spend("groceries", 60_000, "2026-09-09")]);
		const check = bucketsPassingPace(state, ["groceries"]);
		expect(check.nudge).toEqual([]);
		expect(check.pastPace).toEqual(["groceries"]);
	});

	it("nudges again after the Bucket was found back on Pace", () => {
		const backOnPace = bucketsPassingPace(
			stateOn("2026-09-20", [spend("groceries", 60_000, "2026-09-09")]),
			["groceries"],
		);
		expect(backOnPace.pastPace).toEqual([]);
		const again = bucketsPassingPace(
			stateOn("2026-09-21", [
				spend("groceries", 60_000, "2026-09-09"),
				spend("groceries", 30_000, "2026-09-21"),
			]),
			backOnPace.pastPace,
		);
		expect(ids(again.nudge)).toEqual(["groceries"]);
	});

	it("stays quiet with too little of the month left, but remembers the crossing", () => {
		// Sep 24 of 30 leaves 6 days.
		const state = stateOn("2026-09-24", [spend("groceries", 119_000, "2026-09-24")]);
		const check = bucketsPassingPace(state, []);
		expect(check.nudge).toEqual([]);
		expect(check.pastPace).toEqual(["groceries"]);
		// Sep 23 leaves 7, which is still enough.
		const earlier = stateOn("2026-09-23", [spend("groceries", 119_000, "2026-09-23")]);
		expect(ids(bucketsPassingPace(earlier, []).nudge)).toEqual(["groceries"]);
	});

	it("ignores a Bucket with no allowance", () => {
		const state = stateOn("2026-09-10", [spend("gifts", 2_000, "2026-09-09")]);
		expect(bucketsPassingPace(state, []).nudge).toEqual([]);
	});
});
