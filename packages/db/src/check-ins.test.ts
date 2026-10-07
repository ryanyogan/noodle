import type { CheckInStarted, DayKey, MonthKey } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	completeCheckIn,
	createHouseholdForParent,
	type Db,
	listCheckInHouseholds,
	loadCheckInDoers,
	loadCheckInStack,
	loadCheckIns,
	setCheckInDay,
	startCheckInStack,
} from "./index";
import { insights, members, monthCloses, moves } from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const week = "2026-09-27" as DayKey;

let db: Db;

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await db.insert(members).values([
		{ id: "sam", householdId, kind: "parent", name: "Sam", clerkUserId: "clerk-sam" },
		{ id: "maya", householdId, kind: "child", name: "Maya", color: 2 },
	]);
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-other",
		householdId: "other",
		householdName: "Next door",
		timeZone: "UTC",
		parentId: "other-parent",
		parentName: "Pat",
	});
});

describe("the Check-in day", () => {
	it("is Sunday until the Parents choose", async () => {
		const [household] = (await listCheckInHouseholds(db)).filter((h) => h.id === householdId);
		expect(household).toEqual({ id: householdId, timeZone: "America/Chicago", checkInDay: 0 });
	});

	it("is chosen for one Household only", async () => {
		await setCheckInDay(db, householdId, 3);
		const days = Object.fromEntries(
			(await listCheckInHouseholds(db)).map((h) => [h.id, h.checkInDay]),
		);
		expect(days).toEqual({ [householdId]: 3, other: 0 });
	});
});

describe("finishing a Check-in", () => {
	it("shows every Parent, and who has finished this week's", async () => {
		expect(await completeCheckIn(db, { householdId, memberId: "sam", week })).toBe(true);
		const parents = await loadCheckIns(db, householdId, week);
		expect(parents.map((p) => [p.name, p.completedAt !== null])).toEqual([
			["Alex", false],
			["Sam", true],
		]);
	});

	it("counts only for its week", async () => {
		await completeCheckIn(db, { householdId, memberId: "sam", week });
		const next = await loadCheckIns(db, householdId, "2026-10-04" as DayKey);
		expect(next.every((p) => p.completedAt === null)).toBe(true);
	});

	it("keeps the first time when finished again", async () => {
		await completeCheckIn(db, { householdId, memberId: "alex", week });
		const [first] = await loadCheckIns(db, householdId, week);
		expect(await completeCheckIn(db, { householdId, memberId: "alex", week })).toBe(false);
		const [again] = await loadCheckIns(db, householdId, week);
		expect(again?.completedAt).toEqual(first?.completedAt);
	});

	it("is refused for a Child or a Parent of another Household", async () => {
		expect(await completeCheckIn(db, { householdId, memberId: "maya", week })).toBe(false);
		expect(await completeCheckIn(db, { householdId, memberId: "other-parent", week })).toBe(false);
		expect(await loadCheckIns(db, "other", week)).toEqual([
			{ memberId: "other-parent", name: "Pat", completedAt: null },
		]);
	});
});

