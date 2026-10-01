import { addedUntil, holdsIn, type ScenarioChange } from "./changes";
import { money, shortMonthName } from "./describe-changes";
import type { Cents } from "./money";
import { type MonthKey, monthsBetween } from "./month";
import type { ProjectedMonth, Projection, ScenarioChangeImpact } from "./scenario";

// What a Scenario's outcome means, in words: warnings when it stops holding up, each pointing at
// the change most responsible; what each month changes and why; and the assumptions behind it.
// Everything here reads projections and Change impacts (scenario.ts); nothing is projected again.

export type OutcomeWarning = {
	kind: "free-to-spend-negative" | "cushion-negative" | "goal-slips" | "goal-missed";
	/** "Free to Spend goes negative in Nov 2027". */
	text: string;
	/** The month it happens (for a Goal, the month it's now reached, if it is). */
	month: MonthKey | null;
	goalId: string | null;
	/** The index in `levers` of the change most responsible; null when none is (the Plan does it too). */
	lever: number | null;
	/** No Change caused it: the Plan as it stands does the same. */
	inPlan: boolean;
};

/**
 * Where the Scenario stops holding up, against the Plan: Free to Spend going negative, the
 * Projected balance dipping below zero, and Goals reached later (or no longer at all). `impacts` are
 * `changeImpacts(ahead, levers)` for the same Changes.
 */
export function outcomeWarnings({
	plan,
	scenario,
	levers,
	impacts,
	goalName,
}: {
	plan: Projection;
	scenario: Projection;
	levers: readonly ScenarioChange[];
	impacts: readonly ScenarioChangeImpact[];
	goalName: (goalId: string) => string;
}): OutcomeWarning[] {
	const warnings: OutcomeWarning[] = [];
	/** The counted Change whose `score` is most negative, if any is below zero. */
	const worst = (score: (impact: ScenarioChangeImpact) => number): number | null => {
		let found: number | null = null;
		let lowest = 0;
		levers.forEach((scenarioChange, i) => {
			const impact = impacts[i];
			if (scenarioChange.muted || !impact) return;
			const value = score(impact);
			if (value < lowest) {
				lowest = value;
				found = i;
			}
		});
		return found;
	};

	const negative = scenario.months.findIndex((m) => m.freeToSpend < 0);
	const negativeMonth = scenario.months[negative];
	if (negativeMonth) {
		const scenarioChange = worst((impact) => impact.byMonth[negative]?.freeToSpend ?? 0);
		const inPlan = (plan.months[negative]?.freeToSpend ?? 0) < 0;
		warnings.push({
			kind: "free-to-spend-negative",
			text: `Free to Spend goes negative in ${shortMonthName(negativeMonth.month)}`,
			month: negativeMonth.month,
			goalId: null,
			lever: scenarioChange,
			inPlan: scenarioChange === null && inPlan,
		});
	}

	const { firstNegative } = scenario;
	if (firstNegative) {
		const index = scenario.months.findIndex((m) => m.month === firstNegative);
		// What each Change has taken from the Projected balance by the month it runs out.
		const scenarioChange = worst((impact) =>
			impact.byMonth.slice(0, index + 1).reduce((sum, m) => sum + m.freeToSpend + m.oneOffs, 0),
		);
		const inPlan = plan.firstNegative !== null && plan.firstNegative <= firstNegative;
		warnings.push({
			kind: "cushion-negative",
			text: `The projected balance dips below zero from ${shortMonthName(firstNegative)}`,
			month: firstNegative,
			goalId: null,
			lever: scenarioChange,
			inPlan: scenarioChange === null && inPlan,
		});
	}

	const lastMonth = scenario.months.at(-1)?.month;
	for (const goal of scenario.goals) {
		const before = plan.goals.find((g) => g.goalId === goal.goalId)?.reachedIn ?? null;
		if (before === null || (goal.reachedIn !== null && goal.reachedIn <= before)) continue;
		// The Change that moves it furthest: one that stops it being reached at all counts most.
		const scenarioChange = worst((impact) => {
			const moved = impact.goals.find((g) => g.goalId === goal.goalId);
			if (!moved) return 0;
			return moved.months === null ? (moved.reachedIn === null ? -Infinity : 0) : -moved.months;
		});
		const name = goalName(goal.goalId);
		if (goal.reachedIn === null) {
			warnings.push({
				kind: "goal-missed",
				text: `The ${name} Goal is no longer reached${lastMonth ? ` by ${shortMonthName(lastMonth)}` : ""}`,
				month: null,
				goalId: goal.goalId,
				lever: scenarioChange,
				inPlan: false,
			});
		} else {
			const months = monthsBetween(before, goal.reachedIn);
			warnings.push({
				kind: "goal-slips",
				text: `The ${name} Goal slips ${months} month${months === 1 ? "" : "s"}, to ${shortMonthName(goal.reachedIn)}`,
				month: goal.reachedIn,
				goalId: goal.goalId,
				lever: scenarioChange,
				inPlan: false,
			});
		}
	}
	return warnings;
}

