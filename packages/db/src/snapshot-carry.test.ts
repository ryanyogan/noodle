import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, getTableName } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { clearHouseholdRows, HOUSEHOLD_TABLES, type HouseholdTableName } from "./fresh-start";
import type { Db } from "./index";
import * as s from "./schema";
import { buildSeed, type SeedOptions, writeSeed } from "./seed";
import {
	additiveChanges,
	CARRY_NOTES,
	carriedTables,
	carryNotes,
	carryRefusal,
	SNAPSHOT_TRANSFORMS,
	type SnapshotTables,
	type SnapshotTransform,
} from "./snapshot-carry";
import {
	exportHouseholdRows,
	migrationNumber,
	restoreHouseholdRows,
	SNAPSHOT_FORMAT,
	type SnapshotFile,
	snapshotRefusal,
} from "./snapshots";
import { testDb } from "./test-db";

// Carrying a snapshot across migrations (issue 88, ADR-0048): one taken under an older migration
// is restored into today's database, and a migration that would break that can't be added
// without saying how older snapshots are carried over it.

/** The migration snapshots began with: none is older, so earlier migrations aren't looked at. */
const FIRST_WITH_SNAPSHOTS = 48;

const dir = join(import.meta.dirname, "..", "drizzle");
const migrations = readdirSync(dir)
	.filter((name) => name.endsWith(".sql"))
	.sort()
	.map((name) => ({
		tag: name.replace(/\.sql$/, ""),
		number: migrationNumber(name) ?? -1,
		sql: readFileSync(join(dir, name), "utf8"),
	}));
const since = migrations.filter((migration) => migration.number > FIRST_WITH_SNAPSHOTS);
const newest = migrations.at(-1)?.tag ?? "";

describe("every migration since snapshots began", () => {
	it("only adds columns and tables, or says how an older snapshot is carried over it", () => {
		const unhandled = since
			.filter(
				(migration) =>
					additiveChanges(migration.sql) === null &&
					!SNAPSHOT_TRANSFORMS.some((transform) => transform.migration === migration.tag),
			)
			.map((migration) => migration.tag);
		// A migration named here does more than CREATE TABLE / ALTER TABLE … ADD / CREATE INDEX, so
		// a Household snapshot taken before it could no longer be restored as it is. Add an entry
		// for it to SNAPSHOT_TRANSFORMS in snapshot-carry.ts (see "a migration that isn't additive"
		// below and ADR-0048) that turns the older tables into today's; never just skip this.
		expect(unhandled).toEqual([]);
	});

	it("is what every transform and note is named after", () => {
		const tags = new Set(since.map((migration) => migration.tag));
		for (const transform of SNAPSHOT_TRANSFORMS) expect(tags).toContain(transform.migration);
		for (const tag of Object.keys(CARRY_NOTES)) expect(tags).toContain(tag);
	});

	it("so far is 0049 to 0053, all additive", () => {
		const added = Object.fromEntries(
			since.slice(0, 5).map((migration) => [migration.tag, additiveChanges(migration.sql)]),
		);
		expect(added).toEqual({
			"0049_transaction_version": {
				tables: [],
				columns: [{ table: "transactions", column: "version" }],
			},
			"0050_bank_history_start": {
				tables: [],
				columns: [
					{ table: "bank_connections", column: "history_start" },
					{ table: "bank_link_sessions", column: "history_start" },
				],
			},
			"0051_deleted_bank_lines": { tables: ["deleted_bank_lines"], columns: [] },
			"0052_account_archive": {
				tables: [],
				columns: [{ table: "accounts", column: "archived_at" }],
			},
			"0053_perk_pages": { tables: ["perk_pages"], columns: [] },
		});
	});
});

describe("reading a migration's SQL", () => {
	it("calls adding a table, a column or an index additive", () => {
		expect(
			additiveChanges(
				"CREATE TABLE `notes` (\n\t`id` text PRIMARY KEY NOT NULL\n);\n--> statement-breakpoint\n" +
					"CREATE UNIQUE INDEX `notes_id` ON `notes` (`id`);--> statement-breakpoint\n" +
					"CREATE INDEX `buckets_name` ON `buckets` (`name`);\n" +
					"ALTER TABLE `buckets` ADD COLUMN `colour` text;",
			),
		).toEqual({ tables: ["notes"], columns: [{ table: "buckets", column: "colour" }] });
	});

	it.each([
		["a dropped column", "ALTER TABLE `buckets` DROP COLUMN `note`;"],
		["a renamed column", "ALTER TABLE `buckets` RENAME COLUMN `note` TO `memo`;"],
		["a dropped table", "DROP TABLE `moves`;"],
		["rewritten rows", "ALTER TABLE `goals` ADD `kind` text;\nUPDATE `goals` SET `kind` = 'x';"],
		["a unique index on a table with rows", "CREATE UNIQUE INDEX `u` ON `buckets` (`name`);"],
		[
			"a rebuilt table",
			"PRAGMA foreign_keys=OFF;--> statement-breakpoint\nCREATE TABLE `__new_goals` (`id` text);--> statement-breakpoint\nINSERT INTO `__new_goals` SELECT `id` FROM `goals`;--> statement-breakpoint\nDROP TABLE `goals`;--> statement-breakpoint\nALTER TABLE `__new_goals` RENAME TO `goals`;",
		],
	])("calls %s not additive", (_what, sql) => {
		expect(additiveChanges(sql)).toBeNull();
	});
});

