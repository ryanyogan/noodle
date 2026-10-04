import {
	type Db,
	deleteSnapshotRows,
	exportHouseholdRows,
	hasNightlySince,
	listHouseholdSnapshots,
	recordSnapshot,
	SNAPSHOT_FORMAT,
	type SnapshotFile,
	type SnapshotKind,
	snapshotsToPrune,
} from "@noodle/db";
import { households } from "@noodle/db/schema";
import { ulid } from "ulid";

// Household snapshots (#78, ADR-0035): taking one into noodle-backups, pruning, and the nightly
// run, with the bucket passed in so tests can fake it. The server functions are snapshots.ts.

export const snapshotPrefix = (householdId: string) => `households/${householdId}/`;
export const snapshotKey = (householdId: string, id: string) =>
	`${snapshotPrefix(householdId)}${id}.json.gz`;

export type SnapshotBucket = {
	put(
		key: string,
		value: Uint8Array,
		options?: {
			httpMetadata?: { contentType?: string; contentEncoding?: string };
			customMetadata?: Record<string, string>;
		},
	): Promise<unknown>;
	delete(keys: string | string[]): Promise<unknown>;
};

export type SnapshotDeps = { db: Db; bucket: SnapshotBucket; migration: string | null };

/** JSON, gzipped (CompressionStream: the same in the Worker and in Node's tests). */
export async function gzipJson(value: unknown): Promise<Uint8Array> {
	const stream = new Blob([JSON.stringify(value)])
		.stream()
		.pipeThrough(new CompressionStream("gzip"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipJson<T>(bytes: Uint8Array): Promise<T> {
	const stream = new Blob([new Uint8Array(bytes)])
		.stream()
		.pipeThrough(new DecompressionStream("gzip"));
	return JSON.parse(await new Response(stream).text()) as T;
}

/** Exports the Household's rows into noodle-backups and records it in the history. */
export async function takeSnapshot(
	deps: SnapshotDeps,
	input: {
		householdId: string;
		kind: SnapshotKind;
		takenBy?: string | null;
		note?: string | null;
		now: Date;
		id?: string;
	},
) {
	const id = input.id ?? ulid(input.now.getTime());
	const { tables, rowCounts } = await exportHouseholdRows(deps.db, input.householdId);
	const file: SnapshotFile = {
		format: SNAPSHOT_FORMAT,
		householdId: input.householdId,
		takenAt: input.now.toISOString(),
		migration: deps.migration,
		tables,
	};
	const body = await gzipJson(file);
	const key = snapshotKey(input.householdId, id);
	await deps.bucket.put(key, body, {
		httpMetadata: { contentType: "application/gzip" },
		customMetadata: {
			householdId: input.householdId,
			kind: input.kind,
			format: String(SNAPSHOT_FORMAT),
		},
	});
	const row = {
		id,
		householdId: input.householdId,
		kind: input.kind,
		takenBy: input.takenBy ?? null,
		note: input.note?.trim() || null,
		key,
		bytes: body.byteLength,
		format: SNAPSHOT_FORMAT,
		migration: deps.migration,
		rowCounts,
		createdAt: input.now,
	};
	await recordSnapshot(deps.db, row);
	// Counts only: a snapshot's rows are never logged (ADR-0035).
	console.log(
		"Snapshot taken",
		JSON.stringify({ id, householdId: input.householdId, kind: input.kind, bytes: row.bytes }),
	);
	return row;
}

/** Deletes the snapshots the retention rules no longer keep: the file first, then its row. */
export async function pruneSnapshots(deps: SnapshotDeps, householdId: string, now: Date) {
	const snapshots = await listHouseholdSnapshots(deps.db, householdId);
	const prune = new Set(snapshotsToPrune(snapshots, now));
	const gone = snapshots.filter((snap) => prune.has(snap.id));
	if (gone.length === 0) return [];
	await deps.bucket.delete(gone.map((snap) => snap.key));
	await deleteSnapshotRows(
		deps.db,
		householdId,
		gone.map((snap) => snap.id),
	);
	return gone.map((snap) => snap.id);
}

const startOfUtcDay = (now: Date) =>
	new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/**
 * The nightly run: a snapshot of every Household (skipping one already taken today, so a retried
 * cron doesn't double up), then pruning. One Household failing is logged and the rest carry on.
 */
export async function takeNightlySnapshots(deps: SnapshotDeps, now: Date) {
	const all = await deps.db.select({ id: households.id }).from(households);
	let taken = 0;
	let failed = 0;
	for (const { id: householdId } of all) {
		try {
			if (!(await hasNightlySince(deps.db, householdId, startOfUtcDay(now)))) {
				await takeSnapshot(deps, { householdId, kind: "nightly", now });
				taken++;
			}
			await pruneSnapshots(deps, householdId, now);
		} catch (error) {
			failed++;
			console.error(`Couldn’t take Household ${householdId}’s nightly snapshot`, error);
		}
	}
	return { taken, failed };
}