describe("the week's stack", () => {
	const september = "2026-09" as MonthKey;
	const review: CheckInStarted = { kind: "review", count: 3 };
	const sweeps: CheckInStarted = { kind: "sweeps", month: september, total: 5500 };
	const extra: CheckInStarted = { kind: "windfalls", months: [september], total: 25000 };
	const monday = new Date("2026-09-28T15:00:00Z");
	const wednesday = new Date("2026-09-30T15:00:00Z");
	const alex = { householdId, memberId: "alex" };
	const sam = { householdId, memberId: "sam" };

	it("is empty until it's started, and reading it starts nothing", async () => {
		expect(await loadCheckInStack(db, alex, week)).toEqual([]);
		expect(await loadCheckInStack(db, alex, week)).toEqual([]);
	});

	it("keeps what each card started as, in the stack's order", async () => {
		const added = await startCheckInStack(db, {
			...alex,
			week,
			cards: [sweeps, review],
			now: monday,
		});
		expect(added).toBe(2);
		expect(await loadCheckInStack(db, alex, week)).toEqual([
			{ ...review, startedAt: monday },
			{ ...sweeps, startedAt: monday },
		]);
	});

	it("keeps the first start: starting again changes nothing a card started as", async () => {
		await startCheckInStack(db, { ...alex, week, cards: [review], now: monday });
		const again = await startCheckInStack(db, {
			...alex,
			week,
			cards: [{ kind: "review", count: 9 }],
			now: wednesday,
		});
		expect(again).toBe(0);
		expect(await loadCheckInStack(db, alex, week)).toEqual([{ ...review, startedAt: monday }]);
	});

	it("puts a card that first appears mid-week at the end", async () => {
		await startCheckInStack(db, { ...alex, week, cards: [sweeps, extra], now: monday });
		await startCheckInStack(db, { ...alex, week, cards: [review, sweeps], now: wednesday });
		expect((await loadCheckInStack(db, alex, week)).map((card) => card.kind)).toEqual([
			"sweeps",
			"windfalls",
			"review",
		]);
	});

	it("puts a card at the end of each Parent's own stack, whatever day it joined for the other", async () => {
		const thursday = new Date(wednesday.getTime() + 24 * 60 * 60 * 1000);
		// Review waits for Alex from Monday. Sam's stack starts on Wednesday with other cards.
		await startCheckInStack(db, { ...alex, week, cards: [review], now: monday });
		await startCheckInStack(db, { ...sam, week, cards: [sweeps, extra], now: wednesday });
		// On Thursday something lands in Review for Sam: after the cards Sam has already passed,
		// not ahead of them because Alex's Review card is older.
		await startCheckInStack(db, { ...sam, week, cards: [review], now: thursday });
		expect((await loadCheckInStack(db, sam, week)).map((card) => card.kind)).toEqual([
			"sweeps",
			"windfalls",
			"review",
		]);
		// And Alex, whose Sweeps card joins on Wednesday, meets it after Review.
		await startCheckInStack(db, { ...alex, week, cards: [sweeps], now: wednesday });
		expect(await loadCheckInStack(db, alex, week)).toEqual([
			{ ...review, startedAt: monday },
			{ ...sweeps, startedAt: wednesday },
		]);
	});

	it("starts every card of a stack in one write", async () => {
		let batches = 0;
		const counting = new Proxy(db, {
			get(target, key, receiver) {
				if (key === "batch") batches++;
				const value = Reflect.get(target, key, receiver);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		expect(
			await startCheckInStack(counting, {
				...alex,
				week,
				cards: [review, sweeps, extra],
				now: monday,
			}),
		).toBe(3);
		expect(batches).toBe(1);
		expect(await startCheckInStack(counting, { ...alex, week, cards: [], now: monday })).toBe(0);
	});

	it("is one week's, one Household's, and only a Parent's", async () => {
		await startCheckInStack(db, { ...alex, week, cards: [review], now: monday });
		expect(await loadCheckInStack(db, alex, "2026-10-04" as DayKey)).toEqual([]);
		expect(
			await loadCheckInStack(db, { householdId: "other", memberId: "other-parent" }, week),
		).toEqual([]);
		const child = { householdId, memberId: "maya", week, cards: [review], now: monday };
		expect(await startCheckInStack(db, child)).toBe(0);
		const stranger = { householdId, memberId: "other-parent", week, cards: [review], now: monday };
		expect(await startCheckInStack(db, stranger)).toBe(0);
	});

	describe("who dealt with a card", () => {
		it("is whoever closed the month, for Sweeps; nobody when it closed by itself", async () => {
			await db.insert(monthCloses).values({
				id: "close",
				householdId,
				month: september,
				decidedByMemberId: "sam",
			});
			expect(await loadCheckInDoers(db, alex, [{ ...sweeps, startedAt: monday }])).toEqual({
				sweeps: ["sam"],
			});
			await db.update(monthCloses).set({ decidedByMemberId: null });
			expect(await loadCheckInDoers(db, alex, [{ ...sweeps, startedAt: monday }])).toEqual({});
		});

		it("is whoever decided the Extra income since the card joined", async () => {
			const move = { householdId, kind: "windfall" as const, month: september, amountCents: 100 };
			await db.insert(moves).values([
				// Before the week's stack: not this card's doing.
				{ ...move, id: "old", createdByMemberId: "alex", createdAt: new Date("2026-09-20") },
				{ ...move, id: "new", createdByMemberId: "sam", createdAt: wednesday },
				{ ...move, id: "cover", kind: "cover", createdByMemberId: "alex", createdAt: wednesday },
			]);
			expect(await loadCheckInDoers(db, alex, [{ ...extra, startedAt: monday }])).toEqual({
				windfalls: ["sam"],
			});
		});

		it("counts Extra income decided in the very second the card joined", async () => {
			// A decision is timed by the database in whole seconds; the card's start is to the
			// millisecond. One made later in the start's own second must still count.
			const joined = new Date(monday.getTime() + 640);
			await db.insert(moves).values({
				id: "same-second",
				householdId,
				kind: "windfall",
				month: september,
				amountCents: 100,
				createdByMemberId: "alex",
				createdAt: monday,
			});
			expect(await loadCheckInDoers(db, alex, [{ ...extra, startedAt: joined }])).toEqual({
				windfalls: ["alex"],
			});
		});

		it("is whoever decided the card's Insights, never by way of one the reader can't see", async () => {
			const insight = {
				householdId,
				kind: "price-increase" as const,
				body: "",
				yearlyImpactCents: 0,
				transactionIds: [],
				commitmentIds: [],
			};
			await db.insert(insights).values([
				{
					...insight,
					id: "a",
					title: "A",
					fingerprint: "a",
					status: "accepted",
					decidedByMemberId: "sam",
				},
				{
					...insight,
					id: "b",
					title: "B",
					fingerprint: "b",
					status: "dismissed",
					decidedByMemberId: "alex",
				},
				{ ...insight, id: "c", title: "C", fingerprint: "c" },
				// Sam's own: Alex never reads it, even handed its ID.
				{
					...insight,
					id: "d",
					title: "D",
					fingerprint: "d",
					status: "accepted",
					decidedByMemberId: "sam",
					ownerMemberId: "sam",
				},
			]);
			const card = (ids: string[]) => [
				{ kind: "insights" as const, count: ids.length, ids, startedAt: monday },
			];
			expect(await loadCheckInDoers(db, alex, card(["a", "b", "c"]))).toEqual({
				insights: ["alex", "sam"],
			});
			expect(await loadCheckInDoers(db, alex, card(["d"]))).toEqual({});
			expect(await loadCheckInDoers(db, alex, [{ ...review, startedAt: monday }])).toEqual({});
		});
	});
});
