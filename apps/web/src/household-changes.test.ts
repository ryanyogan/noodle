import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
	everyHouseholdChange,
	householdChangesMessage,
	parseHouseholdChanges,
	queryKeysFor,
	snapshotsKey,
} from "./household-changes";

describe("queryKeysFor", () => {
	test("maps each change to the Query key it invalidates", () => {
		expect(queryKeysFor(["month:2026-09"])).toEqual([
			["month", "2026-09"],
			["month", "commitments"],
			["month", "buckets"],
			["month", "outlook"],
			["reports"],
		]);
		expect(queryKeysFor(["months"])).toEqual([["month"], ["reports"]]);
		expect(queryKeysFor(["bucket-uses"])).toEqual([["bucket-uses"]]);
		expect(queryKeysFor(["parents"])).toEqual([["household", "parents"]]);
		expect(queryKeysFor(["viewer"])).toEqual([["viewer"]]);
		expect(queryKeysFor(["goals"])).toEqual([["goals"], ["month", "outlook"], ["reports"]]);
	});

	test("every month covers any one month", () => {
		expect(queryKeysFor(["month:2026-09", "months", "month:2026-10"])).toEqual([
			["month"],
			["reports"],
		]);
		expect(queryKeysFor(["month:2026-09", "bucket-uses", "month:2026-10"])).toEqual([
			["month", "2026-09"],
			["bucket-uses"],
			["month", "2026-10"],
			["month", "commitments"],
			["month", "buckets"],
			["month", "outlook"],
			["reports"],
		]);
	});

	test("repeated changes invalidate once", () => {
		expect(queryKeysFor(["parents", "parents", "month:2026-09", "month:2026-09"])).toEqual([
			["household", "parents"],
			["month", "2026-09"],
			["month", "commitments"],
			["month", "buckets"],
			["month", "outlook"],
			["reports"],
		]);
	});

	test("Reports refetch when what they sum changes", () => {
		expect(queryKeysFor(["imports"])).toEqual([["imports"], ["reports"]]);
		expect(queryKeysFor(["parents"])).toEqual([["household", "parents"]]);
	});

	test("catching up covers every Household query", () => {
		expect(queryKeysFor(everyHouseholdChange)).toEqual([
			["month"],
			["bucket-uses"],
			["household", "parents"],
			["household", "members"],
			["for-earlier"],
			["goals"],
			["imports"],
			["bank-connections"],
			["scenarios"],
			["viewer"],
			["rules"],
			["insights"],
			["suggestions"],
			["perks"],
			["month", "check-in"],
			["receipt-address"],
			["export"],
			["fresh-start"],
			["month", "plan-draft"],
			["setup"],
			["reports"],
			["snapshots"],
		]);
	});

	test("a snapshot taken before a Rule was applied refetches the snapshot history and the Log, and nothing else", () => {
		expect(queryKeysFor(["snapshots"])).toEqual([["snapshots"], ["month", "log"]]);
		expect(parseHouseholdChanges(householdChangesMessage(["snapshots"]))).toEqual(["snapshots"]);
		// The history's own query is declared beside its page; the two keys must stay the same.
		const page = readFileSync(
			new URL("./components/household-snapshots.tsx", import.meta.url),
			"utf8",
		);
		expect(page).toContain(`queryKey: ${JSON.stringify(snapshotsKey)}`);
	});
});

describe("parseHouseholdChanges", () => {
	test("reads back what the Household Agent broadcasts", () => {
		const changes = ["month:2026-09", "bucket-uses"] as const;
		expect(parseHouseholdChanges(householdChangesMessage(changes))).toEqual(changes);
	});

	test("ignores anything it doesn't recognise", () => {
		expect(parseHouseholdChanges("pong")).toEqual([]);
		expect(parseHouseholdChanges(new ArrayBuffer(4))).toEqual([]);
		expect(parseHouseholdChanges(JSON.stringify({ changes: "months" }))).toEqual([]);
		expect(
			parseHouseholdChanges(
				JSON.stringify({ changes: ["months", "month:2026-13", "transactions", 4, "viewer"] }),
			),
		).toEqual(["months", "viewer"]);
	});
});
