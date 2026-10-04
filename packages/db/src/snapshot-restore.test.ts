import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { clearHouseholdRows } from "./fresh-start";
import type { Db } from "./index";
import * as s from "./schema";
import { buildSeed, type SeedOptions, writeSeed } from "./seed";
import {
	exportHouseholdRows,
	restoreHouseholdRows,
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

	it("refuses another Household's snapshot, another format, or an older schema, plainly", () => {
		const file = fileOf(ours, {});
		expect(snapshotRefusal(file, ours, "0048_household_snapshots")).toBeNull();
		expect(snapshotRefusal(file, theirs, "0048_household_snapshots")).toMatch(/another Household/);
		expect(snapshotRefusal({ ...file, format: 99 }, ours, "0048_household_snapshots")).toMatch(
			/can’t read/,
		);
		expect(snapshotRefusal(file, ours, "0049_something_newer")).toMatch(
			/before Noodle’s last update/,
		);
	});
});
