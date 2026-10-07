import { describe, expect, it } from "vitest";
import { whoseChoices, whoseGroups } from "./account-whose";

const parents = [
	{ id: "ryan", name: "Ryan" },
	{ id: "cori", name: "Cori" },
];
const account = (id: string, whose: string | null) => ({ id, whose });

describe("whoseGroups", () => {
	it("lists the viewer's first, then the other Parent's, then the Household's, each in the order given", () => {
		const accounts = [
			account("joint", null),
			account("ryan-card", "ryan"),
			account("cori-savings", "cori"),
			account("cori-card", "cori"),
		];
		expect(
			whoseGroups(accounts, parents, "cori").map((g) => [g.title, g.accounts.map((a) => a.id)]),
		).toEqual([
			["Cori’s Accounts", ["cori-savings", "cori-card"]],
			["Ryan’s Accounts", ["ryan-card"]],
			["The Household’s Accounts", ["joint"]],
		]);
		expect(whoseGroups(accounts, parents, "ryan").map((g) => g.key)).toEqual([
			"ryan",
			"cori",
			"household",
		]);
	});

	it("leaves out a group with no Accounts, and keeps one of nobody known with the Household's", () => {
		expect(
			whoseGroups([account("a", null), account("b", "gone")], parents, "ryan").map((g) => [
				g.key,
				g.accounts.length,
			]),
		).toEqual([["household", 2]]);
	});
});

describe("whoseChoices", () => {
	it("offers the viewer, the other Parent, then the Household", () => {
		expect(whoseChoices(parents, "cori").map((c) => c.label)).toEqual([
			"Cori",
			"Ryan",
			"The Household",
		]);
	});
});
