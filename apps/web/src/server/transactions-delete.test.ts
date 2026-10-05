import {
	createHouseholdForParent,
	type Db,
	listHouseholdSnapshots,
	snapshotsToPrune,
} from "@noodle/db";
import { transactions } from "@noodle/db/schema";
import { testDb } from "@noodle/db/test-db";
import { beforeEach, describe, expect, it } from "vitest";
import {
	changesAfterBulkDelete,
	deleteTransactionsWithSnapshot,
	type SnapshotBucket,
} from "./snapshot-store";

// Deleting many Transactions at once (#97, ADR-0045): a "Before deleting Transactions" snapshot
// is taken first, nothing is deleted when it can't be, and it is kept under its own cap.

const householdId = "household";
const viewer = { householdId, memberId: "parent" };
const now = new Date("2026-10-05T15:00:00Z");

let db: Db;
let files: Map<string, unknown>;
let failing: boolean;
const bucket = {
	async put(key: string, value: unknown) {
		if (failing) throw new Error("R2 is down");
		files.set(key, value);
	},
	async delete(keys: string | string[]) {
		for (const key of Array.isArray(keys) ? keys : [keys]) files.delete(key);
	},
} as unknown as SnapshotBucket;
const deps = () => ({ db, bucket, migration: "0050_deleted_bank_lines" });

beforeEach(async () => {
	db = testDb();
	files = new Map();
	failing = false;
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: viewer.memberId,
		parentName: "Alex",
	});
	await db.insert(transactions).values(
		["2026-08-03", "2026-09-04", "2026-10-02"].map((date, i) => ({
			id: `t${i}`,
			householdId,
			source: "quick-add" as const,
			date,
			amountCents: 1000 + i,
			createdByMemberId: viewer.memberId,
		})),
	);
});

const upToSeptember = { all: { month: "2026-09" as const, andEarlier: true } };
const left = async () => (await db.select().from(transactions)).map((row) => row.id).sort();

describe("deleteTransactionsWithSnapshot", () => {
	it("takes a snapshot of everything as it was, then deletes", async () => {
		const result = await deleteTransactionsWithSnapshot(deps(), viewer, upToSeptember, now);
		expect(result.deleted).toBe(2);
		expect(await left()).toEqual(["t2"]);
		const [row, ...more] = await listHouseholdSnapshots(db, householdId);
		expect(more).toEqual([]);
		expect(row?.id).toBe(result.snapshotId);
		expect(row?.kind).toBe("before-transactions-delete");
		expect(row?.takenBy).toBe(viewer.memberId);
		// All three are in it: it was taken before any went.
		expect(row?.rowCounts.transactions).toBe(3);
		expect(files.size).toBe(1);
		expect(changesAfterBulkDelete(result)).toEqual([
			"months",
			"for-earlier",
			"bucket-uses",
			"snapshots",
		]);
	});

	it("deletes nothing when the snapshot can't be taken", async () => {
		failing = true;
		await expect(
			deleteTransactionsWithSnapshot(deps(), viewer, upToSeptember, now),
		).rejects.toThrow(
			"Noodle couldn’t take a snapshot first, so nothing was deleted. Try again in a moment.",
		);
		expect(await left()).toEqual(["t0", "t1", "t2"]);
		expect(await listHouseholdSnapshots(db, householdId)).toEqual([]);
	});

	it("takes none when nothing matches, and a retry after a delete takes none either", async () => {
		const none = await deleteTransactionsWithSnapshot(deps(), viewer, { ids: ["nope"] }, now);
		expect(none).toEqual({ deleted: 0, snapshotId: null });
		expect(changesAfterBulkDelete(none)).toEqual([]);
		await deleteTransactionsWithSnapshot(deps(), viewer, upToSeptember, now);
		const again = await deleteTransactionsWithSnapshot(deps(), viewer, upToSeptember, now);
		expect(again).toEqual({ deleted: 0, snapshotId: null });
		expect(await listHouseholdSnapshots(db, householdId)).toHaveLength(1);
	});
});

describe("keeping snapshots taken before deleting Transactions", () => {
	it("keeps the newest 3, counted apart from every other kind", () => {
		const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 3_600_000);
		const snaps = [
			...[1, 2, 3, 4, 5].map((h) => ({
				id: `delete-${h}`,
				kind: "before-transactions-delete" as const,
				createdAt: at(h),
			})),
			...[1, 2, 3].map((h) => ({
				id: `rule-${h}`,
				kind: "before-rule-apply" as const,
				createdAt: at(h),
			})),
			{ id: "by-hand", kind: "manual" as const, createdAt: at(48) },
		];
		expect(snapshotsToPrune(snaps, now).sort()).toEqual(["delete-4", "delete-5"]);
	});
});
