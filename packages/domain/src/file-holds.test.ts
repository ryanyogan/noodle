import { describe, expect, it } from "vitest";
import { referencedFiles, splitFilesForClear, splitHeldFiles, whoNeedsFile } from "./file-holds";

// Which statement and Receipt files a kept snapshot still needs (#78, ADR-0035).

const prefixes = ["h1/", "receipts/h1/", "exports/h1/"];

describe("the files a snapshot's rows refer to", () => {
	it("finds every key under the Household's prefixes, whatever the column", () => {
		const tables = {
			imports: [
				{ id: "i1", household_id: "h1", file_key: "h1/sept.csv", file_name: "sept.csv" },
				{ id: "i2", household_id: "h1", file_key: null },
			],
			receipts: [
				{
					id: "r1",
					file_key: "receipts/h1/r1.eml",
					thumbnail_key: "receipts/h1/r1-thumb.webp",
					amount: 1200,
				},
			],
			somethingNew: [{ picture: "receipts/h1/new.jpg" }],
		};
		expect(referencedFiles(tables, prefixes)).toEqual([
			"h1/sept.csv",
			"receipts/h1/new.jpg",
			"receipts/h1/r1-thumb.webp",
			"receipts/h1/r1.eml",
		]);
	});

	it("takes no other Household's keys, no bare prefix and no id that only looks alike", () => {
		const tables = {
			imports: [
				{ id: "h1", file_key: "h2/sept.csv" },
				{ id: "h1/", file_key: "receipts/h2/r.eml" },
				{ id: "x", file_key: "h10/sept.csv", note: "paid h1/ back" },
			],
		};
		expect(referencedFiles(tables, prefixes)).toEqual([]);
	});

	it("lists a file once however many rows refer to it", () => {
		const tables = { a: [{ k: "h1/a.csv" }], b: [{ k: "h1/a.csv" }] };
		expect(referencedFiles(tables, prefixes)).toEqual(["h1/a.csv"]);
	});
});

describe("who still needs a file", () => {
	const live = new Set(["h1/live.csv", "h1/both.csv"]);
	const snapshots = [new Set(["h1/old.csv", "h1/both.csv"]), new Set(["h1/older.csv"])];

	it("is the Household's rows first, then a kept snapshot, then nobody", () => {
		expect(whoNeedsFile("h1/live.csv", live, snapshots)).toBe("rows");
		expect(whoNeedsFile("h1/both.csv", live, snapshots)).toBe("rows");
		expect(whoNeedsFile("h1/old.csv", live, snapshots)).toBe("snapshot");
		expect(whoNeedsFile("h1/older.csv", live, snapshots)).toBe("snapshot");
		expect(whoNeedsFile("h1/gone.csv", live, snapshots)).toBeNull();
	});

	it("keeps a held file while any kept snapshot refers to it", () => {
		const held = ["h1/old.csv", "h1/older.csv", "h1/gone.csv", "h1/live.csv"];
		expect(splitHeldFiles(held, live, snapshots)).toEqual({
			keep: ["h1/live.csv", "h1/old.csv", "h1/older.csv"],
			remove: ["h1/gone.csv"],
		});
	});

	it("lets a file go once its last snapshot has expired", () => {
		const held = ["h1/old.csv", "h1/older.csv"];
		expect(splitHeldFiles(held, new Set(), [snapshots[1] as Set<string>])).toEqual({
			keep: ["h1/older.csv"],
			remove: ["h1/old.csv"],
		});
		expect(splitHeldFiles(held, new Set(), [])).toEqual({ keep: [], remove: held });
	});

	it("keeps a file a restore brought back into use, with no snapshot left", () => {
		expect(splitHeldFiles(["h1/live.csv"], live, [])).toEqual({
			keep: ["h1/live.csv"],
			remove: [],
		});
	});

	it("names a file held twice only once", () => {
		expect(splitHeldFiles(["h1/gone.csv", "h1/gone.csv"], live, snapshots).remove).toEqual([
			"h1/gone.csv",
		]);
	});
});

describe("what a clear deletes at once", () => {
	it("is everything no outliving snapshot refers to", () => {
		expect(
			splitFilesForClear(["h1/a.csv", "h1/b.csv", "exports/h1/x.zip"], new Set(["h1/a.csv"])),
		).toEqual({ hold: ["h1/a.csv"], remove: ["h1/b.csv", "exports/h1/x.zip"] });
	});

	it("is everything when no snapshot is kept", () => {
		expect(splitFilesForClear(["h1/a.csv"], new Set())).toEqual({
			hold: [],
			remove: ["h1/a.csv"],
		});
	});
});
