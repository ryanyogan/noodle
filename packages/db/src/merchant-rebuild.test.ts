import { merchantKey } from "@noodle/domain";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { clearHouseholdRows, learnedMerchantBuckets, recordLearnedMerchant } from "./fresh-start";
import type { Db } from "./index";
import * as s from "./schema";
import { buildSeed, type SeedOptions, writeSeed } from "./seed";
import { exportHouseholdRows, restoreHouseholdRows, SNAPSHOT_FORMAT } from "./snapshots";
import { testDb } from "./test-db";

// What the merchant index is built from again after a snapshot is restored (#78, ADR-0035): the
// merchants the Household taught it, each with the Bucket a Parent last put it in.

let db: Db;
let householdId: string;
let buckets: string[];

beforeEach(async () => {
	db = testDb();
	const rows = buildSeed("busy", {
		today: "2026-09-30",
		now: Date.parse("2026-09-30T18:00:00Z"),
		timeZone: "America/Los_Angeles",
		parents: [
			{ clerkUserId: "user_alex", name: "Alex", email: "alex@example.com" },
			{ clerkUserId: "user_sam", name: "Sam", email: "sam@example.com" },
		],
	} as SeedOptions);
	await writeSeed(db, rows);
	householdId = rows.households[0]?.id as string;
	buckets = (
		await db
			.select({ id: s.buckets.id })
			.from(s.buckets)
			.where(eq(s.buckets.householdId, householdId))
			.limit(2)
	).map((row) => row.id);
	// Three Transactions a Parent settled after importing them: the bakery twice, the newer one
	// in another Bucket, and a hardware store.
	const ids = (
		await db
			.select({ id: s.transactions.id })
			.from(s.transactions)
			.where(eq(s.transactions.householdId, householdId))
			.limit(3)
	).map((row) => row.id);
	await db.delete(s.categorizations).where(inArray(s.categorizations.transactionId, ids));
	const settled = [
		{ merchant: "Corner Bakery", date: "2026-09-01", bucketId: buckets[0] },
		{ merchant: "Corner Bakery", date: "2026-09-20", bucketId: buckets[1] },
		{ merchant: "Hardware Store", date: "2026-09-10", bucketId: buckets[0] },
	];
	for (const [i, values] of settled.entries())
		await db
			.update(s.transactions)
			.set({ ...values, source: "import" })
			.where(eq(s.transactions.id, ids[i] as string));
});

describe("what the merchant index learns again", () => {
	it("is each learned merchant with the Bucket of its newest settled Transaction", async () => {
		await recordLearnedMerchant(db, householdId, merchantKey("Corner Bakery"));
		await recordLearnedMerchant(db, householdId, merchantKey("Hardware Store"));
		await recordLearnedMerchant(db, householdId, "a merchant with no transaction left");
		expect(await learnedMerchantBuckets(db, householdId)).toEqual([
			{ merchant: merchantKey("Corner Bakery"), bucketId: buckets[1] },
			{ merchant: merchantKey("Hardware Store"), bucketId: buckets[0] },
		]);
	});

	it("is nothing the Household never taught it", async () => {
		expect(await learnedMerchantBuckets(db, householdId)).toEqual([]);
		await recordLearnedMerchant(db, householdId, merchantKey("Hardware Store"));
		expect((await learnedMerchantBuckets(db, householdId)).map((row) => row.merchant)).toEqual([
			merchantKey("Hardware Store"),
		]);
	});

	it("is the same after a Fresh start and a restore as when the snapshot was taken", async () => {
		await recordLearnedMerchant(db, householdId, merchantKey("Corner Bakery"));
		await recordLearnedMerchant(db, householdId, merchantKey("Hardware Store"));
		const before = await learnedMerchantBuckets(db, householdId);
		expect(before).toHaveLength(2);
		const { tables } = await exportHouseholdRows(db, householdId);
		await clearHouseholdRows(db, householdId, "fresh-start");
		expect(await learnedMerchantBuckets(db, householdId)).toEqual([]);
		await restoreHouseholdRows(db, householdId, {
			format: SNAPSHOT_FORMAT,
			householdId,
			takenAt: "2026-09-30T18:00:00.000Z",
			migration: null,
			tables,
		});
		expect(await learnedMerchantBuckets(db, householdId)).toEqual(before);
	});
});
