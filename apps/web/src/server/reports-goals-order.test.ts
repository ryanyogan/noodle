import { describe, expect, it } from "vitest";
import { inGoalsPageOrder } from "./reports";

const goal = (name: string, kind: "save" | "payoff" = "save", completed = false) => ({
	name,
	kind,
	completed,
});

describe("the order of Goals in Reports", () => {
	it("is the Goals page's: saving, then paying off, then completed, oldest first in each", () => {
		const oldestFirst = [
			goal("Old trip", "save", true),
			goal("Card", "payoff"),
			goal("Roof"),
			goal("Loan", "payoff", true),
			goal("Car loan", "payoff"),
			goal("Emergency fund"),
		];
		expect(inGoalsPageOrder(oldestFirst).map((g) => g.name)).toEqual([
			"Roof",
			"Emergency fund",
			"Card",
			"Car loan",
			"Old trip",
			"Loan",
		]);
	});

	it("keeps Goals of one kind as they came, and leaves what it was given alone", () => {
		const given = [goal("B"), goal("A"), goal("C")];
		expect(inGoalsPageOrder(given).map((g) => g.name)).toEqual(["B", "A", "C"]);
		expect(given.map((g) => g.name)).toEqual(["B", "A", "C"]);
	});
});
