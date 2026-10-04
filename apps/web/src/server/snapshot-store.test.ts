import { type Db, listHouseholdSnapshots, type SnapshotFile } from "@noodle/db";
import { buildSeed, type SeedOptions, writeSeed } from "@noodle/db/seed";
import { testDb } from "@noodle/db/test-db";
import { beforeEach, describe, expect, it } from "vitest";
import {
	gunzipJson,
	type SnapshotBucket,
	snapshotKey,
	takeNightlySnapshots,
	takeSnapshot,
} from "./snapshot-store";

// Household snapshots (#78, ADR-0035): one Household's rows, gzipped into noodle-backups at
// households/<id>/, recorded in the history, taken nightly once a day and pruned.

let db: Db;
let householdId: string;
let files: Map<string, Uint8Array>;
const bucket: SnapshotBucket = {
	async put(key, value) {
		files.set(key, value);
	},
	async delete(keys) {
		for (const key of Array.isArray(keys) ? keys : [keys]) files.delete(key);
	},
};
const deps = () => ({ db, bucket, migration: "0048_household_snapshots" });

beforeEach(async () => {
	db = testDb();
	files = new Map();
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
});

describe("taking a snapshot", () => {
	it("stores the Household's rows gzipped under its own prefix and records it", async () => {
		const now = new Date("2026-10-04T15:00:00Z");
		const row = await takeSnapshot(deps(), {
			householdId,
			kind: "manual",
			takenBy: "someone",
			note: "  before the new Rules  ",
			now,
		});
		expect(row.key).toBe(snapshotKey(householdId, row.id));
		expect(row.key.startsWith(`households/${householdId}/`)).toBe(true);
		const stored = files.get(row.key);
		expect(stored?.byteLength).toBe(row.bytes);
		const file = await gunzipJson<SnapshotFile>(stored as Uint8Array);
		expect(file.format).toBe(1);
		expect(file.householdId).toBe(householdId);
		expect(file.migration).toBe("0048_household_snapshots");
		expect(file.tables.transactions?.length).toBe(row.rowCounts.transactions);
		expect(file.tables.householdSnapshots).toBeUndefined();
		const [listed] = await listHouseholdSnapshots(db, householdId);
		expect(listed).toMatchObject({ id: row.id, kind: "manual", note: "before the new Rules" });
		expect(listed?.rowCounts.transactions).toBeGreaterThan(50);
	});
});

describe("the nightly snapshots", () => {
	it("takes one a day per Household, however often the cron runs", async () => {
		const night = new Date("2026-10-04T09:00:00Z");
		expect(await takeNightlySnapshots(deps(), night)).toEqual({ taken: 1, failed: 0 });
		expect(await takeNightlySnapshots(deps(), new Date(night.getTime() + 60_000))).toEqual({
			taken: 0,
			failed: 0,
		});
		expect(files.size).toBe(1);
	});

	it("prunes past the 14 nightly and the weekly ones, file and row", async () => {
		const start = Date.parse("2026-06-01T09:00:00Z");
		for (let day = 0; day < 100; day++)
			await takeNightlySnapshots(deps(), new Date(start + day * 86_400_000));
		const kept = await listHouseholdSnapshots(db, householdId);
		expect(kept.length).toBe(22);
		expect(files.size).toBe(22);
		for (const snap of kept) expect(files.has(snap.key)).toBe(true);
	}, 60_000);
});
