import {
	type ClearLevel,
	type Db,
	exportHouseholdRows,
	listHouseholdSnapshots,
	type SnapshotFile,
} from "@noodle/db";
import { households } from "@noodle/db/schema";
import { referencedFiles, splitFilesForClear, splitHeldFiles } from "@noodle/domain";
import { type ClearDeps, clearHouseholdFiles, filePrefixes } from "./fresh-start-clear";
import {
	FINAL_SNAPSHOT_PREFIX,
	gunzipJson,
	pruneFinalSnapshots,
	snapshotPrefix,
} from "./snapshot-store";

// Statement and Receipt files kept for snapshots (#78, ADR-0035). A snapshot refers to files by
// key, so a Fresh start leaves the files its kept snapshots refer to, and Delete Household those
// its one last snapshot refers to. The nightly run deletes them once nothing needs them: for a
// living Household, from the list kept beside its snapshots; for a deleted one, when its last
// snapshot's 30 days are up. Which file is still needed is decided in @noodle/domain.

export type HoldBucket = {
	get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
	put(key: string, value: string): Promise<unknown>;
	delete(keys: string | string[]): Promise<unknown>;
	list(options: { prefix: string; limit?: number; cursor?: string }): Promise<{
		objects: { key: string; uploaded: Date }[];
		truncated: boolean;
		cursor?: string;
	}>;
};

/** The list of files a living Household's clears left behind: beside its snapshots, so Delete Household removes it with them. */
export const heldFilesKey = (householdId: string) =>
	`${snapshotPrefix(householdId)}held-files.json`;

const PAGE = 1000;

export async function readHeldFiles(bucket: HoldBucket, householdId: string): Promise<string[]> {
	const object = await bucket.get(heldFilesKey(householdId));
	if (!object) return [];
	const parsed = JSON.parse(new TextDecoder().decode(await object.arrayBuffer())) as {
		keys?: unknown;
	};
	return Array.isArray(parsed.keys)
		? parsed.keys.filter((key): key is string => typeof key === "string")
		: [];
}

async function writeHeldFiles(bucket: HoldBucket, householdId: string, keys: string[]) {
	if (keys.length === 0) await bucket.delete(heldFilesKey(householdId));
	else await bucket.put(heldFilesKey(householdId), JSON.stringify({ keys }));
}

/** Adds files to the Household's list; the same files again change nothing. */
export async function holdFiles(bucket: HoldBucket, householdId: string, keys: string[]) {
	if (keys.length === 0) return;
	const held = new Set(await readHeldFiles(bucket, householdId));
	const before = held.size;
	for (const key of keys) held.add(key);
	if (held.size > before) await writeHeldFiles(bucket, householdId, [...held].sort());
}

async function filesIn(bucket: HoldBucket, key: string, householdId: string) {
	const object = await bucket.get(key);
	// A snapshot whose file is gone needs nothing. One that can't be read throws, so nothing is
	// deleted on a guess.
	if (!object) return null;
	const file = await gunzipJson<SnapshotFile>(new Uint8Array(await object.arrayBuffer()));
	return new Set(referencedFiles(file.tables, filePrefixes(householdId)));
}

/** What each snapshot in the Household's history refers to. */
export async function snapshotFileNeeds(
	deps: { db: Db; backups: HoldBucket },
	householdId: string,
): Promise<Set<string>[]> {
	const needs: Set<string>[] = [];
	for (const snap of await listHouseholdSnapshots(deps.db, householdId)) {
		const keys = await filesIn(deps.backups, snap.key, householdId);
		if (keys) needs.push(keys);
	}
	return needs;
}

/** What a deleted Household's last snapshot refers to (none when it kept none). */
export async function finalSnapshotNeeds(
	backups: HoldBucket,
	householdId: string,
): Promise<Set<string>[]> {
	const needs: Set<string>[] = [];
	const page = await backups.list({ prefix: `${FINAL_SNAPSHOT_PREFIX}${householdId}/` });
	for (const object of page.objects) {
		const keys = await filesIn(backups, object.key, householdId);
		if (keys) needs.push(keys);
	}
	return needs;
}

/** The clear's view of this (ClearDeps.holds). */
export function fileHolds(deps: { db: Db; backups: HoldBucket }): NonNullable<ClearDeps["holds"]> {
	return {
		async needed(householdId: string, level: ClearLevel) {
			const needs =
				level === "delete"
					? await finalSnapshotNeeds(deps.backups, householdId)
					: await snapshotFileNeeds(deps, householdId);
			return new Set(needs.flatMap((keys) => [...keys]));
		},
		hold: (householdId, keys) => holdFiles(deps.backups, householdId, keys),
	};
}

