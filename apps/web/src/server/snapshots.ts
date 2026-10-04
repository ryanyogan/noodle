import { env } from "cloudflare:workers";
import {
	listHouseholdSnapshots,
	listParents,
	loadActiveFreshStart,
	SNAPSHOT_FORMAT,
	snapshotRefusal,
} from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import type { RestoreOutput } from "./snapshot-restore-workflow";
import {
	newestMigration,
	readSnapshot,
	type SnapshotDeps,
	takeSnapshot,
} from "./snapshot-store";

// Household snapshots (#78, ADR-0035): the history and "Take a snapshot" in Household → Your data.
// Either Parent of the Household (householdMiddleware); a snapshot's contents are never sent.
// Only server functions are exported here: the Household page imports this file, and anything
// else exported would pull `cloudflare:workers` into the browser (the cron's step is in
// snapshot-nightly.ts).

async function snapshotDeps(): Promise<SnapshotDeps> {
	return { db: getDb(), bucket: env.BACKUPS, migration: await newestMigration(env.DB) };
}

export type SnapshotSummary = {
	id: string;
	kind: "nightly" | "manual" | "before-restore" | "before-fresh-start" | "before-delete";
	takenBy: string | null;
	note: string | null;
	bytes: number;
	createdAt: number;
	counts: { transactions: number; buckets: number; goals: number; accounts: number };
	/** Taken with today's schema, so it can be restored (an older one is refused, ADR-0035). */
	restorable: boolean;
};

/** The Household's snapshots, newest first: when, kind, who, the note, size and a few counts. */
export const getSnapshots = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<SnapshotSummary[]> => {
		const db = getDb();
		const [rows, parents, migration] = await Promise.all([
			listHouseholdSnapshots(db, context.household.id),
			listParents(db, context.household.id),
			newestMigration(env.DB),
		]);
		const nameOf = new Map(parents.map((parent) => [parent.id, parent.name]));
		return rows.map((row) => ({
			id: row.id,
			kind: row.kind,
			takenBy: row.takenBy ? (nameOf.get(row.takenBy) ?? "A Parent") : null,
			note: row.note,
			bytes: row.bytes,
			createdAt: row.createdAt.getTime(),
			counts: {
				transactions: row.rowCounts.transactions ?? 0,
				buckets: row.rowCounts.buckets ?? 0,
				goals: row.rowCounts.goals ?? 0,
				accounts: row.rowCounts.accounts ?? 0,
			},
			restorable: row.format === SNAPSHOT_FORMAT && row.migration === migration,
		}));
	});

/** A Parent takes a snapshot now, with an optional note; at most one a minute. */
export const takeSnapshotNow = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ note: z.string().max(200).optional() }))
	.handler(async ({ data, context }) => {
		const householdId = context.household.id;
		const now = new Date();
		const [latest] = await listHouseholdSnapshots(getDb(), householdId);
		if (latest && latest.kind === "manual" && now.getTime() - latest.createdAt.getTime() < 60_000) {
			return { ok: false as const, reason: "One was just taken. Try again in a minute." };
		}
		const row = await takeSnapshot(await snapshotDeps(), {
			householdId,
			kind: "manual",
			takenBy: context.parent.id,
			note: data.note,
			now,
		});
		return { ok: true as const, id: row.id };
	});

const RUNNING = new Set(["queued", "running", "waiting", "paused", "waitingForPause"]);

/**
 * A Parent restores a snapshot after typing the Household's name. Refused plainly when it can't
 * be (another Household's, an older schema, a Fresh start or another restore under way); else a
 * "Before restore" snapshot is taken first and the restore Workflow started, under that one's id.
 */
export const restoreSnapshot = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ id: z.string().min(1).max(64), typedName: z.string().max(200) }))
	.handler(async ({ data, context }) => {
		const db = getDb();
		const householdId = context.household.id;
		if (data.typedName.trim() !== context.household.name.trim())
			return { ok: false as const, reason: "Type the Household’s name exactly to restore." };
		const snapshots = await listHouseholdSnapshots(db, householdId);
		const snapshot = snapshots.find((row) => row.id === data.id);
		if (!snapshot) return { ok: false as const, reason: "That snapshot is gone." };
		if (await loadActiveFreshStart(db, householdId))
			return { ok: false as const, reason: "A Fresh start is under way. Restore once it’s done." };
		const latestRestore = snapshots.find((row) => row.kind === "before-restore");
		if (latestRestore && Date.now() - latestRestore.createdAt.getTime() < 60 * 60_000) {
			const status = await env.RESTORE.get(latestRestore.id)
				.then((instance) => instance.status())
				.catch(() => null);
			if (status && RUNNING.has(status.status))
				return { ok: false as const, reason: "A restore is already under way." };
		}
		const deps = await snapshotDeps();
		const file = await readSnapshot(env.BACKUPS, snapshot.key);
		if (!file) return { ok: false as const, reason: "That snapshot’s file is gone." };
		const refusal = snapshotRefusal(file, householdId, deps.migration);
		if (refusal) return { ok: false as const, reason: refusal };
		const before = await takeSnapshot(deps, {
			householdId,
			kind: "before-restore",
			takenBy: context.parent.id,
			note: `Before restoring the snapshot from ${snapshot.createdAt.toISOString().slice(0, 10)}`,
			now: new Date(),
		});
		await env.RESTORE.create({
			id: before.id,
			params: {
				householdId,
				snapshotId: snapshot.id,
				key: snapshot.key,
				takenAt: snapshot.createdAt.getTime(),
				parentId: context.parent.id,
			},
		});
		return { ok: true as const, restoreId: before.id };
	});

/** How a restore this Household started is going: running, done, or refused or failed. */
export const getRestoreStatus = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ id: z.string().min(1).max(64) }))
	.handler(async ({ data, context }) => {
		const mine = (await listHouseholdSnapshots(getDb(), context.household.id)).some(
			(row) => row.id === data.id && row.kind === "before-restore",
		);
		if (!mine) return { state: "failed" as const, reason: "That restore isn’t this Household’s." };
		const status = await (await env.RESTORE.get(data.id)).status();
		if (RUNNING.has(status.status)) return { state: "running" as const };
		const output = status.output as RestoreOutput | undefined;
		if (status.status === "complete" && output?.ok) return { state: "done" as const };
		return {
			state: "failed" as const,
			reason:
				output && !output.ok
					? output.reason
					: "The restore stopped part way. Your data from just before is in the snapshot taken first; restore that one, or try again.",
		};
	});
