import {
	clearHouseholdRows,
	type Db,
	deleteSnapshotRows,
	exportHouseholdRows,
	recordSnapshot,
	restoreHouseholdRows,
	SNAPSHOT_FORMAT,
	type SnapshotFile,
} from "@noodle/db";
import { buildSeed, type SeedOptions, writeSeed } from "@noodle/db/seed";
import { testDb } from "@noodle/db/test-db";
import { beforeEach, describe, expect, it } from "vitest";
import {
	deleteFilesUnlessHeld,
	fileHolds,
	type HoldBucket,
	heldFilesKey,
	putStatementFileOnce,
	readHeldFiles,
	releaseAllHeldFiles,
} from "./file-holds";
import { type ClearDeps, clearHousehold, runClearStep } from "./fresh-start-clear";
import { finalSnapshotKey, gzipJson, snapshotKey } from "./snapshot-store";

// Statement and Receipt files a kept snapshot refers to outlive a Fresh start or Delete Household,
// and go the night nothing needs them any more (#78, ADR-0035).

const DAY = 86_400_000;
let clock: Date;

function fakeBucket() {
	const data = new Map<string, { body: Uint8Array; uploaded: Date }>();
	const bucket = {
		async get(key: string) {
			const object = data.get(key);
			if (!object) return null;
			return { arrayBuffer: async () => new Uint8Array(object.body).buffer as ArrayBuffer };
		},
		async put(key: string, value: string | Uint8Array) {
			const body = typeof value === "string" ? new TextEncoder().encode(value) : value;
			data.set(key, { body, uploaded: clock });
		},
		async delete(keys: string | string[]) {
			for (const key of [keys].flat()) data.delete(key);
		},
		async list(options: { prefix: string; limit?: number; cursor?: string }) {
			const keys = [...data.keys()]
				.filter(
					(key) => key.startsWith(options.prefix) && (!options.cursor || key > options.cursor),
				)
				.sort();
			const page = keys.slice(0, options.limit ?? 1000);
			return {
				objects: page.map((key) => ({ key, uploaded: data.get(key)?.uploaded as Date })),
				truncated: keys.length > page.length,
				cursor: page.at(-1),
			};
		},
	};
	return { data, bucket };
}

let db: Db;
let h: string;
let statements: ReturnType<typeof fakeBucket>;
let backups: ReturnType<typeof fakeBucket>;

const deps = (): ClearDeps => ({
	db,
	files: statements.bucket as unknown as ClearDeps["files"],
	backups: backups.bucket as unknown as ClearDeps["backups"],
	holds: fileHolds({ db, backups: backups.bucket satisfies HoldBucket }),
	merchants: { deleteByIds: async () => undefined },
	agent: () => ({ clearHousehold: async () => undefined }),
	bank: null,
});
const release = (now: Date) =>
	releaseAllHeldFiles(
		{ db, backups: backups.bucket, files: statements.bucket as unknown as ClearDeps["files"] },
		now,
	);
const stored = () => [...statements.data.keys()].sort();

const fileOf = (keys: string[], takenAt: Date) =>
	gzipJson({
		format: SNAPSHOT_FORMAT,
		householdId: h,
		takenAt: takenAt.toISOString(),
		migration: null,
		tables: {
			imports: keys.map((key, i) => ({ id: `import-${i}`, household_id: h, file_key: key })),
		},
	});

/** A snapshot in the Household's history whose rows refer to `keys`. */
async function snapshotOf(id: string, keys: string[]) {
	const key = snapshotKey(h, id);
	await backups.bucket.put(key, await fileOf(keys, clock));
	await recordSnapshot(db, {
		id,
		householdId: h,
		kind: "before-fresh-start",
		takenBy: null,
		note: null,
		key,
		bytes: 1,
		format: SNAPSHOT_FORMAT,
		migration: null,
		rowCounts: {},
		createdAt: clock,
	});
}

/** The snapshot's retention is up: its file and row go, as pruning does. */
async function expire(id: string) {
	await backups.bucket.delete(snapshotKey(h, id));
	await deleteSnapshotRows(db, h, [id]);
}

let a: string;
let b: string;
let receipt: string;
let download: string;
const OTHER = "another-household/statement.csv";

beforeEach(async () => {
	clock = new Date("2026-10-04T09:00:00Z");
	db = testDb();
	statements = fakeBucket();
	backups = fakeBucket();
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
	h = rows.households[0]?.id as string;
	a = `${h}/a.csv`;
	b = `${h}/b.csv`;
	receipt = `receipts/${h}/r1.eml`;
	download = `exports/${h}/x.zip`;
	for (const key of [a, b, receipt, download, OTHER]) await statements.bucket.put(key, "x");
});

