import { monthState } from "@noodle/domain";
import { describe, expect, test } from "vitest";
import {
	type FundGoalVariables,
	type GoalsData,
	goalsView,
	withBalance,
	withGoal,
	withGoalDetails,
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
			bankConnectionId: null,
			lastStatementDate: null,
			latestBalance: { amount: 1_000_000, at: 1 },
		},
		{
			id: "visa",
			name: "Visa",
			kind: "credit-card",
			bankConnectionId: null,
			lastStatementDate: null,
			latestBalance: { amount: 50_000, at: 1 },
		},
	],
	withdrawals: [],
	goals: [],
	changes: [],
	owed: [{ accountId: "visa", amount: 50_000, at: 1 }],
};

const braces = {
	goalId: "braces",
	kind: "save",
	accountId: "savings",
	name: "Braces",
	targetCents: 600_000,
	targetDate: "2027-08-31",
	claimId: "claim-braces",
	claimCents: 300_000,
} as const;

describe("the optimistic Goal edits", () => {
	test("a new Goal claims not set aside money on its Account at once, once", () => {
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

	test("Goal spending lowers what's set aside and the Account's balance together", () => {
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
			planBefore: { month: "2026-08", baseline: 500_000, commitments: [], buckets: [] },
			spending: [],
			charges: [],
			moves: [],
			rolledOver: {},
			goalFunding: [],
			sweeps: [],
			closed: null,
			income: [],
			asOf: "2026-09-15",
			editable: true,
			firstMonth: "2026-01",
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

	test("a payoff Goal is paid down as what's owed falls, sets nothing aside, and keeps its target", () => {
		const payoff = {
			goalId: "visa-goal",
			kind: "payoff",
			accountId: "visa",
			name: "Pay off the Visa",
			targetCents: 50_000,
			targetDate: "2027-02-28",
			claimId: "unused",
			claimCents: 0,
		} as const;
		const added = withGoal(goals, payoff);
		expect(goalsView(added).goals[0]).toMatchObject({
			kind: "payoff",
			progress: { saved: 0, remaining: 50_000, monthly: 8_334 },
			payoff: { owed: 50_000, history: [{ amount: 50_000, at: 1 }] },
		});
		const paid = withBalance(added, { balanceId: "b2", accountId: "visa", amountCents: 20_000 });
		const view = goalsView(paid);
		expect(view.goals[0]).toMatchObject({
			progress: { saved: 30_000, remaining: 20_000, share: 0.6 },
			payoff: { owed: 20_000 },
		});
		expect(view.goals[0]?.payoff?.history).toHaveLength(2);
		expect(view.accounts[1]).toMatchObject({ earmarks: [], payoffGoal: { id: "visa-goal" } });
		const edited = withGoalDetails(paid, {
			goalId: "visa-goal",
			name: "Visa",
			targetCents: 1,
			targetDate: null,
		});
		expect(goalsView(edited).goals[0]).toMatchObject({ name: "Visa", target: 50_000 });
		const paidOff = withBalance(paid, { balanceId: "b3", accountId: "visa", amountCents: 0 });
		expect(goalsView(paidOff).goals[0]?.progress.status).toBe("reached");
	});
});