async function seedHousehold(db: Db): Promise<string> {
	const today = "2026-09-30";
	const rows = buildSeed("busy", {
		today,
		now: Date.parse(`${today}T18:00:00Z`),
		timeZone: "America/Los_Angeles",
		parents: [
			{ clerkUserId: "user_alex_1", name: "Alex One", email: "alex1@example.com" },
			{ clerkUserId: "user_alex_2", name: "Alex Two", email: "alex2@example.com" },
		],
	} as SeedOptions);
	await writeSeed(db, rows);
	return rows.households[0]?.id as string;
}

/** A snapshot table's name (as the file keys it) from the table's SQL name. */
const keyOf = new Map<string, HouseholdTableName>(
	(Object.keys(HOUSEHOLD_TABLES) as HouseholdTableName[]).map((name) => [
		getTableName(HOUSEHOLD_TABLES[name]),
		name,
	]),
);

/** What every migration after `tag` added to the Household's tables. */
function addedAfter(tag: string) {
	const tables = new Set<string>();
	const columns = new Map<string, Set<string>>();
	for (const migration of since) {
		if (migration.number <= (migrationNumber(tag) ?? 0)) continue;
		const added = additiveChanges(migration.sql);
		if (!added) throw new Error(`${migration.tag} isn't additive: build its fixture by hand`);
		for (const table of added.tables) {
			const key = keyOf.get(table);
			if (key) tables.add(key);
		}
		for (const { table, column } of added.columns) {
			const key = keyOf.get(table);
			if (key) columns.set(key, (columns.get(key) ?? new Set()).add(column));
		}
	}
	return { tables, columns };
}

/** Today's tables as a snapshot taken under `tag` held them: without what was added since. */
function asTakenUnder(tag: string, tables: SnapshotTables): SnapshotTables {
	const added = addedAfter(tag);
	return Object.fromEntries(
		Object.entries(tables)
			.filter(([name]) => !added.tables.has(name))
			.map(([name, rows]) => [
				name,
				rows.map((row) =>
					Object.fromEntries(
						Object.entries(row).filter(([column]) => !added.columns.get(name)?.has(column)),
					),
				),
			]),
	);
}

/** What a column added since the snapshot holds once restored: the table's default, else nothing. */
const DEFAULTS: Record<string, number> = {
	"transactions.version": 0,
	"commitments.carried_balance": 0,
	"income.needs_review": 0,
	"income.version": 0,
	"commitments.about": 0,
};

