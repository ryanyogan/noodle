import { describe, expect, it } from "vitest";
import { asBetweenUs, asIncomeAgain } from "./extra-income";
import type { MonthData } from "./server/month";
import { transferDetail } from "./transfers";

describe("a Transfer's line in a list", () => {
	it("names both Accounts when both sides are in Noodle, whatever the reason", () => {
		expect(transferDetail({ from: "Chase Checking", to: "Visa", reason: null })).toBe(
			"Transfer · Chase Checking → Visa",
		);
		expect(transferDetail({ from: "Chase Checking", to: "Ally", reason: "between-us" })).toBe(
			"Transfer · Chase Checking → Ally",
		);
	});

	it("says Between us for one side a Parent marked so", () => {
		expect(transferDetail({ from: "Chase Checking", to: null, reason: "between-us" })).toBe(
			"Between us · out of Chase Checking",
		);
		expect(transferDetail({ from: null, to: "Chase Checking", reason: "between-us" })).toBe(
			"Between us · into Chase Checking",
		);
		expect(transferDetail({ from: null, to: null, reason: "between-us" })).toBe("Between us");
	});

	it("is unchanged for a one-sided Transfer with no reason", () => {
		expect(transferDetail({ from: "Chase Checking", to: null })).toBe(
			"Transfer out of Chase Checking",
		);
		expect(transferDetail({ from: null, to: "Visa", reason: null })).toBe("Transfer into Visa");
	});
});

describe("the month's cached Income when a deposit is marked as between us", () => {
	const pay = { id: "a", amount: 500_000, date: "2026-10-01", note: "Paycheck" } as const;
	const zelle = { id: "b", amount: 150_000, date: "2026-10-03", note: "Zelle from Sam" } as const;
	const data = { income: [pay, zelle] } as unknown as MonthData;
	const v = { transferId: "t", month: "2026-10", entry: zelle } as const;

	it("moves it out of Income, and back in its place when undone", () => {
		const marked = asBetweenUs(data, v);
		expect(marked.income).toEqual([pay]);
		expect(marked.betweenUs).toEqual([{ ...zelle, transferId: "t" }]);
		// Twice changes nothing more.
		expect(asBetweenUs(marked, v)).toEqual(marked);
		const undone = asIncomeAgain(marked, v);
		expect(undone.income).toEqual([pay, zelle]);
		expect(undone.betweenUs).toEqual([]);
		expect(asIncomeAgain(undone, v).income).toEqual([pay, zelle]);
	});
});
