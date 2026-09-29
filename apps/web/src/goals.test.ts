import { monthState } from "@noodle/domain";
import { describe, expect, test } from "vitest";
import {
	type FundGoalVariables,
	type GoalsData,
	goalsView,
	withGoal,
	withMonthFunding,
	withoutMonthFunding,
	withSpending,
} from "./goals";
import type { MonthData } from "./server/month";

const goals: GoalsData = {
	emergencyGoalId: null,
	month: "2026-09",
	asOf: "2026-09-15",
	accounts: [
		{
			id: "savings",
			name: "Savings",
			kind: "savings",
			latestBalance: { amount: 1_000_000, at: 1 },
		},
		{ id: "visa", name: "Visa", kind: "credit-card", latestBalance: { amount: 50_000, at: 1 } },
	],
	withdrawals: [],
	goals: [],
	changes: [],
};

const braces = {
	goalId: "braces",
	accountId: "savings",
	name: "Braces",
	targetCents: 600_000,
	targetDate: "2027-08-31",
	claimId: "claim-braces",
	claimCents: 300_000,
} as const;

describe("the optimistic Goal edits", () => {
	test("a new Goal claims Unclaimed money on its Account at once, once", () => {
		const data = withGoal(withGoal(goals, braces), braces);
		const view = goalsView(data);
		expect(view.goals).toMatchObject([
			{ id: "braces", state: "active", fromMonth: "2026-09", progress: { saved: 300_000 } },
		]);
		expect(view.accounts[0]).toMatchObject({
			holdsMoney: true,
			balance: 1_000_000,
			earmarked: 300_000,
			unclaimed: 700_000,
		});
		expect(view.accounts[1]).toMatchObject({ holdsMoney: false, earmarks: [] });
	});

	test("Goal spending lowers the Earmark and the Account's balance together", () => {
		const data = withSpending(withGoal(goals, braces), {
			transactionId: "t1",
			goalId: "braces",
			goalName: "Braces",
			accountId: "savings",
			month: "2026-09",
			date: "2026-09-15",
			amountCents: 100_000,
			note: null,
		});
		const [savings] = goalsView(data).accounts;
		expect(savings).toMatchObject({ balance: 900_000, earmarked: 200_000, unclaimed: 700_000 });
	});

	test("Goal funding drops the month's Free to Spend at once, and undoing it puts it back", () => {
		const month: MonthData = {
			plan: { month: "2026-09", baseline: 500_000, commitments: [], buckets: [] },
			spending: [],
			charges: [],
			moves: [],
			rolledOver: {},
			goalFunding: [],
			income: [],
			asOf: "2026-09-15",
			editable: true,
		};
		const funding: FundGoalVariables = {
			moveId: "m1",
			goalId: "braces",
			goalName: "Braces",
			month: "2026-09",
			amountCents: 25_000,
		};
		const funded = withMonthFunding(withMonthFunding(month, funding), funding);
		expect(monthState(funded).freeToSpend).toBe(475_000);
		expect(monthState(withoutMonthFunding(funded, funding)).freeToSpend).toBe(500_000);
	});
});
