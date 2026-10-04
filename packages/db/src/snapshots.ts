import { and, desc, eq, getTableColumns, gte, inArray } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { HOUSEHOLD_TABLES, type HouseholdTableName, householdColumn } from "./fresh-start";
import type { Db } from "./index";
import * as s from "./schema";

// Household snapshots (#78, ADR-0035): one Household's rows from every household-scoped table,
// built from Fresh start's table list so the two can't drift apart. snapshots.test.ts fails when
// a listed table is neither snapshotted nor left out with a reason.

/** The file's shape; bump it when the JSON changes shape (the schema itself is `migration`). */
export const SNAPSHOT_FORMAT = 1;

/** Household tables a snapshot leaves out, and why. */
export const NOT_SNAPSHOTTED: Readonly<Partial<Record<HouseholdTableName, string>>> = {
	householdSnapshots: "a snapshot doesn't hold the list of snapshots",
	freshStarts: "restoring one could start a Fresh start again",
};

/** Every table a snapshot holds, parents before children (so a restore inserts in this order). */
export const SNAPSHOT_TABLES = (Object.keys(HOUSEHOLD_TABLES) as HouseholdTableName[]).filter(
	(name) => !(name in NOT_SNAPSHOTTED),
);

export type SnapshotRow = Record<string, string | number | null>;

export type SnapshotFile = {
	format: number;
	householdId: string;
	takenAt: string;
	migration: string | null;
	/** Rows per table, each keyed by column name with the value as the database stores it. */
	tables: Record<string, SnapshotRow[]>;
};

/** A row as the database stores it: column names, timestamps in ms, booleans 0/1, JSON as text. */
function toStored(
	columns: Record<string, SQLiteColumn>,
	row: Record<string, unknown>,
): SnapshotRow {
	const out: SnapshotRow = {};
	for (const [key, column] of Object.entries(columns)) {
		const value = row[key];
		out[column.name] =
			value === null || value === undefined
				? null
				: (column.mapToDriverValue(value) as string | number | null);
	}
	return out;
}

/** The Household's rows in every snapshotted table, and how many each has. */
export async function exportHouseholdRows(
	db: Db,
	householdId: string,
): Promise<{ tables: Record<string, SnapshotRow[]>; rowCounts: Record<string, number> }> {
	const tables: Record<string, SnapshotRow[]> = {};
	const rowCounts: Record<string, number> = {};
	for (const name of SNAPSHOT_TABLES) {
		const table = HOUSEHOLD_TABLES[name];
		const columns = getTableColumns(table) as Record<string, SQLiteColumn>;
		const rows = (await db
			.select()
			.from(table)
			.where(eq(householdColumn(name), householdId))) as Record<string, unknown>[];
		tables[name] = rows.map((row) => toStored(columns, row));
		rowCounts[name] = rows.length;
	}
	return { tables, rowCounts };
}

export type SnapshotKind = s.HouseholdSnapshot["kind"];

export async function recordSnapshot(db: Db, snapshot: typeof s.householdSnapshots.$inferInsert) {
	await db.insert(s.householdSnapshots).values(snapshot);
}

/** The Household's snapshots, newest first. */
export async function listHouseholdSnapshots(db: Db, householdId: string) {
	return db
		.select()
		.from(s.householdSnapshots)
		.where(eq(s.householdSnapshots.householdId, householdId))
		.orderBy(desc(s.householdSnapshots.createdAt), desc(s.householdSnapshots.id));
}

/** Whether the Household already has a nightly snapshot since `since` (a retried cron skips it). */
export async function hasNightlySince(db: Db, householdId: string, since: Date): Promise<boolean> {
	const [row] = await db
		.select({ id: s.householdSnapshots.id })
		.from(s.householdSnapshots)
		.where(
			and(
				eq(s.householdSnapshots.householdId, householdId),
				eq(s.householdSnapshots.kind, "nightly"),
				gte(s.householdSnapshots.createdAt, since),
			),
		)
		.limit(1);
	return Boolean(row);
}

export async function deleteSnapshotRows(db: Db, householdId: string, ids: string[]) {
	if (ids.length === 0) return;
	await db
		.delete(s.householdSnapshots)
		.where(
			and(eq(s.householdSnapshots.householdId, householdId), inArray(s.householdSnapshots.id, ids)),
		);
}

export const SNAPSHOT_RETENTION = {
	nightly: 14,
	weekly: 8,
	byHandDays: 90,
	byHandMax: 20,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The Monday (UTC) that starts a moment's week, as a key. */
function weekOf(ms: number): number {
	const day = new Date(ms);
	const sinceMonday = (day.getUTCDay() + 6) % 7;
	return Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - sinceMonday);
}

/**
 * Which snapshots to delete: keep the newest 14 nightly, then the newest nightly in each of the 8
 * most recent weeks before those; and manual and before-action ones for 90 days, at most 20.
 */
export function snapshotsToPrune(
	snapshots: { id: string; kind: SnapshotKind; createdAt: Date }[],
	now: Date,
): string[] {
	const newestFirst = [...snapshots].sort(
		(a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1),
	);
	const prune: string[] = [];
	const nightly = newestFirst.filter((snap) => snap.kind === "nightly");
	const weeks = new Set<number>();
	for (const [i, snap] of nightly.entries()) {
		if (i < SNAPSHOT_RETENTION.nightly) continue;
		const week = weekOf(snap.createdAt.getTime());
		if (!weeks.has(week) && weeks.size < SNAPSHOT_RETENTION.weekly) weeks.add(week);
		else prune.push(snap.id);
	}
	const cutoff = now.getTime() - SNAPSHOT_RETENTION.byHandDays * DAY_MS;
	const byHand = newestFirst.filter((snap) => snap.kind !== "nightly");
	for (const [i, snap] of byHand.entries()) {
		if (i >= SNAPSHOT_RETENTION.byHandMax || snap.createdAt.getTime() < cutoff) prune.push(snap.id);
	}
	return prune;
}
