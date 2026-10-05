import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { clearHouseholdRows } from "./fresh-start";
import type { Db } from "./index";
import * as s from "./schema";
import { buildSeed, type SeedOptions, writeSeed } from "./seed";
import {
	clearForRestore,
	exportHouseholdRows,
	RESTORED_BY_INSERT,
	restoreHouseholdRows,
	restoreMembers,
	restoreTable,
	SNAPSHOT_FORMAT,
	type SnapshotFile,
	snapshotRefusal,
} from "./snapshots";
import { testDb } from "./test-db";

// Restoring a Household snapshot (#78, ADR-0035) puts back exactly what was there, and touches
// no other Household's rows.

async function seedHousehold(
	db: Db,
	who: string,
	today: string,
	idPrefix: string,
): Promise<string> {
	const rows = buildSeed("busy", {
		today,
		now: Date.parse(`${today}T18:00:00Z`),
		timeZone: "America/Los_Angeles",
		parents: [
			{ clerkUserId: `user_${who}_1`, name: `${who} One`, email: `${who}1@example.com` },
			{ clerkUserId: `user_${who}_2`, name: `${who} Two`, email: `${who}2@example.com` },
		],
	} as SeedOptions);
	// The seed's ids are fixed, so the second Household's get a prefix of their own.
	const prefix = rows.households[0]?.id.slice(0, 8) ?? "";
	for (const list of Object.values(rows) as Record<string, unknown>[][])
		for (const row of list)
			for (const [key, value] of Object.entries(row))
				if (typeof value === "string" && value.startsWith(prefix))
					row[key] = `${idPrefix}${value.slice(prefix.length)}`;
	const household = rows.households[0];
	if (household) household.receiptAddress = `${who}-receipts`;
	await writeSeed(db, rows);
	return rows.households[0]?.id as string;
}

const fileOf = (householdId: string, tables: SnapshotFile["tables"]): SnapshotFile => ({
	format: SNAPSHOT_FORMAT,
	householdId,
	takenAt: "2026-09-30T18:00:00.000Z",
	migration: "0048_household_snapshots",
	tables,
});

