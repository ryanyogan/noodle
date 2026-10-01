import { describe, expect, it } from "vitest";
import {
	type CheckInCard,
	type CheckInWaiting,
	checkInCards,
	checkInCount,
	checkInNudgeTime,
	checkInStep,
	checkInWeek,
	type DayKey,
	defaultNudgePreferences,
	isCheckInDay,
	isWeekday,
	type MonthKey,
	wantsNudge,
	weekdayOf,
} from "./index";

const day = (key: string) => key as DayKey;
const month = (key: string) => key as MonthKey;

const nothing: CheckInWaiting = { review: 0, insights: [], monthClose: null, windfalls: [] };

describe("the Check-in's week", () => {
	it("reads the day of the week of a calendar day", () => {
		expect(weekdayOf(day("2026-09-27"))).toBe(0); // a Sunday
		expect(weekdayOf(day("2026-10-03"))).toBe(6);
	});

	it("is named by the Check-in day that starts it", () => {
		// Sunday Check-ins: Sunday the 27th through Saturday October 3rd are one week.
		expect(checkInWeek(day("2026-09-27"), 0)).toBe("2026-09-27");
		expect(checkInWeek(day("2026-09-29"), 0)).toBe("2026-09-27");
		expect(checkInWeek(day("2026-10-03"), 0)).toBe("2026-09-27");
		expect(checkInWeek(day("2026-10-04"), 0)).toBe("2026-10-04");
	});

	it("reaches back across a month and a year", () => {
		// Wednesday Check-ins; January 2nd 2026 is a Friday.
		expect(checkInWeek(day("2026-01-02"), 3)).toBe("2025-12-31");
		expect(checkInWeek(day("2026-10-01"), 1)).toBe("2026-09-28");
	});

	it("knows the Check-in day itself", () => {
		expect(isCheckInDay(day("2026-09-27"), 0)).toBe(true);
		expect(isCheckInDay(day("2026-09-28"), 0)).toBe(false);
	});

	it("accepts only the seven days", () => {
		expect([0, 6].every(isWeekday)).toBe(true);
		expect([-1, 7, 1.5].some(isWeekday)).toBe(false);
	});
});

describe("the Check-in Nudge", () => {
	it("lands at 9 AM on the Check-in day in the Household's time zone", () => {
		// The nightly run at 09:00 UTC is 5 AM in New York.
		expect(checkInNudgeTime(new Date("2026-09-27T09:00:00Z"), "America/New_York")).toEqual(
			new Date("2026-09-27T13:00:00Z"),
		);
	});

	it("lands at once when 9 AM has passed", () => {
		const now = new Date("2026-09-27T09:00:00Z");
		expect(checkInNudgeTime(now, "Europe/Berlin")).toEqual(now);
	});

	it("is always wanted", () => {
		const preferences = { ...defaultNudgePreferences("UTC"), windfalls: false, bucketPace: false };
		expect(wantsNudge(preferences, "check-in")).toBe(true);
	});
});

describe("the Check-in's cards", () => {
	const everything: CheckInWaiting = {
		review: 3,
		insights: ["Disney+ and Hulu overlap"],
		monthClose: {
			month: month("2026-08"),
			leftovers: [
				{ bucketId: "g", name: "Groceries", amount: 4_000 },
				{ bucketId: "e", name: "Eating out", amount: 1_500 },
			],
			windfall: 0,
		},
		windfalls: [
			{ month: month("2026-09"), amount: 20_000 },
			{ month: month("2026-08"), amount: 5_000 },
		],
	};

	it("come in order: Review, Insights, Sweeps, Extra income", () => {
		const cards = checkInCards(everything);
		expect(cards.map((card) => card.kind)).toEqual(["review", "insights", "sweeps", "windfalls"]);
		expect(cards[2]).toMatchObject({ month: "2026-08", total: 5_500 });
		expect(cards[3]).toMatchObject({
			total: 25_000,
			windfalls: [{ month: "2026-08" }, { month: "2026-09" }],
		});
		expect(checkInCount(cards)).toBe(3 + 1 + 2 + 2);
	});

	it("leave out what's empty", () => {
		const cards = checkInCards({
			...nothing,
			insights: ["A price went up"],
			// A month closing with only Extra income has nothing to Sweep.
			monthClose: { month: month("2026-08"), leftovers: [], windfall: 5_000 },
			windfalls: [{ month: month("2026-09"), amount: 0 }],
		});
		expect(cards.map((card) => card.kind)).toEqual(["insights"]);
	});

	it("are none in a quiet week", () => {
		expect(checkInCards(nothing)).toEqual([]);
		expect(checkInCount([])).toBe(0);
	});
});

describe("stepping through the Check-in", () => {
	const cards: CheckInCard[] = [
		{ kind: "review", count: 2 },
		{ kind: "insights", titles: ["A price went up"] },
		{ kind: "windfalls", windfalls: [{ month: month("2026-09"), amount: 100 }], total: 100 },
	];

	it("starts on the first card", () => {
		expect(checkInStep(cards, [])).toEqual({
			kind: "card",
			card: cards[0],
			position: 1,
			of: 3,
			last: false,
		});
	});

	it("moves past cards by kind, and ends on the last", () => {
		expect(checkInStep(cards, ["review", "insights"])).toMatchObject({
			card: { kind: "windfalls" },
			position: 3,
			last: true,
		});
	});

	it("keeps its place when a card empties meanwhile", () => {
		// Past Review; then the other Parent clears it, so the stack loses its first card.
		expect(checkInStep(cards.slice(1), ["review"])).toMatchObject({
			card: { kind: "insights" },
			position: 1,
			of: 2,
		});
	});

	it("is done once every card is past", () => {
		expect(checkInStep(cards, ["review", "insights", "windfalls"])).toEqual({ kind: "done" });
	});

	it("is done straight away when nothing waits", () => {
		expect(checkInStep([], [])).toEqual({ kind: "done" });
	});
});
