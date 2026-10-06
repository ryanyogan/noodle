import { planForMonth } from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addPersonalAllowance,
	createHouseholdForParent,
	type Db,
	loadPlanChanges,
	loadPlanRecords,
	renameBucketGroup,
	reorderBuckets,
	updateBucket,
} from "./index";
import { buckets } from "./schema";
import { exportHouseholdRows, restoreHouseholdRows } from "./snapshots";
import { testDb } from "./test-db";

// Groups of Buckets (issue 98): a name some of a Household's Buckets share.

const householdId = "household";
const month = "2026-10" as const;
const alex = { householdId, memberId: "alex", month };

let db: Db;

const household = (id: string, parentId: string) =>
	createHouseholdForParent(db, {
		clerkUserId: `clerk-${parentId}`,
		householdId: id,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: parentId,
	});

const add = (bucketId: string, name: string, to = { householdId, memberId: "alex" }) =>
	addBucket(db, { ...to, bucketId, name, color: 1, month, allowanceCents: 10_000 });

const groups = async (of = householdId) =>
	Object.fromEntries(
		(await db.select().from(buckets).where(eq(buckets.householdId, of))).map((b) => [
			b.id,
			b.groupName,
		]),
	);

beforeEach(async () => {
	db = testDb();
	await household(householdId, "alex");
	await add("groceries", "Groceries");
	await add("fun", "Fun");
	await add("household", "Household");
});

describe("putting a Bucket in a group", () => {
	it("starts with no group", async () => {
		expect(await groups()).toEqual({ groceries: null, fun: null, household: null });
	});

	it("keeps the name trimmed and cut at 40, and the Plan carries it", async () => {
		await updateBucket(db, { ...alex, bucketId: "groceries", group: "  Home   life " });
		await updateBucket(db, { ...alex, bucketId: "fun", group: "x".repeat(60) });
		expect(await groups()).toEqual({
			groceries: "Home life",
			fun: "x".repeat(40),
			household: null,
		});
		const plan = planForMonth(await loadPlanRecords(db, householdId, month), month);
		expect(plan.buckets.map((b) => b.group)).toEqual(["Home life", "x".repeat(40), undefined]);
	});

	it("takes it out again with null or an empty name", async () => {
		await updateBucket(db, { ...alex, bucketId: "groceries", group: "Home" });
		await updateBucket(db, { ...alex, bucketId: "fun", group: "Home" });
		await updateBucket(db, { ...alex, bucketId: "groceries", group: null });
		await updateBucket(db, { ...alex, bucketId: "fun", group: "   " });
		expect(await groups()).toEqual({ groceries: null, fun: null, household: null });
	});

	it("leaves the group alone when only the name or colour changes, and writes no Plan change", async () => {
		await updateBucket(db, { ...alex, bucketId: "groceries", group: "Home" });
		const history = async () =>
			JSON.stringify(await loadPlanChanges(db, { householdId, memberId: "alex" }, {}));
		const before = await history();
		await updateBucket(db, { ...alex, bucketId: "groceries", color: 3 });
		expect((await groups()).groceries).toBe("Home");
		await updateBucket(db, { ...alex, bucketId: "groceries", group: "Food" });
		expect((await groups()).groceries).toBe("Food");
		expect(await history()).toBe(before);
		expect(before).toContain("groceries");
	});

	it("keeps the Buckets' own order: a group is not a position", async () => {
		await updateBucket(db, { ...alex, bucketId: "household", group: "Home" });
		await updateBucket(db, { ...alex, bucketId: "groceries", group: "Home" });
		await reorderBuckets(db, { householdId, bucketIds: ["fun", "household", "groceries"] });
		const plan = planForMonth(await loadPlanRecords(db, householdId, month), month);
		expect(plan.buckets.map((b) => [b.id, b.group])).toEqual([
			["fun", undefined],
			["household", "Home"],
			["groceries", "Home"],
		]);
	});

	it("gives a Personal Allowance no group", async () => {
		await addPersonalAllowance(db, {
			householdId,
			memberId: "alex",
			bucketId: "mine",
			month,
			name: "Alex's Personal Allowance",
			color: 2,
			allowanceCents: 5_000,
		});
		await updateBucket(db, { ...alex, bucketId: "mine", group: "Home" });
		expect((await groups()).mine).toBeNull();
	});

	it("is not for another Household's Parent", async () => {
		await household("other", "sam");
		await updateBucket(db, {
			householdId: "other",
			memberId: "sam",
			month,
			bucketId: "groceries",
			group: "Theirs",
		});
		expect((await groups()).groceries).toBeNull();
	});
});

describe("renaming a group", () => {
	beforeEach(async () => {
		await updateBucket(db, { ...alex, bucketId: "groceries", group: "Home" });
		await updateBucket(db, { ...alex, bucketId: "household", group: "Home" });
		await household("other", "sam");
		await add("theirs", "Rent", { householdId: "other", memberId: "sam" });
		await updateBucket(db, {
			householdId: "other",
			memberId: "sam",
			month,
			bucketId: "theirs",
			group: "Home",
		});
	});

	it("renames it on every Bucket in it, and on no other Household's", async () => {
		expect(await renameBucketGroup(db, { householdId, from: "Home", to: " House " })).toBe(2);
		expect(await groups()).toEqual({ groceries: "House", fun: null, household: "House" });
		expect(await groups("other")).toEqual({ theirs: "Home" });
	});

	it("takes every Bucket out of it when the new name is empty", async () => {
		expect(await renameBucketGroup(db, { householdId, from: "Home", to: "" })).toBe(2);
		expect(await groups()).toEqual({ groceries: null, fun: null, household: null });
		expect(await groups("other")).toEqual({ theirs: "Home" });
	});

	it("does nothing for a group the Household doesn't have", async () => {
		expect(await renameBucketGroup(db, { householdId, from: "Nope", to: "X" })).toBe(0);
	});
});

describe("a Household snapshot", () => {
	it("carries a Bucket's group out and back", async () => {
		await updateBucket(db, { ...alex, bucketId: "groceries", group: "Home" });
		const file = await exportHouseholdRows(db, householdId);
		expect(file.tables.buckets?.find((b) => b.id === "groceries")?.group_name).toBe("Home");
		await updateBucket(db, { ...alex, bucketId: "groceries", group: null });
		await restoreHouseholdRows(db, householdId, file as never);
		expect((await groups()).groceries).toBe("Home");
	});
});
