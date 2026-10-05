import type { DraftBucket } from "@noodle/domain";
import { describe, expect, test } from "vitest";
import {
	belongsOn,
	personalRenames,
	personalShare,
	sheetStarters,
	startingBuckets,
	withSpending,
} from "./starter-buckets";

const format = (cents: number) => (cents / 100).toFixed(0);
const draft = (key: string, name: string, allowance: number): DraftBucket => ({
	key,
	name,
	allowance,
	monthly: allowance,
	merchants: [],
	count: 3,
});

describe("the Add Buckets sheet's suggestions (#57)", () => {
	test("with no history, each starter gets a share of what's left to plan, none ticked", () => {
		const rows = sheetStarters([], null, 200_000, format);
		const groceries = rows.find((row) => row.name === "Groceries");
		expect(groceries).toMatchObject({ amountCents: 60_000, suggested: "scaled", kept: false });
		// Rounded down to tens of dollars.
		expect(rows.find((row) => row.name === "Pets")?.amountCents).toBe(6_000);
		expect(rows.every((row) => !row.kept && !row.personal)).toBe(true);
	});

	test("with nothing left to plan, amounts are left for the Parent to type", () => {
		const rows = sheetStarters([], [], 0, format);
		expect(rows.every((row) => row.amount === "" && row.suggested === null)).toBe(true);
	});

	test("with history, the amount comes from that kind of spending and the row is ticked", () => {
		const rows = sheetStarters(
			[],
			[
				draft("g", "Groceries", 78_000),
				draft("e", "Eating out", 12_000),
				draft("h", "Hockey", 9_000),
			],
			200_000,
			format,
		);
		expect(rows.find((row) => row.name === "Groceries")).toMatchObject({
			amountCents: 78_000,
			suggested: "spending",
			kept: true,
		});
		// Matched by the kind of spending, not only the name.
		expect(rows.find((row) => row.name === "Dining out")).toMatchObject({
			amountCents: 12_000,
			suggested: "spending",
		});
		// Spending no starter fits is a row of its own.
		expect(rows.find((row) => row.name === "Hockey")).toMatchObject({
			amountCents: 9_000,
			kept: true,
		});
		// The rest still come from what's left.
		expect(rows.find((row) => row.name === "Gas")?.suggested).toBe("scaled");
	});

	test("what the Plan already has is left out, by name or kind, history included", () => {
		const rows = sheetStarters(
			["groceries", "Eating Out"],
			[draft("g", "Groceries", 78_000)],
			100_000,
			format,
		);
		const names = rows.map((row) => row.name);
		expect(names).not.toContain("Groceries");
		expect(names).not.toContain("Dining out");
		expect(names).toContain("Travel");
	});

	test("history arriving later fills untouched rows only", () => {
		const rows = sheetStarters([], null, 100_000, format).map((row) =>
			row.name === "Gas" ? { ...row, amount: "55", amountCents: 5_500, touched: true } : row,
		);
		const next = withSpending(
			rows,
			[],
			[draft("s", "Gas", 4_000), draft("g", "Groceries", 70_000)],
			format,
		);
		expect(next.find((row) => row.name === "Gas")?.amountCents).toBe(5_500);
		expect(next.find((row) => row.name === "Groceries")?.amountCents).toBe(70_000);
	});

	test("Gifts, Clothes and Travel carry over by default; the wizard keeps its short list", () => {
		const rows = sheetStarters([], null, 0, format);
		const carries = rows.filter((row) => row.rolling).map((row) => row.name);
		expect(carries.sort()).toEqual(["Clothes", "Gifts", "Travel"]);
		expect(startingBuckets(undefined, "Alex", format).map((row) => row.name)).not.toContain(
			"Travel",
		);
		expect(personalShare(100_000)).toBe(4_000);
	});
});

describe("where a suggested Bucket lands in the sheet (#58)", () => {
	const rows = sheetStarters([], [], 0, (c) => String(c / 100));
	const dining = rows.find((row) => row.key === "dining");
	test("a kind of starter lands on that starter, so it never sits beside it", () => {
		expect(dining && belongsOn(dining, "Restaurants")).toBe(true);
		expect(dining && belongsOn(dining, "dining out")).toBe(true);
		expect(dining && belongsOn(dining, "Vet")).toBe(false);
	});
	test("a starter someone typed in keeps only its own name", () => {
		expect(dining && belongsOn({ ...dining, touched: true }, "Restaurants")).toBe(false);
		expect(dining && belongsOn({ ...dining, touched: true }, "Dining out")).toBe(true);
	});
});

describe("a Parent's Personal Allowance follows their new name (issue 104)", () => {
	test("both names made from theirs are carried over", () => {
		expect(personalRenames("Alex", "Alexandra")).toEqual([
			{ from: "Alex’s money", to: "Alexandra’s money" },
			{ from: "Alex’s Personal Allowance", to: "Alexandra’s Personal Allowance" },
		]);
	});

	test("the Plan's name uses the first name only", () => {
		expect(personalRenames("Alex Rink", "Alex Stone")).toEqual([
			{ from: "Alex Rink’s money", to: "Alex Stone’s money" },
		]);
	});

	test("the same name renames nothing", () => {
		expect(personalRenames("Alex", "Alex")).toEqual([]);
	});
});
