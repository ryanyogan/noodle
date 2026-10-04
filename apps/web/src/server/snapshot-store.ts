import {
	applyRule,
	type Db,
	deleteSnapshotRows,
	exportHouseholdRows,
	FINAL_SNAPSHOT_DAYS,
	hasNightlySince,
	listHouseholdSnapshots,
	recordSnapshot,
	SNAPSHOT_FORMAT,
	type SnapshotFile,
	type SnapshotKind,
	snapshotsToPrune,
	type Viewer,
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

/** Where a deleted Household's last snapshot waits out its 30 days: not under `households/`. */
export const FINAL_SNAPSHOT_PREFIX = "deleted-households/";
export const finalSnapshotKey = (householdId: string, id: string) =>
	`${FINAL_SNAPSHOT_PREFIX}${householdId}/${id}.json.gz`;

/**
 * Delete Household's last snapshot (ADR-0035): the same file as any snapshot, but with no row in
 * the history (the rows go with the Household) and under its own prefix, which the clear doesn't
 * empty. No Parent can reach it; the operator can put it back by hand until the nightly run
 * removes it 30 days on.
 */
export async function takeFinalSnapshot(
	deps: SnapshotDeps,
	input: { householdId: string; now: Date; id: string },
) {
	const { tables } = await exportHouseholdRows(deps.db, input.householdId);
	const file: SnapshotFile = {
		format: SNAPSHOT_FORMAT,
		householdId: input.householdId,
		takenAt: input.now.toISOString(),
		migration: deps.migration,
		tables,
	};
	const body = await gzipJson(file);
	const key = finalSnapshotKey(input.householdId, input.id);
	const deleteAfter = new Date(input.now.getTime() + FINAL_SNAPSHOT_DAYS * 86_400_000);
	await deps.bucket.put(key, body, {
		httpMetadata: { contentType: "application/gzip" },
		customMetadata: {
			householdId: input.householdId,
			kind: "before-delete",
			format: String(SNAPSHOT_FORMAT),
			deleteAfter: deleteAfter.toISOString(),
		},
	});
	console.log(
		"Last snapshot kept",
		JSON.stringify({ householdId: input.householdId, key, bytes: body.byteLength, deleteAfter }),
	);
	return { key, bytes: body.byteLength, deleteAfter };
}

type ListedBucket = {
	list(options: { prefix: string; limit?: number; cursor?: string }): Promise<{
		objects: { key: string; uploaded: Date }[];
		truncated: boolean;
		cursor?: string;
	}>;
	delete(keys: string | string[]): Promise<unknown>;
};

/** Removes deleted Households' last snapshots once they are 30 days old (by when R2 took them). */
export async function pruneFinalSnapshots(
	bucket: ListedBucket,
	now: Date,
	/**
	 * Called for each deleted Household before its last snapshot goes, to delete the statement and
	 * Receipt files kept for it. If it throws, the snapshot stays and the next night tries again.
	 */
	onExpire?: (householdId: string) => Promise<void>,
): Promise<string[]> {
	const cutoff = now.getTime() - FINAL_SNAPSHOT_DAYS * 86_400_000;
	const gone: string[] = [];
	let cursor: string | undefined;
	for (;;) {
		const page = await bucket.list({ prefix: FINAL_SNAPSHOT_PREFIX, limit: 1000, cursor });
		const keys = page.objects
			.filter((object) => object.uploaded.getTime() <= cutoff)
			.map((object) => object.key);
		if (onExpire) {
			const householdIds = new Set(
				keys.map((key) => key.slice(FINAL_SNAPSHOT_PREFIX.length).split("/")[0] ?? ""),
			);
			for (const householdId of householdIds) if (householdId) await onExpire(householdId);
		}
		if (keys.length > 0) await bucket.delete(keys);
		gone.push(...keys);
		if (!page.truncated) break;
		cursor = page.cursor;
	}
	return gone;
}

/**
 * Deletes the snapshots the retention rules no longer keep: the file first, then its row. With
 * `only`, just that kind is looked at (what a bulk Rule apply does straight after taking its own).
 */
export async function pruneSnapshots(
	deps: SnapshotDeps,
	householdId: string,
	now: Date,
	only?: SnapshotKind,
) {
	const all = await listHouseholdSnapshots(deps.db, householdId);
	const snapshots = only ? all.filter((snap) => snap.kind === only) : all;
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

/** A Rule about to file this many Transactions at once, or more, is a bulk apply. */
export const BULK_RULE_APPLY = 2;

/**
 * Applies a Rule to what's unassigned that it matches. When that is more than one Transaction, a
 * "Before applying a Rule" snapshot is taken first (ADR-0035), so the Parent can put things back:
 * if it can't be taken this throws and nothing is filed, as a Fresh start stops when its snapshot
 * fails. Then that kind alone is pruned to its own cap; a Parent's own snapshots are never looked
 * at. The snapshot carries no note: the Rule may be a Parent's private one.
 */
export async function applyRuleWithSnapshot(
	deps: SnapshotDeps,
	viewer: Viewer,
	ruleId: string,
	now: Date,
) {
	const taken: { id: string | null } = { id: null };
	const result = await applyRule(deps.db, viewer, ruleId, {
		beforeFiling: async (matched) => {
			if (matched < BULK_RULE_APPLY) return;
			try {
				const row = await takeSnapshot(deps, {
					householdId: viewer.householdId,
					kind: "before-rule-apply",
					takenBy: viewer.memberId,
					now,
				});
				taken.id = row.id;
			} catch (error) {
				console.error("Couldn’t take a snapshot before applying a Rule", error);
				throw new Error(
					"Noodle couldn’t take a snapshot first, so the Rule wasn’t applied. Try again in a moment.",
				);
			}
		},
	});
	if (taken.id) {
		// Already filed: a failed tidy-up is left for the nightly run.
		try {
			await pruneSnapshots(deps, viewer.householdId, now, "before-rule-apply");
		} catch (error) {
			console.error("Couldn’t prune the snapshots taken before applying a Rule", error);
		}
	}
	return { ...result, snapshotId: taken.id };
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

/** The newest migration applied, so a snapshot says which schema its rows fit (ADR-0035). */
export async function newestMigration(db: D1Database): Promise<string | null> {
	try {
		return (
			(await db
				.prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1")
				.first<string>("name")) ?? null
		);
	} catch {
		return null;
	}
}

/** A snapshot's file, unzipped; null when it's gone from the bucket. */
export async function readSnapshot(
	bucket: { get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> },
	key: string,
): Promise<SnapshotFile | null> {
	const object = await bucket.get(key);
	if (!object) return null;
	return gunzipJson<SnapshotFile>(new Uint8Array(await object.arrayBuffer()));
}
