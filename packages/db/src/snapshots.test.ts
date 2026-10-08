import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { beforeAll, describe, expect, it } from "vitest";
import { HOUSEHOLD_TABLES } from "./fresh-start";
import type { Db } from "./index";
import * as s from "./schema";
import { buildSeed, type SeedOptions, writeSeed } from "./seed";
import {
	exportHouseholdRows,
	NOT_SNAPSHOTTED,
	SNAPSHOT_TABLES,
	type SnapshotKind,
	snapshotsToPrune,
} from "./snapshots";
import { testDb } from "./test-db";

// A Household snapshot (#78, ADR-0035) must hold every table the Household's data lives in, and
// only that Household's rows.

const tables = Object.values(s).filter((v) => is(v, SQLiteTable)) as SQLiteTable[];
const nameOf = (table: SQLiteTable) => getTableConfig(table).name;

describe("a snapshot's tables", () => {
	it("holds every table with a household_id, unless it's left out with a reason", () => {
		const snapshotted = new Set(SNAPSHOT_TABLES.map((name) => nameOf(HOUSEHOLD_TABLES[name])));
		const leftOut = new Set(
			Object.keys(NOT_SNAPSHOTTED).map((name) =>
				nameOf(HOUSEHOLD_TABLES[name as keyof typeof HOUSEHOLD_TABLES]),
			),
		);
		const scoped = tables
			.filter((table) => getTableConfig(table).columns.some((c) => c.name === "household_id"))
			.map(nameOf);
		const missing = scoped.filter((name) => !snapshotted.has(name) && !leftOut.has(name));
		expect(missing).toEqual([]);
		expect(snapshotted.has("households")).toBe(true);
	});

	it("leaves out only the snapshot list, Fresh starts, one-time passes that ran, the Log's record and the bell's", () => {
		expect(Object.keys(NOT_SNAPSHOTTED).sort()).toEqual([
			"bellSeen",
			"freshStarts",
			"householdPasses",
			"householdSnapshots",
			"logEvents",
			"sentNudges",
		]);
		for (const name of SNAPSHOT_TABLES) expect(HOUSEHOLD_TABLES[name]).toBeDefined();
	});
});

describe("exporting a Household's rows", () => {
	let db: Db;
	let householdId: string;
	beforeAll(async () => {
		db = testDb();
		const rows = buildSeed("busy", {
			today: "2026-09-30",
			now: Date.parse("2026-09-30T18:00:00Z"),
			timeZone: "America/Los_Angeles",
			parents: [
				{ clerkUserId: "user_alex", name: "Alex", email: "alex@example.com" },
				{ clerkUserId: "user_sam", name: "Sam", email: "sam@example.com" },
			],
		} as SeedOptions);
		await writeSeed(db, rows);
		householdId = rows.households[0]?.id as string;
	});

	it("takes every row of the Household, as the database stores it", async () => {
		const { tables: exported, rowCounts } = await exportHouseholdRows(db, householdId);
		expect(rowCounts.transactions).toBeGreaterThan(50);
		expect(rowCounts.members).toBe(4);
		for (const name of SNAPSHOT_TABLES) {
			const rows = exported[name] ?? [];
			expect(rows.length).toBe(rowCounts[name]);
			for (const row of rows) {
				expect(name === "households" ? row.id : row.household_id).toBe(householdId);
				for (const value of Object.values(row))
					expect(["string", "number", "object"]).toContain(typeof value);
			}
		}
		const transaction = exported.transactions?.[0];
		expect(typeof transaction?.created_at).toBe("number");
		expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);
	});

	it("takes nothing from a Household that isn't this one", async () => {
		const { rowCounts } = await exportHouseholdRows(db, "01OTHERHOUSEHOLD0000000000");
		expect(Object.values(rowCounts).every((n) => n === 0)).toBe(true);
	});
});

describe("keeping snapshots", () => {
	const DAY = 24 * 60 * 60 * 1000;
	const now = new Date("2026-10-04T09:00:00Z");
	const snap = (id: string, kind: SnapshotKind, daysAgo: number) => ({
		id,
		kind,
		createdAt: new Date(now.getTime() - daysAgo * DAY),
	});

	it("keeps 14 nightly, then one a week for 8 weeks", () => {
		const nightly = Array.from({ length: 120 }, (_, i) => snap(`n${i}`, "nightly", i));
		const pruned = new Set(snapshotsToPrune(nightly, now));
		const kept = nightly.filter((n) => !pruned.has(n.id));
		expect(kept.slice(0, 14).map((n) => n.id)).toEqual(
			Array.from({ length: 14 }, (_, i) => `n${i}`),
		);
		expect(kept.length).toBe(22);
		// The weekly ones are a week apart.
		const weekly = kept.slice(14).map((n) => n.createdAt.getTime());
		for (let i = 1; i < weekly.length; i++)
			expect((weekly[i - 1] ?? 0) - (weekly[i] ?? 0)).toBe(7 * DAY);
	});

	it("keeps manual and before-action ones for 90 days, at most 20", () => {
		const manual = [
			snap("old", "manual", 91),
			snap("recent", "manual", 89),
			snap("before", "before-restore", 1),
		];
		expect(snapshotsToPrune(manual, now)).toEqual(["old"]);
		const many = Array.from({ length: 25 }, (_, i) => snap(`m${i}`, "manual", i));
		expect(snapshotsToPrune(many, now)).toEqual(["m20", "m21", "m22", "m23", "m24"]);
	});

	it("never prunes nightly ones to make room for manual ones", () => {
		const mixed = [
			...Array.from({ length: 14 }, (_, i) => snap(`n${i}`, "nightly", i)),
			...Array.from({ length: 20 }, (_, i) => snap(`m${i}`, "manual", i)),
		];
		expect(snapshotsToPrune(mixed, now)).toEqual([]);
	});

	it("keeps the newest 3 taken before applying a Rule, for 90 days, counted on their own", () => {
		const rules = Array.from({ length: 5 }, (_, i) => snap(`r${i}`, "before-rule-apply", i));
		expect(snapshotsToPrune(rules, now)).toEqual(["r3", "r4"]);
		expect(
			snapshotsToPrune(
				[snap("old", "before-rule-apply", 91), snap("recent", "before-rule-apply", 89)],
				now,
			),
		).toEqual(["old"]);
	});

	it("never prunes a Parent's own to make room for ones before a Rule, nor the other way", () => {
		// 20 of a Parent's own (and other before-action ones), all older than 30 newer Rule ones.
		const own = Array.from({ length: 20 }, (_, i) =>
			snap(`m${i}`, i % 2 ? "manual" : "before-restore", 40 + i),
		);
		const rules = Array.from({ length: 30 }, (_, i) => snap(`r${i}`, "before-rule-apply", i));
		const pruned = snapshotsToPrune([...own, ...rules], now);
		expect(pruned).toEqual(rules.slice(3).map((r) => r.id));
		// And 25 newer ones of a Parent's own leave the 3 older Rule ones alone.
		const newer = Array.from({ length: 25 }, (_, i) => snap(`m${i}`, "manual", i));
		const olderRules = Array.from({ length: 3 }, (_, i) =>
			snap(`r${i}`, "before-rule-apply", 50 + i),
		);
		expect(snapshotsToPrune([...newer, ...olderRules], now)).toEqual([
			"m20",
			"m21",
			"m22",
			"m23",
			"m24",
		]);
	});
});