describe("restoring a snapshot", () => {
	let db: Db;
	let ours: string;
	let theirs: string;
	beforeAll(async () => {
		db = testDb();
		ours = await seedHousehold(db, "alex", "2026-09-30", "01AAAAAA");
		theirs = await seedHousehold(db, "jo", "2025-03-14", "01BBBBBB");
	});

	it("brings every row back after the data changed, and leaves the other Household alone", async () => {
		const before = await exportHouseholdRows(db, ours);
		const theirsBefore = await exportHouseholdRows(db, theirs);
		expect(before.rowCounts.transactions).toBeGreaterThan(50);

		// A Fresh start, a renamed Household and a renamed Parent since the snapshot.
		await clearHouseholdRows(db, ours, "fresh-start");
		await db.update(s.households).set({ name: "Changed" }).where(eq(s.households.id, ours));
		await db.update(s.members).set({ name: "Renamed" }).where(eq(s.members.householdId, ours));
		expect((await exportHouseholdRows(db, ours)).rowCounts.transactions).toBe(0);

		await restoreHouseholdRows(db, ours, fileOf(ours, before.tables));

		const after = await exportHouseholdRows(db, ours);
		expect(after.rowCounts).toEqual(before.rowCounts);
		expect(after.tables).toEqual(before.tables);
		expect(await exportHouseholdRows(db, theirs)).toEqual(theirsBefore);
	});

	it("can run again over itself (a retried Workflow step)", async () => {
		const before = await exportHouseholdRows(db, ours);
		await restoreHouseholdRows(db, ours, fileOf(ours, before.tables));
		await restoreHouseholdRows(db, ours, fileOf(ours, before.tables));
		expect((await exportHouseholdRows(db, ours)).tables).toEqual(before.tables);
	});

	it("refuses rows that belong to another Household", async () => {
		const { tables } = await exportHouseholdRows(db, theirs);
		const before = await exportHouseholdRows(db, ours);
		await expect(restoreTable(db, ours, "buckets", tables.buckets ?? [])).rejects.toThrow(
			/another Household/,
		);
		// Refused before anything was deleted, on either side.
		expect((await exportHouseholdRows(db, ours)).tables).toEqual(before.tables);
		expect((await exportHouseholdRows(db, theirs)).tables).toEqual(tables);
	});

	it("stopped part way, is whole again from the “Before restore” snapshot, and can be tried again", async () => {
		const older = await exportHouseholdRows(db, ours);
		// Changes since that snapshot, then the snapshot a restore takes first.
		await db.update(s.households).set({ name: "Since" }).where(eq(s.households.id, ours));
		await db.update(s.members).set({ name: "Since" }).where(eq(s.members.householdId, ours));
		await db
			.update(s.transactions)
			.set({ note: "Since the snapshot" })
			.where(eq(s.transactions.householdId, ours));
		const beforeRestore = await exportHouseholdRows(db, ours);
		expect(beforeRestore.tables).not.toEqual(older.tables);
		const theirsBefore = await exportHouseholdRows(db, theirs);

		// The Workflow's steps in order, as far as half the tables; then it stops (retries used up).
		await clearForRestore(db, ours);
		await restoreMembers(db, ours, older.tables.members ?? []);
		const present = RESTORED_BY_INSERT.filter((name) => (older.tables[name] ?? []).length > 0);
		expect(present.length).toBeGreaterThan(3);
		for (const name of present.slice(0, Math.ceil(present.length / 2)))
			await restoreTable(db, ours, name, older.tables[name] ?? []);
		const partWay = await exportHouseholdRows(db, ours);
		expect(partWay.rowCounts).not.toEqual(older.rowCounts);
		expect(partWay.rowCounts).not.toEqual(beforeRestore.rowCounts);

		// What was there just before the restore comes back whole.
		await restoreHouseholdRows(db, ours, fileOf(ours, beforeRestore.tables));
		expect((await exportHouseholdRows(db, ours)).tables).toEqual(beforeRestore.tables);
		// And the restore that stopped starts clean when asked for again.
		await restoreHouseholdRows(db, ours, fileOf(ours, older.tables));
		expect((await exportHouseholdRows(db, ours)).tables).toEqual(older.tables);
		expect(await exportHouseholdRows(db, theirs)).toEqual(theirsBefore);
	});

	it("refuses another Household's snapshot, another format, or a newer schema, plainly", () => {
		const file = fileOf(ours, {});
		expect(snapshotRefusal(file, ours, "0048_household_snapshots")).toBeNull();
		expect(snapshotRefusal(file, theirs, "0048_household_snapshots")).toMatch(/another Household/);
		expect(snapshotRefusal({ ...file, format: 99 }, ours, "0048_household_snapshots")).toMatch(
			/can’t read/,
		);
		// Taken under an older migration: carried forward (ADR-0048, snapshot-carry.test.ts).
		expect(snapshotRefusal(file, ours, "0049_something_newer")).toBeNull();
		expect(snapshotRefusal(file, ours, "0047_perk_value_by_hand.sql")).toMatch(/newer version/);
	});

	it("restores a snapshot from before Transactions had a version, each starting at 0 (issue 88)", async () => {
		const { tables } = await exportHouseholdRows(db, ours);
		// As a snapshot taken before 0049 holds them: no `version` on its Transactions.
		const old = (tables.transactions ?? []).map(({ version: _version, ...row }) => row);
		expect(old.length).toBeGreaterThan(50);
		const file = { ...fileOf(ours, { ...tables, transactions: old }) };
		expect(file.migration).toBe("0048_household_snapshots");
		// Both ways into a restore (the server function and the Workflow's first step) ask this,
		// with the file names as D1 records them.
		expect(snapshotRefusal(file, ours, "0049_transaction_version.sql")).toBeNull();
		await restoreHouseholdRows(db, ours, file);
		const after = await db
			.select()
			.from(s.transactions)
			.where(eq(s.transactions.householdId, ours));
		expect(after.every((row) => row.version === 0)).toBe(true);
	});
});
