import { describe, expect, it } from "vitest";
import {
	cleanGroupName,
	GROUP_NAME_MAX,
	groupBuckets,
	groupNames,
	groupTotals,
	inGroupOrder,
	peersOf,
	putInOrder,
} from "./bucket-groups";

const bucket = (id: string, group?: string, allowance = 100, spent = 40) => ({
	id,
	...(group ? { group } : {}),
	allowance,
	spent,
	left: allowance - spent,
});

describe("a group's name", () => {
	it("is trimmed, with one space between its words", () => {
		expect(cleanGroupName("  Kids   and  school ")).toBe("Kids and school");
	});
	it("is no group when empty", () => {
		expect(cleanGroupName("   ")).toBeNull();
		expect(cleanGroupName("")).toBeNull();
		expect(cleanGroupName(null)).toBeNull();
		expect(cleanGroupName(undefined)).toBeNull();
	});
	it("is cut at its longest", () => {
		expect(cleanGroupName("x".repeat(GROUP_NAME_MAX + 10))).toBe("x".repeat(GROUP_NAME_MAX));
		expect(cleanGroupName(`${"x".repeat(GROUP_NAME_MAX - 1)} y`)).toBe(
			"x".repeat(GROUP_NAME_MAX - 1),
		);
	});
});

describe("Buckets in their groups", () => {
	const buckets = [
		bucket("groceries", "Home"),
		bucket("fun"),
		bucket("clothes", "Kids"),
		bucket("household", "Home"),
		bucket("gifts"),
		bucket("school", "Kids"),
	];

	it("puts the ungrouped first under no name, then each group where its first Bucket is", () => {
		expect(groupBuckets(buckets).map((g) => [g.name, g.buckets.map((b) => b.id)])).toEqual([
			[null, ["fun", "gifts"]],
			["Home", ["groceries", "household"]],
			["Kids", ["clothes", "school"]],
		]);
	});
	it("has no nameless group when every Bucket is in one", () => {
		expect(groupBuckets([bucket("a", "Home")]).map((g) => g.name)).toEqual(["Home"]);
		expect(groupBuckets([])).toEqual([]);
	});
	it("keeps the Buckets' own order inside a group", () => {
		expect(inGroupOrder(buckets).map((b) => b.id)).toEqual([
			"fun",
			"gifts",
			"groceries",
			"household",
			"clothes",
			"school",
		]);
	});
	it("names the groups in the order they are shown", () => {
		expect(groupNames(buckets)).toEqual(["Home", "Kids"]);
		expect(groupNames([bucket("fun")])).toEqual([]);
	});
	it("adds up a group: allowance, spent and left", () => {
		expect(groupTotals([bucket("a", "Home", 400, 150), bucket("b", "Home", 100, 130)])).toEqual({
			allowance: 500,
			spent: 280,
			left: 220,
		});
	});
	it("knows which Buckets a Bucket moves among: those of its group", () => {
		expect(peersOf(buckets, "household")).toEqual(["groceries", "household"]);
		expect(peersOf(buckets, "gifts")).toEqual(["fun", "gifts"]);
		expect(peersOf(buckets, "nobody")).toEqual([]);
	});
	it("puts a group's new order back where the group was in the whole list", () => {
		expect(
			putInOrder(["fun", "gifts", "groceries", "household", "clothes"], ["household", "groceries"]),
		).toEqual(["fun", "gifts", "household", "groceries", "clothes"]);
		expect(putInOrder(["a", "x", "b"], ["b", "a"])).toEqual(["b", "x", "a"]);
	});
});
