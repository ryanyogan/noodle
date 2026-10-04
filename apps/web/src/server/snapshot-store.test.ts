import { type Db, listHouseholdSnapshots, type SnapshotFile } from "@noodle/db";
import { buildSeed, type SeedOptions, writeSeed } from "@noodle/db/seed";
import { testDb } from "@noodle/db/test-db";
import { beforeEach, describe, expect, it } from "vitest";
import { type ClearDeps, runClearStep } from "./fresh-start-clear";
import {
	FINAL_SNAPSHOT_PREFIX,
	finalSnapshotKey,
	gunzipJson,
	pruneFinalSnapshots,
	type SnapshotBucket,
	snapshotKey,
	takeFinalSnapshot,
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

describe("Delete Household's last snapshot", () => {
	const deletedAt = new Date("2026-10-04T15:00:00Z");
	const days = (n: number) => new Date(deletedAt.getTime() + n * 86_400_000);
	/** The bucket as R2 lists it: each file with when it was uploaded (when the fake took it). */
	let uploaded: Map<string, Date>;
	let clock: Date;
	const listed = {
		async put(key: string, value: Uint8Array) {
			files.set(key, value);
			uploaded.set(key, clock);
		},
		async delete(keys: string | string[]) {
			for (const key of Array.isArray(keys) ? keys : [keys]) files.delete(key);
		},
		async list({
			prefix,
			limit = 1000,
			cursor,
		}: {
			prefix: string;
			limit?: number;
			cursor?: string;
		}) {
			const keys = [...files.keys()].filter((key) => key.startsWith(prefix)).sort();
			const from = cursor ? Number(cursor) : 0;
			const page = keys.slice(from, from + limit);
			const truncated = from + limit < keys.length;
			return {
				objects: page.map((key) => ({ key, uploaded: uploaded.get(key) as Date })),
				truncated,
				cursor: truncated ? String(from + limit) : undefined,
			};
		},
	};
	const listedDeps = () => ({ db, bucket: listed, migration: "0048_household_snapshots" });

	beforeEach(() => {
		uploaded = new Map();
		clock = deletedAt;
	});

	it("is kept outside the Household's own prefix, with no row in the history", async () => {
		const kept = await takeFinalSnapshot(listedDeps(), { householdId, now: deletedAt, id: "FS1" });
		expect(kept.key).toBe(finalSnapshotKey(householdId, "FS1"));
		expect(kept.key.startsWith(FINAL_SNAPSHOT_PREFIX)).toBe(true);
		expect(kept.deleteAfter).toEqual(days(30));
		const file = await gunzipJson<SnapshotFile>(files.get(kept.key) as Uint8Array);
		expect(file.householdId).toBe(householdId);
		expect(file.tables.transactions?.length).toBeGreaterThan(50);
		expect(await listHouseholdSnapshots(db, householdId)).toEqual([]);
		// A retried step writes the same file again, not a second.
		await takeFinalSnapshot(listedDeps(), { householdId, now: deletedAt, id: "FS1" });
		expect(files.size).toBe(1);
	});

	it("outlives the delete, which removes every other snapshot of the Household", async () => {
		const nightly = await takeSnapshot(listedDeps(), {
			householdId,
			kind: "nightly",
			now: deletedAt,
		});
		const kept = await takeFinalSnapshot(listedDeps(), { householdId, now: deletedAt, id: "FS1" });
		const clear = {
			db,
			files: listed,
			backups: listed,
			merchants: { deleteByIds: async () => undefined },
			agent: () => ({ clearHousehold: async () => undefined }),
			bank: null,
		} as unknown as ClearDeps;
		await runClearStep(clear, "files", householdId, "delete");
		expect(files.has(nightly.key)).toBe(false);
		expect([...files.keys()]).toEqual([kept.key]);
	});

	it("is removed by the nightly run once 30 days old, and not a day sooner", async () => {
		const old = await takeFinalSnapshot(listedDeps(), { householdId, now: deletedAt, id: "FS1" });
		clock = days(10);
		const newer = await takeFinalSnapshot(listedDeps(), {
			householdId: "OTHER",
			now: clock,
			id: "FS2",
		});
		const nightly = await takeSnapshot(listedDeps(), {
			householdId,
			kind: "nightly",
			now: deletedAt,
		});
		expect(await pruneFinalSnapshots(listed, days(29))).toEqual([]);
		expect(await pruneFinalSnapshots(listed, days(30))).toEqual([old.key]);
		expect([...files.keys()].sort()).toEqual([newer.key, nightly.key].sort());
		expect(await pruneFinalSnapshots(listed, days(40))).toEqual([newer.key]);
		// A living Household's snapshots are never touched by it.
		expect([...files.keys()]).toEqual([nightly.key]);
	});
});
