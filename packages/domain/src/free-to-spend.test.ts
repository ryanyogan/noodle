import { describe, expect, it } from "vitest";
import { allowancesByKind, freeToSpendParts, monthState, type Plan } from "./index";

const plan: Plan = {
	month: "2026-09",
	baseline: 600_000,
	commitments: [
		{
			id: "mortgage",
			name: "Mortgage",
			amount: 200_000,
			cadence: "monthly",
			dueDate: "2026-01-01",
		},
	],
	buckets: [
		{ id: "groceries", name: "Groceries", color: 1, allowance: 120_000, rolling: false },
		{ id: "hockey", name: "Hockey", color: 2, allowance: 40_000, rolling: true },
		{ id: "alex", name: "Alex", color: 4, allowance: 10_000, rolling: false, owner: "alex" },
	],
};

describe("freeToSpendParts", () => {
	it("takes take-home pay down to Free to Spend, part by part", () => {
		const state = monthState({
			plan,
			spending: [],
			moves: [{ fromBucketId: null, toBucketId: "hockey", amount: 5_000, month: "2026-09" }],
			goalFunding: [
				{ goalId: "trip", amount: 30_000, month: "2026-09" },
				// Extra income sent to a Goal doesn't come out of Free to Spend.
				{ goalId: "trip", amount: 9_000, month: "2026-09", windfall: true },
			],
			asOf: "2026-09-15",
		});
		const parts = freeToSpendParts(state);
		expect(parts).toEqual([
			{ part: "commitments", amount: 200_000 },
			{ part: "buckets", amount: 160_000 },
			{ part: "personal-allowances", amount: 10_000 },
			{ part: "goal-funding", amount: 30_000 },
			{ part: "covers", amount: 5_000 },
		]);
		expect(600_000 - parts.reduce((sum, p) => sum + p.amount, 0)).toBe(state.freeToSpend);
	});

	it("leaves out Personal Allowances when there are none, and Covers when there were none", () => {
		const state = monthState({
			plan: { ...plan, buckets: plan.buckets.filter((b) => b.owner === undefined) },
			spending: [],
			asOf: "2026-09-15",
		});
		expect(freeToSpendParts(state).map((p) => p.part)).toEqual([
			"commitments",
			"buckets",
			"goal-funding",
		]);
	});
});

describe("allowancesByKind", () => {
	it("splits In Buckets into the shared Buckets and the Personal Allowances, as the breakdown shows them", () => {
		const state = monthState({ plan, spending: [], asOf: "2026-09-15" });
		const split = allowancesByKind(state);
		expect(split).toEqual({ buckets: 160_000, personalAllowances: 10_000 });
		// "In Buckets" on This Month is both together.
		expect(state.planned).toBe(170_000);
		const parts = freeToSpendParts(state);
		expect(parts.find((p) => p.part === "buckets")?.amount).toBe(split.buckets);
		expect(parts.find((p) => p.part === "personal-allowances")?.amount).toBe(
			split.personalAllowances,
		);
	});

	it("has no Personal Allowances part when there are none", () => {
		const state = monthState({
			plan: { ...plan, buckets: plan.buckets.filter((b) => b.owner === undefined) },
			spending: [],
			asOf: "2026-09-15",
		});
		expect(allowancesByKind(state)).toEqual({ buckets: 160_000, personalAllowances: null });
	});
});
