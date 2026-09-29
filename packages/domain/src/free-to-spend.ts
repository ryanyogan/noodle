import type { Cents } from "./money";
import type { MonthState } from "./month-state";

/** A part of the Plan that takes its share of the Baseline on the way to Free to Spend. */
export type PlanPart =
	| "commitments"
	| "buckets"
	| "personal-allowances"
	| "goal-funding"
	| "covers";

/**
 * How a month's Baseline becomes its Free to Spend, part by part in the Plan's order: the
 * Commitments and Buckets always, the Personal Allowances when there are any, Goal funding, and
 * Covers from Free to Spend when there were some. The Baseline less every part is Free to Spend.
 */
export function freeToSpendParts(
	state: Pick<MonthState, "buckets" | "committed" | "fundedGoals" | "movedToBuckets">,
): { part: PlanPart; amount: Cents }[] {
	const allowances = (personal: boolean) =>
		state.buckets
			.filter((b) => (b.owner !== undefined) === personal)
			.reduce((sum, b) => sum + b.allowance, 0);
	return [
		{ part: "commitments", amount: state.committed },
		{ part: "buckets", amount: allowances(false) },
		...(state.buckets.some((b) => b.owner !== undefined)
			? [{ part: "personal-allowances" as const, amount: allowances(true) }]
			: []),
		{ part: "goal-funding", amount: state.fundedGoals },
		...(state.movedToBuckets > 0
			? [{ part: "covers" as const, amount: state.movedToBuckets }]
			: []),
	];
}
