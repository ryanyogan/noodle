import type { DayKey } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	completeCheckIn,
	createHouseholdForParent,
	type Db,
	listCheckInHouseholds,
	loadCheckIns,
	setCheckInDay,
} from "./index";
import { members } from "./schema";
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