describe("a Fresh start", () => {
	it("leaves the files a kept snapshot refers to, deletes the rest and notes what it left", async () => {
		await snapshotOf("s1", [a, receipt]);
		await runClearStep(deps(), "files", h, "fresh-start");
		expect(stored()).toEqual([OTHER, a, receipt].sort());
		expect(await readHeldFiles(backups.bucket, h)).toEqual([a, receipt].sort());
		// Again (a retried step, then the sweep two minutes on): the same.
		await runClearStep(deps(), "files", h, "fresh-start");
		await runClearStep(deps(), "files", h, "fresh-start", new Date(clock.getTime() + DAY));
		expect(stored()).toEqual([OTHER, a, receipt].sort());
		expect(await readHeldFiles(backups.bucket, h)).toEqual([a, receipt].sort());
	});

	it("deletes every file when no snapshot refers to any", async () => {
		await snapshotOf("s1", []);
		await runClearStep(deps(), "files", h, "fresh-start");
		expect(stored()).toEqual([OTHER]);
		expect(backups.data.has(heldFilesKey(h))).toBe(false);
	});
});

describe("the nightly run", () => {
	it("keeps held files while a snapshot needs them and deletes them when the last one expires", async () => {
		await snapshotOf("s1", [a, receipt]);
		await snapshotOf("s2", [a]);
		await runClearStep(deps(), "files", h, "fresh-start");

		expect(await release(clock)).toMatchObject({ removed: 0, failed: 0 });
		expect(stored()).toEqual([OTHER, a, receipt].sort());

		await expire("s1");
		expect(await release(clock)).toMatchObject({ removed: 1 });
		expect(stored()).toEqual([OTHER, a].sort());
		expect(await readHeldFiles(backups.bucket, h)).toEqual([a]);

		await expire("s2");
		expect(await release(clock)).toMatchObject({ removed: 1 });
		expect(stored()).toEqual([OTHER]);
		expect(backups.data.has(heldFilesKey(h))).toBe(false);
		expect(await release(clock)).toMatchObject({ removed: 0, failed: 0 });
	});

	it("deletes nothing while a snapshot's file can't be read", async () => {
		await snapshotOf("s1", [a]);
		await runClearStep(deps(), "files", h, "fresh-start");
		await expire("s1");
		await snapshotOf("s2", []);
		await backups.bucket.put(snapshotKey(h, "s2"), "not a snapshot");
		expect(await release(clock)).toMatchObject({ removed: 0, failed: 1 });
		expect(stored()).toEqual([OTHER, a].sort());
	});
});

describe("Delete Household", () => {
	it("leaves the files its last snapshot refers to until that snapshot's 30 days are up", async () => {
		await snapshotOf("s1", [a, b]);
		await backups.bucket.put(finalSnapshotKey(h, "fs1"), await fileOf([a], clock));
		await clearHousehold(deps(), h, "delete");
		// Only what the last snapshot needs; the Household's own snapshots went with it.
		expect(stored()).toEqual([OTHER, a].sort());
		expect([...backups.data.keys()]).toEqual([finalSnapshotKey(h, "fs1")]);

		expect(await release(new Date(clock.getTime() + 29 * DAY))).toMatchObject({ lastSnapshots: 0 });
		expect(stored()).toEqual([OTHER, a].sort());
		expect(await release(new Date(clock.getTime() + 30 * DAY))).toMatchObject({ lastSnapshots: 1 });
		expect(stored()).toEqual([OTHER]);
		expect(backups.data.size).toBe(0);
	});

	it("deletes every file at once when no last snapshot is kept", async () => {
		await snapshotOf("s1", [a, b]);
		await clearHousehold(deps(), h, "delete");
		expect(stored()).toEqual([OTHER]);
		expect(backups.data.size).toBe(0);
	});

	it("never takes a living Household's files when a last snapshot under its id expires", async () => {
		await backups.bucket.put(finalSnapshotKey(h, "fs1"), await fileOf([a], clock));
		expect(await release(new Date(clock.getTime() + 31 * DAY))).toMatchObject({ lastSnapshots: 1 });
		expect(stored()).toEqual([OTHER, a, b, download, receipt].sort());
	});
});

