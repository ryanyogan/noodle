import { monthState } from "@noodle/domain";
import { describe, expect, test } from "vitest";
import type { MonthData } from "./server/month";
import { withIncome, withoutIncome, withoutWindfall, withWindfall } from "./windfalls";

const month: MonthData = {
	plan: {
		month: "2026-09",
		baseline: 500_000,
		commitments: [],
		buckets: [{ id: "fun", name: "Fun", color: 1, allowance: 40_000, rolling: false }],
	},
	spending: [],
	charges: [],
	moves: [],
	rolledOver: {},
	goalFunding: [],
	sweeps: [],
	closed: null,
	income: [{ id: "pay", amount: 500_000, date: "2026-09-01", note: "Paycheck" }],
	asOf: "2026-09-15",
	editable: true,
};

const bonus = {
	incomeId: "bonus",
	month: "2026-09" as const,
	date: "2026-09-15" as const,
	amountCents: 120_000,
	note: "Bonus",
};

describe("optimistic income and Windfall Moves", () => {
	test("income beyond the Baseline shows up as a Windfall at once, and goes when removed", () => {
		const withBonus = withIncome(month, bonus);
		expect(withIncome(withBonus, bonus)).toBe(withBonus);
		expect(monthState(withBonus)).toMatchObject({ received: 620_000, windfallLeft: 120_000 });
		expect(monthState(withoutIncome(withBonus, bonus)).windfall).toBe(0);
	});

	test("sending the Windfall to a Goal or Bucket leaves Free to Spend alone", () => {
		const data = withIncome(month, bonus);
		const before = monthState(data);
		const toGoal = withWindfall(data, {
			moveId: "a",
			month: "2026-09",
			to: { kind: "goal", goalId: "trip" },
			toName: "Trip",
			amountCents: 100_000,
		});
		const both = withWindfall(toGoal, {
			moveId: "b",
			month: "2026-09",
			to: { kind: "bucket", bucketId: "fun" },
			toName: "Fun",
			amountCents: 20_000,
		});
		const after = monthState(both);
		expect(after).toMatchObject({ freeToSpend: before.freeToSpend, windfallLeft: 0 });
		expect(after.buckets[0]?.left).toBe(60_000);
		expect(monthState(withoutWindfall(both, { moveId: "a" })).windfallLeft).toBe(100_000);
	});
});
