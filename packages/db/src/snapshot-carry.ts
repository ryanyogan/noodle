import { getTableColumns } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { HOUSEHOLD_TABLES, type HouseholdTableName } from "./fresh-start";
import { migrationNumber, SNAPSHOT_TABLES, type SnapshotFile, type SnapshotRow } from "./snapshots";

// Carrying a Household snapshot across schema migrations (issue 88, ADR-0048). A snapshot taken
// under an older migration is restored when every migration since only ADDED things: its rows go
// in by column name, a column it lacks takes the table's default, a table it lacks comes back
// empty. A migration that does anything else needs a transform here, and snapshot-carry.test.ts
// fails until it has one.

export type SnapshotTables = Record<string, SnapshotRow[]>;

/** How a snapshot taken before a migration that isn't additive is made to fit after it. */
export type SnapshotTransform = {
	/** The migration's file name without `.sql`, e.g. "0054_rename_note". */
	migration: string;
	/** The snapshot's tables as they were before the migration, returned as they'd be after it. */
	up(tables: SnapshotTables): SnapshotTables;
};

/**
 * One entry per migration that is not additive (see `additiveChanges`). Empty: every migration
 * since snapshots began (0048) has only added columns or tables.
 */
export const SNAPSHOT_TRANSFORMS: readonly SnapshotTransform[] = [];

/**
 * What a Parent should know before restoring a snapshot taken before a migration, when the
 * result differs from what they'd expect; shown in the restore sheet. Keyed like a transform.
 */
export const CARRY_NOTES: Readonly<Record<string, string>> = {
	"0052_account_archive":
		"It was taken before Accounts could be archived, so every Account in it comes back unarchived.",
};

/** Whether a migration lies after the snapshot's and at or before the database's. */
function between(migration: string, from: string | null, to: string | null): boolean {
	const [n, taken, now] = [migrationNumber(migration), migrationNumber(from), migrationNumber(to)];
	return n !== null && taken !== null && now !== null && taken < n && n <= now;
}

/** The lines to show before restoring a snapshot taken under an older migration. */
export function carryNotes(snapshotMigration: string | null, currentMigration: string | null) {
	return Object.entries(CARRY_NOTES)
		.filter(([migration]) => between(migration, snapshotMigration, currentMigration))
		.sort(([a], [b]) => (migrationNumber(a) ?? 0) - (migrationNumber(b) ?? 0))
		.map(([, note]) => note);
}

/**
 * The snapshot's tables as today's schema holds them: every registered transform for a migration
 * since the snapshot was taken, applied in order. With none registered they are the file's own.
 */
export function carriedTables(
	file: Pick<SnapshotFile, "migration" | "tables">,
	currentMigration: string | null,
	transforms: readonly SnapshotTransform[] = SNAPSHOT_TRANSFORMS,
): SnapshotTables {
	return transforms
		.filter((transform) => between(transform.migration, file.migration, currentMigration))
		.sort((a, b) => (migrationNumber(a.migration) ?? 0) - (migrationNumber(b.migration) ?? 0))
		.reduce((tables, transform) => transform.up(tables), file.tables);
}

/**
 * Why carried tables still don't fit today's schema, in words a Parent can read; null when they
 * do. A column or table the schema no longer has would be lost silently, so it is refused: rows
 * with fewer columns, and missing tables, are fine.
 */
export function carryRefusal(tables: SnapshotTables): string | null {
	const known = new Set<string>(SNAPSHOT_TABLES);
	for (const [name, rows] of Object.entries(tables)) {
		if (rows.length === 0) continue;
		const columns = known.has(name)
			? new Set(
					Object.values(
						getTableColumns(HOUSEHOLD_TABLES[name as HouseholdTableName]) as Record<
							string,
							SQLiteColumn
						>,
					).map((column) => column.name),
				)
			: null;
		const fits = columns && rows.every((row) => Object.keys(row).every((key) => columns.has(key)));
		if (!fits)
			return "This snapshot holds something Noodle no longer stores the same way, so it can’t be restored. Restore a newer one.";
	}
	return null;
}

export type AdditiveChanges = {
	/** Tables the migration creates, by their SQL names. */
	tables: string[];
	/** Columns it adds to tables that were already there. */
	columns: { table: string; column: string }[];
};

const NAME = '[`"]?(\\w+)[`"]?';
const CREATE_TABLE = new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?${NAME} ?\\(`, "i");
const ADD_COLUMN = new RegExp(`^ALTER TABLE ${NAME} ADD (?:COLUMN )?${NAME} `, "i");
const CREATE_INDEX = new RegExp(`^CREATE INDEX (?:IF NOT EXISTS )?${NAME} ON ${NAME}`, "i");
const CREATE_UNIQUE = new RegExp(`^CREATE UNIQUE INDEX (?:IF NOT EXISTS )?${NAME} ON ${NAME}`, "i");

/**
 * What a migration adds, read from its SQL; null when it does anything but add. Additive means
 * every statement is `CREATE TABLE`, `ALTER TABLE … ADD [COLUMN]`, `CREATE INDEX`, or a
 * `CREATE UNIQUE INDEX` on a table the same migration creates. Anything else (DROP, RENAME,
 * UPDATE, INSERT, a rebuilt table, a unique index on a table that already has rows) could make
 * older rows wrong or unwelcome, so it is not, and neither is a statement this can't read.
 */
export function additiveChanges(migrationSql: string): AdditiveChanges | null {
	const changes: AdditiveChanges = { tables: [], columns: [] };
	const statements = migrationSql
		.replace(/--> statement-breakpoint/g, ";")
		.replace(/--[^\n]*/g, "")
		.split(";")
		.map((statement) => statement.replace(/\s+/g, " ").trim())
		.filter(Boolean);
	for (const statement of statements) {
		const created = CREATE_TABLE.exec(statement);
		const added = ADD_COLUMN.exec(statement);
		const unique = CREATE_UNIQUE.exec(statement);
		if (created?.[1]) changes.tables.push(created[1]);
		else if (added?.[1] && added[2]) changes.columns.push({ table: added[1], column: added[2] });
		else if (unique?.[2] && changes.tables.includes(unique[2])) continue;
		else if (CREATE_INDEX.test(statement)) continue;
		else return null;
	}
	return changes;
}