describe("deleting a file by hand (a refused upload, or an Import removed)", () => {
	const byHand = (keys: string[]) =>
		deleteFilesUnlessHeld(
			{ db, backups: backups.bucket, files: statements.bucket as unknown as ClearDeps["files"] },
			h,
			keys,
		);

	it("deletes it at once when no snapshot refers to it", async () => {
		await snapshotOf("s1", [b]);
		expect(await byHand([a])).toEqual({ removed: [a], held: [] });
		expect(stored()).toEqual([OTHER, b, download, receipt].sort());
		expect(backups.data.has(heldFilesKey(h))).toBe(false);
	});

	it("keeps it while a snapshot refers to it, and notes it", async () => {
		await snapshotOf("s1", [a]);
		expect(await byHand([a, b])).toEqual({ removed: [b], held: [a] });
		expect(stored()).toEqual([OTHER, a, download, receipt].sort());
		expect(await readHeldFiles(backups.bucket, h)).toEqual([a]);
	});

	it("lets it go the night its last snapshot has expired or been deleted", async () => {
		await snapshotOf("s1", [a]);
		await snapshotOf("s2", [a]);
		await byHand([a]);

		await expire("s1");
		expect(await release(clock)).toMatchObject({ removed: 0, failed: 0 });
		expect(stored()).toContain(a);

		await expire("s2");
		expect(await release(clock)).toMatchObject({ removed: 1, failed: 0 });
		expect(stored()).not.toContain(a);
		expect(backups.data.has(heldFilesKey(h))).toBe(false);
	});

	it("an upload tried again never writes over the file a snapshot refers to", async () => {
		await snapshotOf("s1", [a]);
		const files = {
			head: async (key: string) => (statements.data.has(key) ? {} : null),
			put: (key: string, value: string) => statements.bucket.put(key, value),
		};
		const text = (key: string) => new TextDecoder().decode(statements.data.get(key)?.body);
		const kept = text(a);

		// The same Import id again after a Fresh start, with whatever the browser sends this time.
		expect(await putStatementFileOnce(files, a, "another statement's lines")).toBe(false);
		expect(text(a)).toBe(kept);
		// Refused (its Account is gone), so the file would go: it stays, for the snapshot.
		expect(await byHand([a])).toEqual({ removed: [], held: [a] });
		expect(text(a)).toBe(kept);

		// A new upload has a key of its own and is written.
		const fresh = `${h}/account/new-import.csv`;
		expect(await putStatementFileOnce(files, fresh, "date,amount")).toBe(true);
		expect(text(fresh)).toBe("date,amount");
	});

	it("deletes nothing while a snapshot's file can't be read", async () => {
		await snapshotOf("s1", []);
		await backups.bucket.put(snapshotKey(h, "s1"), "not a snapshot");
		expect(await byHand([a])).toEqual({ removed: [], held: [a] });
		expect(stored()).toContain(a);
		expect(await readHeldFiles(backups.bucket, h)).toEqual([a]);
	});

	it("has the Import and its file both there after the snapshot is restored", async () => {
		// A snapshot of the Household as it is, with an Import that has a statement file.
		const before = await exportHouseholdRows(db, h);
		const fileKey = String(before.tables.imports?.find((row) => row.file_key)?.file_key);
		expect(fileKey.startsWith(`${h}/`)).toBe(true);
		await statements.bucket.put(fileKey, "the statement");
		const file: SnapshotFile = {
			format: SNAPSHOT_FORMAT,
			householdId: h,
			takenAt: clock.toISOString(),
			migration: null,
			tables: before.tables,
		};
		const key = snapshotKey(h, "s1");
		await backups.bucket.put(key, await gzipJson(file));
		await recordSnapshot(db, {
			id: "s1",
			householdId: h,
			kind: "manual",
			takenBy: null,
			note: null,
			key,
			bytes: 1,
			format: SNAPSHOT_FORMAT,
			migration: null,
			rowCounts: before.rowCounts,
			createdAt: clock,
		});

		// The Import's row goes (here with every other row: nothing removes one Import alone yet)
		// and its file is deleted by hand.
		await clearHouseholdRows(db, h, "fresh-start");
		expect(await byHand([fileKey])).toEqual({ removed: [], held: [fileKey] });

		await restoreHouseholdRows(db, h, file);
		const after = await exportHouseholdRows(db, h);
		expect(after.tables.imports).toEqual(before.tables.imports);
		expect(stored()).toContain(fileKey);

		// And once the snapshot has expired the file stays: the Import's row needs it again.
		await expire("s1");
		expect(await release(clock)).toMatchObject({ removed: 0, failed: 0 });
		expect(stored()).toContain(fileKey);
	});
});