/** Whether a Change is in play in `month`: a one-off only in its month, a new Commitment for its term. */
export function changeHoldsIn(scenarioChange: ScenarioChange, month: MonthKey): boolean {
	if (scenarioChange.kind === "one-off") return scenarioChange.fromMonth === month;
	if (scenarioChange.kind === "add-commitment") {
		return holdsIn(
			{ fromMonth: scenarioChange.fromMonth, untilMonth: addedUntil(scenarioChange) },
			month,
		);
	}
	return holdsIn(scenarioChange, month);
}

export type MonthBreakdown = {
	month: MonthKey;
	plan: ProjectedMonth;
	scenario: ProjectedMonth;
	/**
	 * The counted Changes in play that month or changing it (a Goal's new date changes its funding
	 * for good): what each does to Free to Spend and one-offs on its own. `lever` indexes `levers`.
	 */
	changes: { lever: number; freeToSpend: Cents; oneOffs: Cents }[];
};

/** One month of the Scenario against the Plan, and the changes behind the difference. */
export function monthBreakdown({
	plan,
	scenario,
	levers,
	impacts,
	index,
}: {
	plan: Projection;
	scenario: Projection;
	levers: readonly ScenarioChange[];
	impacts: readonly ScenarioChangeImpact[];
	/** Which month, counting from the first projected. */
	index: number;
}): MonthBreakdown | null {
	const at = scenario.months[index];
	const planned = plan.months[index];
	if (!at || !planned) return null;
	const changes: MonthBreakdown["changes"] = [];
	levers.forEach((scenarioChange, i) => {
		if (scenarioChange.muted) return;
		const change = impacts[i]?.byMonth[index] ?? { freeToSpend: 0, oneOffs: 0 };
		if (
			changeHoldsIn(scenarioChange, at.month) ||
			change.freeToSpend !== 0 ||
			change.oneOffs !== 0
		) {
			changes.push({ lever: i, ...change });
		}
	});
	return { month: at.month, plan: planned, scenario: at, changes };
}

/**
 * What every projection assumes, in plain sentences, with growth when a Change turns it on.
 * Muted Changes don't count.
 */
export function projectionAssumptions(
	scenarioChanges: readonly ScenarioChange[],
	startingBalance: Cents,
): string[] {
	const growth = scenarioChanges.filter((l) => l.kind === "growth" && !l.muted);
	return [
		"Spending is assumed to equal allowances.",
		"Dated Goals are funded what they need each month; undated ones aren’t.",
		"No interest or investment returns.",
		...(growth.length === 0
			? ["No raises or inflation."]
			: growth.flatMap((l) =>
					l.kind === "growth"
						? [
								`Income grows ${l.incomePct}% and costs ${l.costsPct}% a year from ${shortMonthName(l.fromMonth)}${l.untilMonth ? ` until ${shortMonthName(l.untilMonth)}` : ""}.`,
							]
						: [],
				)),
		startingBalance === 0
			? "The projected balance starts at $0 today, not at what’s in your Accounts."
			: `The projected balance starts at ${money(startingBalance)}.`,
	];
}
