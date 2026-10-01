import { describe, expect, it } from "vitest";
import { type PairableAccount, pairingScore, pairSameLines, suggestPairings } from "./index";

const account = (
	id: string,
	name: string,
	kind: PairableAccount["kind"],
	paired: [string, string] | null = null,
): PairableAccount => ({
	id,
	name,
	kind,
	bankConnectionId: paired?.[0] ?? null,
	externalId: paired?.[1] ?? null,
});

const bank = (externalId: string, name: string, kind: PairableAccount["kind"], mask: string) => ({
	externalId,
	name: `${name} ··${mask}`,
	mask,
	kind,
});

describe("suggestPairings (ADR-0020)", () => {
	const household = [
		account("chase", "Chase Total Checking", "checking"),
		account("kids", "Kids’ Savings", "savings"),
		account("costco", "Costco Anywhere Visa", "credit-card"),
		account("amex", "Blue card 1005", "credit-card"),
		account("honda", "Honda Odyssey loan", "loan", ["c-ally", "ally-loan"]),
	];

	it("suggests the Account a bank account shares a name or its last digits with", () => {
		const suggested = suggestPairings(
			[
				bank("b-check", "Plaid Checking", "checking", "0000"),
				bank("b-kids", "Kids Savings", "savings", "1111"),
				bank("b-costco", "Costco Anywhere Visa Card", "credit-card", "3333"),
				bank("b-amex", "Platinum", "credit-card", "1005"),
			],
			"First Platypus Bank",
			"c-new",
			household,
		);
		expect(Object.fromEntries(suggested)).toEqual({
			"b-kids": "kids",
			"b-costco": "costco",
			"b-amex": "amex",
		});
	});

	it("counts the institution's name, but not generic words like checking", () => {
		const suggested = suggestPairings(
			[bank("b-check", "Total Checking", "checking", "0000")],
			"Chase",
			"c-new",
			household,
		);
		expect(suggested.get("b-check")).toBe("chase");
		expect(
			suggestPairings([bank("b", "Checking", "checking", "9")], "Some Bank", "c", household).size,
		).toBe(0);
	});

	it("never suggests an Account of the other side, or one connected already", () => {
		expect(
			pairingScore(bank("b", "Costco", "checking", "1"), null, household[2] as PairableAccount),
		).toBe(0);
		const suggested = suggestPairings(
			[bank("b-loan", "Honda Odyssey", "loan", "4444")],
			"Ally",
			"c-new",
			household,
		);
		expect(suggested.size).toBe(0);
	});

	it("keeps a bank account's pairing, and suggests each Account once, best first", () => {
		const suggested = suggestPairings(
			[
				bank("ally-loan", "Auto", "loan", "4444"),
				bank("b1", "Costco Visa", "credit-card", "1111"),
				bank("b2", "Costco Anywhere Visa", "credit-card", "2222"),
			],
			null,
			"c-ally",
			household,
		);
		expect(suggested.get("ally-loan")).toBe("honda");
		expect(suggested.get("b2")).toBe("costco");
		expect(suggested.has("b1")).toBe(false);
	});
});

describe("pairSameLines (ADR-0020)", () => {
	const here = [
		{ id: "shell", date: "2026-09-28" as const, amount: -3_850, description: "SHELL OIL 123" },
		{ id: "coffee1", date: "2026-09-20" as const, amount: -450, description: "Blue Bottle" },
		{ id: "coffee2", date: "2026-09-20" as const, amount: -450, description: "Blue Bottle" },
		{ id: "pay", date: "2026-09-15" as const, amount: 240_000, description: "ACME CORP PAYROLL" },
	];

	it("pairs the same amount within a few days, each line once", () => {
		expect(
			pairSameLines(here, [
				{ date: "2026-09-29", amount: -3_850, description: "Shell" },
				{ date: "2026-09-20", amount: -450, description: "Blue Bottle Coffee" },
				{ date: "2026-09-20", amount: -450, description: "Blue Bottle Coffee" },
				{ date: "2026-09-21", amount: -450, description: "Blue Bottle Coffee" },
				{ date: "2026-09-16", amount: 240_000, description: "Acme Payroll" },
			]),
		).toEqual(["shell", "coffee1", "coffee2", null, "pay"]);
	});

	it("leaves lines too far apart, or of another amount, as new", () => {
		expect(
			pairSameLines(here, [
				{ date: "2026-09-24", amount: -3_850, description: "Shell" },
				{ date: "2026-09-28", amount: -3_851, description: "Shell" },
				{ date: "2026-09-15", amount: -240_000, description: "Acme" },
			]),
		).toEqual([null, null, null]);
	});

	it("prefers the nearer day, then the closer description", () => {
		const two = [
			{ id: "far", date: "2026-09-10" as const, amount: -2_000, description: "Target" },
			{ id: "near", date: "2026-09-12" as const, amount: -2_000, description: "Kroger" },
			{ id: "named", date: "2026-09-12" as const, amount: -2_000, description: "Target" },
		];
		expect(
			pairSameLines(two, [{ date: "2026-09-12", amount: -2_000, description: "TARGET 0042" }]),
		).toEqual(["named"]);
	});
});
