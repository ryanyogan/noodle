import type { Cents } from "./money";
import type { MonthState } from "./month-state";

/** A part of the Plan that takes its share of take-home pay on the way to Free to Spend. */
export type PlanPart =
	| "commitments"
	| "buckets"
	| "personal-allowances"
	| "goal-funding"
	| "covers";

/**
 * How a month's take-home pay becomes its Free to Spend, part by part in the Plan's order: the
 * Commitments and Buckets always, the Personal Allowances when there are any, Goal funding, and
 * Covers from Free to Spend when there were some. What the month has (`freeToSpendSources`: take-home
 * pay, Extra income added, what was carried over) less every part is Free to Spend.
 */
export function freeToSpendParts(
	state: Pick<MonthState, "buckets" | "committed" | "fundedGoals" | "movedToBuckets">,
): { part: PlanPart; amount: Cents }[] {
	const { buckets, personalAllowances } = allowancesByKind(state);
	return [
		{ part: "commitments", amount: state.committed },
		{ part: "buckets", amount: buckets },
		...(personalAllowances !== null
			? [{ part: "personal-allowances" as const, amount: personalAllowances }]
			: []),
		{ part: "goal-funding", amount: state.fundedGoals },
		...(state.movedToBuckets > 0
			? [{ part: "covers" as const, amount: state.movedToBuckets }]
			: []),
	];
}

/**
 * What a month has to divide up before any part takes its share: take-home pay, Extra income a
 * Parent added to Free to Spend, and what last month's Free to Spend carried over when it builds
 * up (issue 113). `total` less every part of `freeToSpendParts` is the month's Free to Spend.
 */
export function freeToSpendSources(
	state: Pick<MonthState, "baseline" | "extraToFreeToSpend" | "freeCarriedIn">,
): { takeHomePay: Cents; extraIncome: Cents; carriedOver: Cents; total: Cents } {
	const takeHomePay = state.baseline ?? 0;
	const extraIncome = state.extraToFreeToSpend;
	const carriedOver = state.freeCarriedIn;
	return { takeHomePay, extraIncome, carriedOver, total: takeHomePay + extraIncome + carriedOver };
}

/**
 * A month's allowances split the way the Plan shows them: the shared Buckets', and the Personal
 * Allowances' (null when there are none). Together they're MonthState.planned ("In Buckets"),
 * since a Personal Allowance is a Bucket.
 */
export function allowancesByKind(state: Pick<MonthState, "buckets">): {
	buckets: Cents;
	personalAllowances: Cents | null;
} {
	let buckets = 0;
	let personal: Cents | null = null;
	for (const b of state.buckets) {
		if (b.owner === undefined) buckets += b.allowance;
		else personal = (personal ?? 0) + b.allowance;
	}
	return { buckets, personalAllowances: personal };
}
