import { describe, expect, it } from "vitest";
import {
	type CheckInCard,
	type CheckInStarted,
	type CheckInWaiting,
	checkInCards,
	checkInCount,
	checkInDealtBefore,
	checkInNudgeTime,
	checkInPast,
	checkInStack,
	checkInStarted,
	checkInStep,
	checkInUnstarted,
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

	const stack = checkInStack([], cards);

	it("starts on the first card", () => {
		expect(checkInStep(stack, [])).toEqual({
			kind: "card",
			card: { state: "waiting", kind: "review", card: cards[0] },
			position: 1,
			of: 3,
			last: false,
		});
	});

	it("moves past cards by kind, and ends on the last", () => {
		expect(checkInStep(stack, ["review", "insights"])).toMatchObject({
			card: { kind: "windfalls" },
			position: 3,
			last: true,
		});
	});

	it("keeps a card that was dealt with in its place, counted, as what it started as", () => {
		// The week started with all three; Review has been cleared since.
		const started = cards.map(checkInStarted);
		const sam = { memberId: "sam", name: "Sam" };
		const kept = checkInStack(started, cards.slice(1), { review: [sam] });
		expect(kept.map((card) => [card.kind, card.state])).toEqual([
			["review", "dealt"],
			["insights", "waiting"],
			["windfalls", "waiting"],
		]);
		expect(kept[0]).toEqual({
			state: "dealt",
			kind: "review",
			started: { kind: "review", count: 2 },
			by: [sam],
		});
		// The dealt-with card is still met, and still counted.
		expect(checkInStep(kept, [])).toMatchObject({ card: { state: "dealt" }, position: 1, of: 3 });
		expect(checkInStep(kept, ["review"])).toMatchObject({
			card: { kind: "insights" },
			position: 2,
			of: 3,
		});
	});

	it("ends on a dealt-with card when that is the last", () => {
		const kept = checkInStack(cards.map(checkInStarted), cards.slice(0, 2));
		expect(checkInStep(kept, ["review", "insights"])).toMatchObject({
			card: { state: "dealt", kind: "windfalls", by: [] },
			position: 3,
			last: true,
		});
	});

	it("puts a card that first appears mid-week at the end", () => {
		// The week started with Insights and Extra income; a Transaction reached Review later.
		const started = cards.slice(1).map(checkInStarted);
		expect(checkInStack(started, cards).map((card) => card.kind)).toEqual([
			"insights",
			"windfalls",
			"review",
		]);
		expect(checkInUnstarted(started, cards).map((card) => card.kind)).toEqual(["review"]);
		// Once it has joined, it keeps the place it joined at.
		const joined = [...started, checkInStarted(cards[0] as (typeof cards)[number])];
		expect(checkInStack(joined, cards).map((card) => card.kind)).toEqual([
			"insights",
			"windfalls",
			"review",
		]);
		expect(checkInUnstarted(joined, cards)).toEqual([]);
	});

	it("shows a dealt-with card as waiting again when something new waits on it", () => {
		const started = cards.map(checkInStarted);
		expect(checkInStack(started, cards).every((card) => card.state === "waiting")).toBe(true);
	});

	it("is done once every card is past", () => {
		expect(checkInStep(stack, ["review", "insights", "windfalls"])).toEqual({ kind: "done" });
	});

	it("is done straight away when nothing waits", () => {
		expect(checkInStep([], [])).toEqual({ kind: "done" });
	});
});

describe("a stack met after it was all dealt with", () => {
	const started: CheckInStarted[] = [
		{ kind: "review", count: 3 },
		{ kind: "insights", count: 1, ids: ["a"] },
	];
	const cori = { memberId: "cori", name: "Cori" };

	it("is every line at once when nothing waits and the Parent hasn't passed a card", () => {
		const stack = checkInStack(started, [], { review: [{ ...cori, count: 3 }] });
		expect(checkInDealtBefore(stack, [])?.map((card) => card.kind)).toEqual(["review", "insights"]);
	});

	it("is not for a stack where something waits, one already begun, or a single line", () => {
		const some = checkInStack(started, [{ kind: "review", count: 1 }]);
		expect(checkInDealtBefore(some, [])).toBeNull();
		expect(checkInDealtBefore(checkInStack(started, []), ["review"])).toBeNull();
		expect(checkInDealtBefore(checkInStack(started.slice(0, 1), []), [])).toBeNull();
		expect(checkInDealtBefore([], [])).toBeNull();
	});
});

describe("a card skipped earlier in the week", () => {
	const started: CheckInStarted[] = [
		{ kind: "review", count: 3 },
		{ kind: "insights", count: 1, ids: ["a"] },
	];
	const cards: CheckInCard[] = [
		{ kind: "review", count: 3 },
		{ kind: "insights", titles: ["A"] },
	];

	it("still says so while it waits, and is past: the next card is the one after", () => {
		const stack = checkInStack(started, cards, {}, ["review"]);
		expect(stack[0]).toEqual({ state: "waiting", kind: "review", card: cards[0], skipped: true });
		expect(stack[1]).toEqual({ state: "waiting", kind: "insights", card: cards[1] });
		expect(checkInStep(stack, checkInPast(stack, []))).toMatchObject({ position: 2, of: 2 });
		expect(checkInPast(stack, ["insights"])).toEqual(["insights", "review"]);
	});

	it("says what was done once it's dealt with, skipped or not", () => {
		const stack = checkInStack(started, cards.slice(1), {}, ["review"]);
		expect(stack[0]).toEqual({ state: "dealt", kind: "review", started: started[0], by: [] });
		expect(checkInPast(stack, [])).toEqual([]);
	});
});
