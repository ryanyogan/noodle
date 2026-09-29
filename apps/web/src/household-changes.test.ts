import { describe, expect, test } from "vitest";
import {
	everyHouseholdChange,
	householdChangesMessage,
	parseHouseholdChanges,
	queryKeysFor,
} from "./household-changes";

describe("queryKeysFor", () => {
	test("maps each change to the Query key it invalidates", () => {
		expect(queryKeysFor(["month:2026-09"])).toEqual([["month", "2026-09"]]);
		expect(queryKeysFor(["months"])).toEqual([["month"]]);
		expect(queryKeysFor(["bucket-uses"])).toEqual([["bucket-uses"]]);
		expect(queryKeysFor(["parents"])).toEqual([["household", "parents"]]);
		expect(queryKeysFor(["viewer"])).toEqual([["viewer"]]);
		expect(queryKeysFor(["goals"])).toEqual([["goals"]]);
	});

	test("every month covers any one month", () => {
		expect(queryKeysFor(["month:2026-09", "months", "month:2026-10"])).toEqual([["month"]]);
		expect(queryKeysFor(["month:2026-09", "bucket-uses", "month:2026-10"])).toEqual([
			["month", "2026-09"],
			["bucket-uses"],
			["month", "2026-10"],
		]);
	});

	test("repeated changes invalidate once", () => {
		expect(queryKeysFor(["parents", "parents", "month:2026-09", "month:2026-09"])).toEqual([
			["household", "parents"],
			["month", "2026-09"],
		]);
	});

	test("catching up covers every Household query", () => {
		expect(queryKeysFor(everyHouseholdChange)).toEqual([
			["month"],
			["bucket-uses"],
			["household", "parents"],
			["household", "members"],
			["for-earlier"],
			["goals"],
			["scenarios"],
			["viewer"],
		]);
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
