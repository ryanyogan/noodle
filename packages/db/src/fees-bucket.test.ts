import { planForMonth } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addFeesBucket,
	archiveBucket,
	createHouseholdForParent,
	type Db,
	loadPlanRecords,
} from "./index";
import { buckets } from "./schema";
import { testDb } from "./test-db";

// The "Fees and interest" Bucket Review adds on Confirm (issue 137): never a second of that name.

const householdId = "household";
const author = { householdId, memberId: "alex" };
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
});

const fees = (bucketId: string, month: "2026-09" | "2026-10" = "2026-10") =>
	addFeesBucket(db, { ...author, bucketId, month, color: 3 });
const named = async () =>
	(await db.select().from(buckets)).filter((b) => b.name.toLowerCase() === "fees and interest");
const inPlan = async (month: "2026-09" | "2026-10") =>
	planForMonth(await loadPlanRecords(db, householdId, month), month)
		.buckets.filter((b) => b.name.toLowerCase() === "fees and interest")
		.map((b) => [b.id, b.allowance, b.rolling]);

describe("the Fees and interest Bucket", () => {
	it("is added when the Household has none: resets monthly, $0", async () => {
		expect(await fees("new")).toEqual({ bucketId: "new", how: "added" });
		expect(await inPlan("2026-10")).toEqual([["new", 0, false]]);
	});

	it("is added once when the same Confirm is sent again", async () => {
		await fees("new");
		expect(await fees("new")).toEqual({ bucketId: "new", how: "there" });
		expect(await named()).toHaveLength(1);
	});

	it("is the one the Plan already has by that name, whatever its capitals", async () => {
		await addBucket(db, {
			...author,
			bucketId: "theirs",
			name: "Fees and Interest",
			color: 1,
			month: "2026-09",
			allowanceCents: 2_000,
		});
		expect(await fees("new")).toEqual({ bucketId: "theirs", how: "there" });
		expect(await named()).toHaveLength(1);
		expect(await inPlan("2026-10")).toEqual([["theirs", 2_000, false]]);
	});

	it("brings back an archived one instead of adding a second", async () => {
		await fees("old", "2026-09");
		await archiveBucket(db, { ...author, bucketId: "old", month: "2026-10" });
		expect(await inPlan("2026-10")).toEqual([]);
		expect(await fees("new")).toEqual({ bucketId: "old", how: "restored" });
		expect(await named()).toHaveLength(1);
		expect(await inPlan("2026-10")).toEqual([["old", 0, false]]);
	});
});