describe("restoring a snapshot taken under an older migration", () => {
	let db: Db;
	let ours: string;
	let now: SnapshotTables;
	beforeAll(async () => {
		db = testDb();
		ours = await seedHousehold(db);
		// Something in everything today's migrations added, so losing it would show.
		await db.update(s.transactions).set({ version: 3 }).where(eq(s.transactions.householdId, ours));
		await db
			.update(s.accounts)
			.set({ archivedAt: new Date("2026-09-29T12:00:00Z") })
			.where(eq(s.accounts.householdId, ours));
		await db
			.update(s.bankConnections)
			.set({ historyStart: "2026-01-01" })
			.where(eq(s.bankConnections.householdId, ours));
		await db
			.update(s.commitments)
			.set({ carriedBalance: true })
			.where(eq(s.commitments.householdId, ours));
		await db
			.update(s.accountBalances)
			.set({ asOf: "2026-09-01" })
			.where(eq(s.accountBalances.householdId, ours));
		const [account] = await db.select().from(s.accounts).where(eq(s.accounts.householdId, ours));
		await db
			.insert(s.deletedBankLines)
			.values({ householdId: ours, accountId: account?.id as string, externalId: "line-1" });
		now = (await exportHouseholdRows(db, ours)).tables;
		expect(now.transactions?.length).toBeGreaterThan(50);
		expect(now.accounts?.length).toBeGreaterThan(1);
		expect(now.deletedBankLines).toHaveLength(1);
	});

	it.each([
		"0048_household_snapshots",
		"0049_transaction_version",
		"0050_bank_history_start",
		"0051_deleted_bank_lines",
		"0052_account_archive",
		"0053_perk_pages",
	])("one from %s lands whole, with defaults where it has nothing to say", async (tag) => {
		const file: SnapshotFile = {
			format: SNAPSHOT_FORMAT,
			householdId: ours,
			takenAt: "2026-09-30T18:00:00.000Z",
			migration: tag,
			tables: asTakenUnder(tag, now),
		};
		const added = addedAfter(tag);
		// 0054 added columns to Commitments and balances, so every older snapshot lacks something.
		expect(added.tables.size + added.columns.size > 0).toBe(true);
		// D1 records the file's name; the snapshot's own row holds whichever it was given.
		expect(snapshotRefusal(file, ours, `${newest}.sql`)).toBeNull();
		const carried = carriedTables(file, `${newest}.sql`);
		expect(carryRefusal(carried)).toBeNull();

		// Changes since, then the restore: every table in order, foreign keys on.
		await clearHouseholdRows(db, ours, "fresh-start");
		await restoreHouseholdRows(db, ours, { ...file, tables: carried });

		const expected = Object.fromEntries(
			Object.entries(now).map(([name, rows]) => [
				name,
				added.tables.has(name)
					? []
					: rows.map((row) => ({
							...row,
							...Object.fromEntries(
								[...(added.columns.get(name) ?? [])].map((column) => [
									column,
									DEFAULTS[
										`${getTableName(HOUSEHOLD_TABLES[name as HouseholdTableName])}.${column}`
									] ?? null,
								]),
							),
						})),
			]),
		);
		const after = (await exportHouseholdRows(db, ours)).tables;
		expect(after).toEqual(expected);
		// Put today's back for the next one.
		await restoreHouseholdRows(db, ours, { ...file, migration: newest, tables: now });
		expect((await exportHouseholdRows(db, ours)).tables).toEqual(now);
	});

	it("says, before a restore, what comes back differently", () => {
		expect(carryNotes("0051_deleted_bank_lines", `${newest}.sql`)).toEqual([
			"It was taken before Accounts could be archived, so every Account in it comes back unarchived.",
		]);
		expect(carryNotes("0052_account_archive", newest)).toEqual([]);
		expect(carryNotes(newest, newest)).toEqual([]);
	});

	it("refuses one with a column or a table today's schema doesn't have", () => {
		const [first, ...rest] = now.buckets ?? [];
		const withColumn = { ...now, buckets: [{ ...first, colour: "red" }, ...rest] };
		expect(carryRefusal(withColumn)).toMatch(/no longer stores the same way/);
		expect(carryRefusal({ ...now, envelopes: [{ id: "1", household_id: ours }] })).toMatch(
			/can’t be restored/,
		);
		// A table that has gone, with nothing in it, loses nothing.
		expect(carryRefusal({ ...now, envelopes: [] })).toBeNull();
	});

	it("refuses one taken under a newer migration than the database's (a rollback)", () => {
		const file = { format: SNAPSHOT_FORMAT, householdId: ours, migration: newest };
		expect(snapshotRefusal(file, ours, "0050_bank_history_start.sql")).toMatch(/newer version/);
		expect(snapshotRefusal(file, ours, null)).toMatch(/can’t tell/);
		expect(snapshotRefusal({ ...file, migration: null }, ours, newest)).toMatch(/can’t tell/);
	});
});

describe("a migration that isn't additive", () => {
	// How one would be registered: were 0054 to rename `buckets.name` to `buckets.label`, this
	// entry would go in SNAPSHOT_TRANSFORMS and the guard above would pass again.
	const renameNote: SnapshotTransform = {
		migration: "0054_rename_bucket_name",
		up: (tables) => ({
			...tables,
			buckets: (tables.buckets ?? []).map(({ name, ...row }) => ({ ...row, label: name ?? null })),
		}),
	};
	const file = {
		migration: "0053_perk_pages",
		tables: { buckets: [{ id: "b1", household_id: "h1", name: "Groceries" }] },
	};

	it("is carried by its transform, for snapshots taken before it only", () => {
		const after = { buckets: [{ id: "b1", household_id: "h1", label: "Groceries" }] };
		expect(carriedTables(file, "0054_rename_bucket_name.sql", [renameNote])).toEqual(after);
		// Taken after it, or restored into a database that hasn't had it: left as it is.
		const later = { ...file, migration: "0054_rename_bucket_name" };
		expect(carriedTables(later, "0055_next.sql", [renameNote])).toEqual(file.tables);
		expect(carriedTables(file, "0053_perk_pages.sql", [renameNote])).toEqual(file.tables);
	});

	it("without one, leaves rows the schema of the day would refuse", () => {
		const carried = carriedTables(file, "0054_rename_bucket_name.sql", []);
		expect(carried).toEqual(file.tables);
		// Here `name` still exists, so these rows fit; with `label` they wouldn't, and are refused.
		expect(carryRefusal(carried)).toBeNull();
		expect(carryRefusal(renameNote.up(carried))).toMatch(/can’t be restored/);
	});
});
