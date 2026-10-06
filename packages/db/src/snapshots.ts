import { and, count, desc, eq, getTableColumns, gte, inArray, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
	clearHouseholdRows,
	HOUSEHOLD_TABLES,
	type HouseholdTableName,
	householdColumn,
} from "./fresh-start";
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
	freshStarts: "restoring one could set off Start fresh again",
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
	beforeRuleApplyMax: 3,
	beforeTransactionsDeleteMax: 3,
} as const;

/** How long Delete Household's last snapshot is kept, unless the Parent asked for none. */
export const FINAL_SNAPSHOT_DAYS = 30;

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
 * Snapshots taken before a bulk Rule apply are counted on their own (90 days, at most 3): they
 * never push out a Parent's own, and a Parent's own never push them out.
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
	const beforeRuleApply = newestFirst.filter((snap) => snap.kind === "before-rule-apply");
	// Counted on their own too, so deleting in bulk never pushes out a Parent's own (ADR-0045).
	const beforeDeleting = newestFirst.filter((snap) => snap.kind === "before-transactions-delete");
	const byHand = newestFirst.filter(
		(snap) =>
			snap.kind !== "nightly" &&
			snap.kind !== "before-rule-apply" &&
			snap.kind !== "before-transactions-delete",
	);
	for (const [group, max] of [
		[byHand, SNAPSHOT_RETENTION.byHandMax],
		[beforeRuleApply, SNAPSHOT_RETENTION.beforeRuleApplyMax],
		[beforeDeleting, SNAPSHOT_RETENTION.beforeTransactionsDeleteMax],
	] as const) {
		for (const [i, snap] of group.entries()) {
			if (i >= max || snap.createdAt.getTime() < cutoff) prune.push(snap.id);
		}
	}
	return prune;
}

// Restoring a snapshot (#78, ADR-0035). Only rows with this Household's id are ever touched: the
// clear and every delete are scoped to it, and a snapshot row for another Household is refused.

/** A migration's place in the order they're applied: the number its name starts with. */
export function migrationNumber(name: string | null): number | null {
	const match = name ? /^(\d+)_/.exec(name) : null;
	return match ? Number(match[1]) : null;
}

/**
 * Why a snapshot can't be restored here, going by what its row says, in words a Parent can read;
 * null when it can. One taken under an older migration is carried forward (ADR-0048); whether its
 * rows then fit is `carryRefusal`'s to say, once the file is read.
 */
export function snapshotRefusal(
	file: Pick<SnapshotFile, "format" | "householdId" | "migration">,
	householdId: string,
	currentMigration: string | null,
): string | null {
	if (file.householdId !== householdId) return "This snapshot belongs to another Household.";
	if (file.format !== SNAPSHOT_FORMAT)
		return "This snapshot was saved in a shape this version of Noodle can’t read, so it can’t be restored.";
	if (file.migration === currentMigration) return null;
	const taken = migrationNumber(file.migration);
	const now = migrationNumber(currentMigration);
	if (taken === null || now === null)
		return "Noodle can’t tell which of its updates this snapshot was taken under, so it can’t be restored.";
	// A database rolled back to before the snapshot: its rows may hold what this schema lacks.
	if (taken > now)
		return "This snapshot was taken with a newer version of Noodle than the one running now, so it can’t be restored.";
	return null;
}

/** Tables put back by inserting rows; the Household and its members are updated in place instead. */
export const RESTORED_BY_INSERT = SNAPSHOT_TABLES.filter(
	(name) => name !== "households" && name !== "members",
);

/** D1 binds at most 100 values in one statement. */
const MAX_BOUND = 100;

function storedColumns(name: HouseholdTableName): string[] {
	return Object.values(getTableColumns(HOUSEHOLD_TABLES[name]) as Record<string, SQLiteColumn>).map(
		(column) => column.name,
	);
}

function ownedBy(name: HouseholdTableName, row: SnapshotRow, householdId: string): boolean {
	return row[name === "households" ? "id" : "household_id"] === householdId;
}

function refuseOthers(name: HouseholdTableName, rows: SnapshotRow[], householdId: string) {
	if (rows.some((row) => !ownedBy(name, row, householdId)))
		throw new Error(`Snapshot rows in ${name} belong to another Household`);
}

