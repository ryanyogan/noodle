import { foldSearch, MATCH, searchChoices, searchFit } from "@noodle/ui/lib/choice-search";
import { describe, expect, it } from "vitest";

const names = [
	"Groceries",
	"Eating out",
	"Fuel",
	"Outdoors",
	"Café & treats",
	"Kids’ clothes",
	"Workout",
	"Garden",
	"Gifts",
	"Car",
	"Cards",
];
const find = (typed: string) => searchChoices(names, typed, (name) => [name]);

describe("searching a list of choices (issue 154)", () => {
	it.each<[string, string[]]>([
		// Nothing typed: everything, in the list's own order.
		["", names],
		["   ", names],
		// The beginning of the name.
		["eat", ["Eating out", "Café & treats"]],
		["GRO", ["Groceries"]],
		// The beginning of any later word; the name that begins with it comes first, and a name
		// that only has it inside a word comes after both.
		["out", ["Outdoors", "Eating out", "Workout"]],
		["treats", ["Café & treats"]],
		// Accents and punctuation don't count, either way round.
		["cafe", ["Café & treats"]],
		["café tre", ["Café & treats"]],
		["kids clothes", ["Kids’ clothes"]],
		["kid's", ["Kids’ clothes"]],
		["eating-out", ["Eating out"]],
		// Words in any order, each the beginning of a word.
		["out eat", ["Eating out"]],
		// One wrong, missing, extra or swapped letter in a word of five letters or more.
		["grocries", ["Groceries"]],
		["groxeries", ["Groceries"]],
		["grroceries", ["Groceries"]],
		["gorceries", ["Groceries"]],
		["eatng", ["Eating out"]],
		["gardn", ["Garden"]],
		// A real beginning comes before a forgiven one.
		["gif", ["Gifts"]],
		["card", ["Cards"]],
		["cars", ["Cards"]],
		// Short words forgive nothing: "fule" is not Fuel, and three letters are too few.
		["fule", []],
		["grx", []],
		// Two slips are too many, and the first letter has to be right.
		["grxcxries", []],
		["zroceries", []],
		["zzz", []],
	])("%j finds %j", (typed, expected) => {
		expect(find(typed)).toEqual(expected);
	});

	it("puts the whole name's beginning first, then a word's, then a forgiven slip", () => {
		const list = ["Garden tools", "Tools", "Home and tools", "Toolshed", "Stools"];
		expect(searchChoices(list, "tools", (name) => [name])).toEqual([
			"Tools",
			"Toolshed",
			"Garden tools",
			"Home and tools",
			"Stools",
		]);
		expect(searchFit(["Tools"], "tools")).toBe(MATCH.name);
		expect(searchFit(["Garden tools"], "tools")).toBe(MATCH.word);
		expect(searchFit(["Stools"], "tools")).toBe(MATCH.inside);
		expect(searchFit(["Garden tools"], "toosl")).toBe(MATCH.slip);
		expect(searchFit(["Garden tools"], "shed")).toBeNull();
	});

	it("finds a choice by the other words it answers to, like a Personal Allowance's Parent", () => {
		const allowances = [
			{ name: "Fun money", also: ["Avery", "Personal Allowance"] },
			{ name: "Pocket money", also: ["Jordan", "Personal Allowance"] },
			{ name: "Groceries", also: [] },
		];
		const by = (typed: string) =>
			searchChoices(allowances, typed, (a) => [a.name, ...a.also]).map((a) => a.name);
		expect(by("avery")).toEqual(["Fun money"]);
		expect(by("jord")).toEqual(["Pocket money"]);
		expect(by("personal")).toEqual(["Fun money", "Pocket money"]);
		expect(by("allowance")).toEqual(["Fun money", "Pocket money"]);
		expect(by("money")).toEqual(["Fun money", "Pocket money"]);
	});

	it("folds case, accents and punctuation to plain words", () => {
		expect(foldSearch("  Café — Eating-out!  ")).toBe("cafe eating out");
		expect(foldSearch("Kids’ clothes")).toBe("kids clothes");
		expect(foldSearch("401(k)")).toBe("401 k");
	});
});
