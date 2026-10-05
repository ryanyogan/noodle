import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addPersonalAllowance,
	bucketDeleteBlockers,
	createHouseholdForParent,
	type Db,
	deleteBucket,
	loadPlanChanges,
	setCarriesOver,
} from "./index";
import {
	bucketAllowances,
	bucketRolling,
	buckets,
	categorizations,
	moves,
	rules,
	splits,
	transactions,
} from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const thisMonth = "2026-10";
const alex = { householdId, memberId: "alex" };
const fun = { householdId, bucketId: "fun", thisMonth } as const;

let db: Db;

const bucketIds = async () => (await db.select({ id: buckets.id }).from(buckets)).map((b) => b.id);

const transaction = (id: string, bucketId: string | null) =>
	db.insert(transactions).values({
		id,
		householdId,
		source: "quick-add",
		date: "2026-10-03",
		amountCents: 1_200,
		bucketId,
	});

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
	await addBucket(db, {
		...alex,
		bucketId: "fun",
		name: "Fun",
		color: 1,
		month: thisMonth,
		allowanceCents: 30_000,
	});
	await addBucket(db, {
		...alex,
		bucketId: "groceries",
		name: "Groceries",
		color: 2,
		month: "2026-09",
		allowanceCents: 120_000,
	});
});

describe("deleting a Bucket (issue 98)", () => {
	it("deletes one nothing points at, with its allowances, carries over and Plan changes", async () => {
		await setCarriesOver(db, { ...alex, bucketId: "fun", month: thisMonth, rolling: true });
		expect(await bucketDeleteBlockers(db, fun)).toEqual([]);

		expect(await deleteBucket(db, fun)).toEqual({ deleted: true, blockers: [] });

		expect(await bucketIds()).toEqual(["groceries"]);
		expect(
			await db.select().from(bucketAllowances).where(eq(bucketAllowances.bucketId, "fun")),
		).toEqual([]);
		expect(await db.select().from(bucketRolling).where(eq(bucketRolling.bucketId, "fun"))).toEqual(
			[],
		);
		const { changes } = await loadPlanChanges(db, alex, {});
		expect(changes.filter((change) => change.targetId === "fun")).toEqual([]);
		expect(changes.some((change) => change.targetId === "groceries")).toBe(true);
	});

	it("keeps one with a Transaction filed in it", async () => {
		await transaction("t1", "fun");
		expect(await deleteBucket(db, fun)).toEqual({ deleted: false, blockers: ["spending"] });
		expect(await bucketIds()).toContain("fun");
		expect(
			await db.select().from(bucketAllowances).where(eq(bucketAllowances.bucketId, "fun")),
		).toHaveLength(1);
	});

	it("keeps one a Split is filed in", async () => {
		await transaction("t1", null);
		await db.insert(splits).values({
			id: "s1",
			householdId,
			transactionId: "t1",
			position: 1,
			amountCents: 600,
			bucketId: "fun",
		});
		expect((await deleteBucket(db, fun)).blockers).toEqual(["spending"]);
		expect(await bucketIds()).toContain("fun");
	});

	it("keeps one that money was Moved into or out of, and one a Rule files into", async () => {
		await db.insert(moves).values({
			id: "m1",
			householdId,
			kind: "cover",
			month: thisMonth,
			fromBucketId: null,
			toBucketId: "fun",
			amountCents: 500,
		});
		await db.insert(rules).values({ id: "r1", householdId, pattern: "arcade", bucketId: "fun" });
		expect(await deleteBucket(db, fun)).toEqual({ deleted: false, blockers: ["moves", "rules"] });
		expect(await bucketIds()).toContain("fun");
	});

	it("keeps one that was in an earlier month's Plan, and a Personal Allowance", async () => {
		expect(await deleteBucket(db, { ...fun, bucketId: "groceries" })).toEqual({
			deleted: false,
			blockers: ["earlier-months"],
		});
		await addPersonalAllowance(db, {
			...alex,
			bucketId: "alex-pa",
			name: "Alex’s Personal Allowance",
			color: 3,
			month: thisMonth,
			allowanceCents: 20_000,
		});
		expect((await deleteBucket(db, { ...fun, bucketId: "alex-pa" })).blockers).toEqual([
			"personal-allowance",
		]);
		expect(await bucketIds()).toEqual(expect.arrayContaining(["groceries", "alex-pa"]));
	});

	it("leaves a Review guess that named it without one", async () => {
		await transaction("t1", null);
		await db.insert(categorizations).values({
			transactionId: "t1",
			householdId,
			outcome: "review",
			method: "model",
			bucketId: "fun",
			merchant: "arcade",
		});
		expect((await deleteBucket(db, fun)).deleted).toBe(true);
		const [guess] = await db.select().from(categorizations);
		expect(guess?.bucketId).toBeNull();
	});

	it("does nothing for another Household's Bucket, and says there is none", async () => {
		const other = { ...fun, householdId: "someone-else" };
		expect(await bucketDeleteBlockers(db, other)).toBeNull();
		expect((await deleteBucket(db, other)).deleted).toBe(false);
		expect(await bucketIds()).toContain("fun");
	});
});
