import { env } from "cloudflare:workers";
import { listHouseholdSnapshots, listParents } from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { type SnapshotDeps, takeNightlySnapshots, takeSnapshot } from "./snapshot-store";

// Household snapshots (#78, ADR-0035): the history and "Take a snapshot" in Household → Your data.
// Either Parent of the Household (householdMiddleware); a snapshot's contents are never sent.

/** The newest migration applied, so a restore knows which schema a snapshot's rows fit. */
async function newestMigration(db: D1Database): Promise<string | null> {
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
};

/** The Household's snapshots, newest first: when, kind, who, the note, size and a few counts. */
export const getSnapshots = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<SnapshotSummary[]> => {
		const db = getDb();
		const [rows, parents] = await Promise.all([
			listHouseholdSnapshots(db, context.household.id),
			listParents(db, context.household.id),
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

/** The nightly cron's step: a snapshot of every Household, then pruning (ADR-0035). */
export async function runNightlySnapshots(now: Date) {
	const result = await takeNightlySnapshots(await snapshotDeps(), now);
	console.log("Nightly snapshots", JSON.stringify(result));
}
