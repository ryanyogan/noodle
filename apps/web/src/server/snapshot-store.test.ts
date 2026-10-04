import {
	type Db,
	listHouseholdSnapshots,
	recordSnapshot,
	type SnapshotFile,
	saveRule,
} from "@noodle/db";
import { accounts, buckets, members, transactions } from "@noodle/db/schema";
import { buildSeed, type SeedOptions, writeSeed } from "@noodle/db/seed";
import { testDb } from "@noodle/db/test-db";
import { beforeEach, describe, expect, it } from "vitest";
import { type ClearDeps, runClearStep } from "./fresh-start-clear";
import {
	applyRuleWithSnapshot,
	changesAfterRuleApply,
	FINAL_SNAPSHOT_PREFIX,
	finalSnapshotKey,
	gunzipJson,
	pruneFinalSnapshots,
	ruleApplyOutcome,
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

describe("a snapshot before applying a Rule", () => {
	const DAY = 86_400_000;
	const now = new Date("2026-10-04T15:00:00Z");
	let viewer: { householdId: string; memberId: string };
	let like: typeof transactions.$inferSelect;
	let accountId: string;

	beforeEach(async () => {
		// A Transaction already filed in a Household Bucket by a Parent: new ones are made like it
		// (same day and Parent, on the checking Account), so the Rule may file them in that Bucket.
		const parents = new Set(
			(await db.select().from(members)).filter((m) => m.kind === "parent").map((m) => m.id),
		);
		const shared = new Set(
			(await db.select().from(buckets)).filter((b) => !b.ownerMemberId).map((b) => b.id),
		);
		like = (await db.select().from(transactions))
			.filter(
				(t) =>
					t.bucketId &&
					shared.has(t.bucketId) &&
					t.amountCents > 0 &&
					parents.has(t.createdByMemberId ?? ""),
			)
			.sort((a, b) => (a.date < b.date ? 1 : -1))[0] as typeof like;
		viewer = { householdId, memberId: like.createdByMemberId as string };
		accountId = (await db.select().from(accounts)).find((a) => a.kind === "checking")?.id as string;
	});

	/** A Rule for `pattern` and `n` unassigned Transactions it matches. */
	async function ruleWith(pattern: string, n: number) {
		const ids = Array.from({ length: n }, (_, i) => `${pattern}-${i}`);
		await db.insert(transactions).values(
			ids.map((id) => ({
				id,
				householdId,
				source: "import" as const,
				date: like.date,
				amountCents: 4_200,
				note: `${pattern} store`,
				accountId,
				createdByMemberId: viewer.memberId,
			})),
		);
		const saved = await saveRule(db, {
			id: `rule-${pattern}`,
			householdId,
			memberId: viewer.memberId,
			pattern,
			bucketId: like.bucketId,
			forMemberIds: [],
		});
		expect(saved.ok).toBe(true);
		return ids;
	}

	const ofRule = async () =>
		(await listHouseholdSnapshots(db, householdId)).filter((s) => s.kind === "before-rule-apply");

	it("takes one before a Rule files more than one Transaction, holding them as they were", async () => {
		const ids = await ruleWith("zzlego", 3);
		const result = await applyRuleWithSnapshot(deps(), viewer, "rule-zzlego", now);
		expect(result.filed).toBe(3);
		const [row, ...more] = await ofRule();
		expect(more).toEqual([]);
		expect(row?.id).toBe(result.snapshotId);
		expect(row?.takenBy).toBe(viewer.memberId);
		// No note: the Rule may be a Parent's private one.
		expect(row?.note).toBeNull();
		const file = await gunzipJson<SnapshotFile>(files.get(row?.key ?? "") as Uint8Array);
		const before = (file.tables.transactions ?? []).filter((t) => ids.includes(t.id as string));
		expect(before.map((t) => t.bucket_id)).toEqual([null, null, null]);
		const after = (await db.select().from(transactions)).filter((t) => ids.includes(t.id));
		expect(after.map((t) => t.bucketId)).toEqual([like.bucketId, like.bucketId, like.bucketId]);
		// The page is told one was taken, and both Parents' snapshot history refetches.
		expect(ruleApplyOutcome(result)).toEqual({ filed: 3, snapshot: true });
		expect(changesAfterRuleApply(result)).toEqual([
			"months",
			"for-earlier",
			"bucket-uses",
			"snapshots",
		]);
	});

	it("takes none when the Rule files one Transaction, or nothing", async () => {
		await ruleWith("zzone", 1);
		const one = await applyRuleWithSnapshot(deps(), viewer, "rule-zzone", now);
		expect(one).toMatchObject({ filed: 1, snapshotId: null });
		const again = await applyRuleWithSnapshot(deps(), viewer, "rule-zzone", now);
		expect(again).toMatchObject({ filed: 0, snapshotId: null });
		// Nothing is said about a snapshot, and the snapshot history is left alone.
		expect(ruleApplyOutcome(one)).toEqual({ filed: 1, snapshot: false });
		expect(changesAfterRuleApply(one)).toEqual(["months", "for-earlier", "bucket-uses"]);
		expect(ruleApplyOutcome(again)).toEqual({ filed: 0, snapshot: false });
		expect(changesAfterRuleApply(again)).toEqual([]);
		expect(await ofRule()).toEqual([]);
		expect(files.size).toBe(0);
	});

	it("files nothing when the snapshot can't be taken", async () => {
		const ids = await ruleWith("zzfail", 2);
		const broken = {
			...deps(),
			bucket: {
				...bucket,
				async put() {
					throw new Error("R2 is down");
				},
			},
		};
		await expect(applyRuleWithSnapshot(broken, viewer, "rule-zzfail", now)).rejects.toThrow(
			"couldn’t take a snapshot first",
		);
		const rows = (await db.select().from(transactions)).filter((t) => ids.includes(t.id));
		expect(rows.map((t) => t.bucketId)).toEqual([null, null]);
		expect(await ofRule()).toEqual([]);
	});

	it("keeps the newest 3 of its own kind and never touches a Parent's own", async () => {
		// 20 of a Parent's own (the cap), and one past its 90 days that only the nightly run removes.
		const own = [
			...Array.from({ length: 20 }, (_, i) => ({ id: `own-${i}`, daysAgo: i + 1 })),
			{ id: "own-old", daysAgo: 100 },
		];
		for (const { id, daysAgo } of own) {
			const key = snapshotKey(householdId, id);
			files.set(key, new Uint8Array([1]));
			await recordSnapshot(db, {
				id,
				householdId,
				kind: "manual",
				takenBy: viewer.memberId,
				key,
				bytes: 1,
				format: 1,
				migration: null,
				rowCounts: {},
				createdAt: new Date(now.getTime() - daysAgo * DAY),
			});
		}
		const taken: string[] = [];
		for (let i = 0; i < 5; i++) {
			// Letters only: a merchant's digits are dropped when it is matched.
			const pattern = `zzshop${"abcde"[i]}`;
			await ruleWith(pattern, 2);
			const result = await applyRuleWithSnapshot(
				deps(),
				viewer,
				`rule-${pattern}`,
				new Date(now.getTime() + i * 60_000),
			);
			expect(result.filed).toBe(2);
			taken.push(result.snapshotId as string);
		}
		const history = await listHouseholdSnapshots(db, householdId);
		expect(
			history
				.filter((s) => s.kind === "before-rule-apply")
				.map((s) => s.id)
				.sort(),
		).toEqual(taken.slice(2).sort());
		expect(history.filter((s) => s.kind === "manual").length).toBe(21);
		for (const { id } of own) expect(files.has(snapshotKey(householdId, id))).toBe(true);
		for (const id of taken.slice(0, 2)) expect(files.has(snapshotKey(householdId, id))).toBe(false);
		for (const id of taken.slice(2)) expect(files.has(snapshotKey(householdId, id))).toBe(true);
	});
});
