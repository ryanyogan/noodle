import {
	type Db,
	listHouseholdSnapshots,
	loadMoneyInReview,
	type SnapshotFile,
	type SnapshotRow,
} from "@noodle/db";
import { accounts, income } from "@noodle/db/schema";
import { buildSeed, type SeedOptions, writeSeed } from "@noodle/db/seed";
import { testDb } from "@noodle/db/test-db";
import { beforeEach, describe, expect, it } from "vitest";
import { runMoneyInPasses } from "./money-in-pass";
import { gunzipJson, type SnapshotBucket } from "./snapshot-store";

// The one-time pass of ADR-0057 as the nightly cron runs it: a real snapshot of the Household is
// stored before October 2026's person-to-person money in goes back to Review, and never again.

let db: Db;
let householdId: string;
let files: Map<string, Uint8Array>;
let bucketDown = false;
const bucket: SnapshotBucket = {
	async put(key, value) {
		if (bucketDown) throw new Error("R2 is down");
		files.set(key, value);
	},
	async delete(keys) {
		for (const key of Array.isArray(keys) ? keys : [keys]) files.delete(key);
	},
};
const deps = () => ({ db, bucket, migration: "0061_household_passes" });
const now = new Date("2026-10-07T09:00:00Z");
const waiting = async () => (await loadMoneyInReview(db, householdId)).map((row) => row.id);

beforeEach(async () => {
	db = testDb();
	files = new Map();
	bucketDown = false;
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
	const account = (await db.select().from(accounts)).find((row) => row.householdId === householdId);
	// As October's Imports left it before money in had a kind: Income, not waiting.
	await db.insert(income).values({
		id: "october-zelle",
		householdId,
		date: "2026-10-05",
		amountCents: 30_000,
		note: "Zelle payment from CASEY LOWE 24816357",
		accountId: account?.id as string,
	});
});

describe("the nightly run of the one-time money-in pass", () => {
	it("stores a snapshot from before the change, sends the line to Review, and runs once", async () => {
		expect(await runMoneyInPasses(deps(), now)).toEqual({ households: 1, changed: 1, failed: 0 });
		expect(await waiting()).toEqual(["october-zelle"]);

		const snapshots = (await listHouseholdSnapshots(db, householdId)).filter((row) =>
			row.note?.includes("money in went back to Review"),
		);
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]?.kind).toBe("manual");
		const stored = files.get(snapshots[0]?.key as string);
		const file = await gunzipJson<SnapshotFile>(stored as Uint8Array);
		const kept = (Object.values(file.tables).flat() as SnapshotRow[]).find(
			(row) => row.id === "october-zelle",
		);
		// The snapshot holds the line as it was: still counted, not waiting.
		expect(kept?.needs_review ?? kept?.needsReview).toBe(0);

		// The next night there is no Household left to run it for.
		expect(await runMoneyInPasses(deps(), now)).toEqual({ households: 0, changed: 0, failed: 0 });
		expect(files.size).toBe(1);
	});

	it("changes nothing while the snapshot can't be stored, and tries again another night", async () => {
		bucketDown = true;
		expect(await runMoneyInPasses(deps(), now)).toEqual({ households: 1, changed: 0, failed: 1 });
		expect(await waiting()).toEqual([]);

		bucketDown = false;
		expect(await runMoneyInPasses(deps(), now)).toEqual({ households: 1, changed: 1, failed: 0 });
		expect(await waiting()).toEqual(["october-zelle"]);
	});
});