export type ReleaseDeps = { db: Db; backups: HoldBucket; files: ClearDeps["files"] };

/**
 * For one living Household: deletes the held files nothing needs any more (no row it has now, no
 * snapshot still in its history) and keeps the rest on the list. Run again, it finds none.
 */
export async function releaseHeldFiles(deps: ReleaseDeps, householdId: string) {
	const held = await readHeldFiles(deps.backups, householdId);
	if (held.length === 0) return { removed: 0, held: 0 };
	const { tables } = await exportHouseholdRows(deps.db, householdId);
	const live = new Set(referencedFiles(tables, filePrefixes(householdId)));
	const { keep, remove } = splitHeldFiles(held, live, await snapshotFileNeeds(deps, householdId));
	for (let i = 0; i < remove.length; i += PAGE) await deps.files.delete(remove.slice(i, i + PAGE));
	if (remove.length > 0) await writeHeldFiles(deps.backups, householdId, keep);
	return { removed: remove.length, held: keep.length };
}

/**
 * Deleting a living Household's files by hand, outside a clear (a refused upload today; removing
 * an Import, when there is such a thing): the same rule as a Fresh start. A file a kept snapshot
 * refers to stays, on the Household's list, and goes the night its last such snapshot has expired
 * or been deleted (`releaseHeldFiles`); the rest are deleted now. When a snapshot can't be read
 * nothing is deleted on a guess: every file is listed, and the nightly run decides.
 */
export async function deleteFilesUnlessHeld(
	deps: ReleaseDeps,
	householdId: string,
	keys: string[],
): Promise<{ removed: string[]; held: string[] }> {
	if (keys.length === 0) return { removed: [], held: [] };
	let split: { hold: string[]; remove: string[] };
	try {
		const needs = await snapshotFileNeeds(deps, householdId);
		split = splitFilesForClear(keys, new Set(needs.flatMap((needed) => [...needed])));
	} catch (error) {
		console.error(`Couldn’t read Household ${householdId}’s snapshots; keeping its files`, error);
		split = { hold: keys, remove: [] };
	}
	// Listed first: a file left behind unlisted would never be deleted.
	await holdFiles(deps.backups, householdId, split.hold);
	for (let i = 0; i < split.remove.length; i += PAGE)
		await deps.files.delete(split.remove.slice(i, i + PAGE));
	return { removed: split.remove, held: split.hold };
}

/** As much of the STATEMENTS bucket as an upload needs. */
export type UploadBucket<Options> = {
	head(key: string): Promise<unknown | null>;
	put(key: string, value: string, options?: Options): Promise<unknown>;
};

/**
 * Keeps an uploaded statement's file, unless one is already kept under its key. A key carries the
 * Import's own id, so a file found there is this same upload sent again, or, after a Fresh start,
 * the file a kept snapshot refers to: that one is what a restore must find, so it is never written
 * over, whatever the upload tried again carries (issue 88). Returns whether it wrote.
 */
export async function putStatementFileOnce<Options>(
	files: UploadBucket<Options>,
	key: string,
	content: string,
	options?: Options,
): Promise<boolean> {
	if (await files.head(key)) return false;
	await files.put(key, content, options);
	return true;
}

/**
 * The nightly run's part, after snapshots are pruned: every living Household's held files, then
 * deleted Households' last snapshots that are 30 days old, each with the files left for it. One
 * Household failing is logged and the rest carry on.
 */
export async function releaseAllHeldFiles(deps: ReleaseDeps, now: Date) {
	const living = new Set(
		(await deps.db.select({ id: households.id }).from(households)).map((row) => row.id),
	);
	let removed = 0;
	let failed = 0;
	for (const householdId of living) {
		try {
			removed += (await releaseHeldFiles(deps, householdId)).removed;
		} catch (error) {
			failed++;
			console.error(`Couldn’t release Household ${householdId}’s held files`, error);
		}
	}
	const lastSnapshots = await pruneFinalSnapshots(deps.backups, now, async (householdId) => {
		// Only ever a Household that is gone: a living one's files are its own.
		if (living.has(householdId)) return;
		await clearHouseholdFiles(deps.files, householdId);
	});
	return { removed, failed, lastSnapshots: lastSnapshots.length };
}