function insertStatement(
	name: HouseholdTableName,
	columns: string[],
	rows: SnapshotRow[],
	upsert: boolean,
) {
	const cols = sql.join(
		columns.map((c) => sql.identifier(c)),
		sql`, `,
	);
	const values = sql.join(
		rows.map(
			(row) =>
				sql`(${sql.join(
					columns.map((c) => sql`${row[c] ?? null}`),
					sql`, `,
				)})`,
		),
		sql`, `,
	);
	const update = upsert
		? sql` ON CONFLICT (${sql.identifier("id")}) DO UPDATE SET ${sql.join(
				columns
					.filter((c) => c !== "id")
					.map((c) => sql`${sql.identifier(c)} = excluded.${sql.identifier(c)}`),
				sql`, `,
			)}`
		: sql``;
	return sql`INSERT INTO ${HOUSEHOLD_TABLES[name]} (${cols}) VALUES ${values}${update}`;
}

async function insertRows(
	db: Db,
	name: HouseholdTableName,
	rows: SnapshotRow[],
	householdId: string,
	upsert = false,
) {
	refuseOthers(name, rows, householdId);
	// Only the columns the snapshot's rows have: one added by a migration since then is left to
	// the table's default (ADR-0048). A column the table lacks never gets here (carryRefusal).
	const columns = storedColumns(name).filter((column) => rows.some((row) => column in row));
	if (columns.length === 0) return;
	const per = Math.max(1, Math.floor(MAX_BOUND / columns.length));
	for (let i = 0; i < rows.length; i += per)
		await db.run(insertStatement(name, columns, rows.slice(i, i + per), upsert));
}

/** How many rows the Household has in a table now. */
export async function countTableRows(db: Db, name: HouseholdTableName, householdId: string) {
	const [row] = await db
		.select({ n: count() })
		.from(HOUSEHOLD_TABLES[name])
		.where(eq(householdColumn(name), householdId));
	return row?.n ?? 0;
}

/** Step 1: clear the Household's data the way Fresh start does (the Household and members stay). */
export async function clearForRestore(db: Db, householdId: string) {
	await clearHouseholdRows(db, householdId, "fresh-start");
}

/** Step 2: the snapshot's members, added or updated by id. Nobody in the Household now is removed. */
export async function restoreMembers(db: Db, householdId: string, rows: SnapshotRow[]) {
	await insertRows(db, "members", rows, householdId, true);
}

/**
 * Step 3, one table at a time (parents before children): the Household's rows in it are deleted,
 * then the snapshot's inserted in batches, so a retried step starts over cleanly. Throws when the
 * count afterwards doesn't match the snapshot's.
 */
export async function restoreTable(
	db: Db,
	householdId: string,
	name: HouseholdTableName,
	rows: SnapshotRow[],
): Promise<number> {
	refuseOthers(name, rows, householdId);
	await db.delete(HOUSEHOLD_TABLES[name]).where(eq(householdColumn(name), householdId));
	await insertRows(db, name, rows, householdId);
	const n = await countTableRows(db, name, householdId);
	if (n !== rows.length)
		throw new Error(`Restored ${n} of ${rows.length} rows in ${name}; expected them all`);
	return n;
}

/** Step 4: the Household's own row (its settings and emergency Goal), last, once its Goals exist. */
export async function restoreHouseholdRow(db: Db, householdId: string, rows: SnapshotRow[]) {
	const [row] = rows;
	if (!row || rows.length !== 1) throw new Error("A snapshot holds exactly one Household row");
	await insertRows(db, "households", [row], householdId, true);
}

/** Every step at once: for tests and small Households. The Workflow runs them one by one. */
export async function restoreHouseholdRows(db: Db, householdId: string, file: SnapshotFile) {
	await clearForRestore(db, householdId);
	await restoreMembers(db, householdId, file.tables.members ?? []);
	for (const name of RESTORED_BY_INSERT)
		await restoreTable(db, householdId, name, file.tables[name] ?? []);
	await restoreHouseholdRow(db, householdId, file.tables.households ?? []);
}
