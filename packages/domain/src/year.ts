import { type Lump, lumpsIn } from "./coming-up";
import type { Cents } from "./money";
import { addMonths, type MonthKey, monthsBetween } from "./month";
import {
	commitmentsIn,
	freeToSpend,
	type PlanRecords,
	planForMonth,
	totalCommitments,
} from "./plan";
import { type SpendCell, targetKind } from "./reports";
import { type PlanAhead, type ProjectionGoal, planAhead, project } from "./scenario";

// The year at a glance: each month's Plan, from take-home pay down to Free to Spend, with what
// actually happened next to it once the month has begun.
//
// - Earlier months' Plans, and this month's, are as stored (ADR-0009), as This Month and the
//   Plan show them: their Goal funding is what has been Moved from Free to Spend into Goals, and
//   Covers from Free to Spend count with the Buckets' allowances.
// - Later months come from `planAhead`, projected with no Changes: each dated Goal is funded what
//   it needs each month (see scenario.ts).
// - Actual: income received, what was spent on Commitments and from Buckets (the other Parent's
//   Personal Allowance only as its total), and the Goal funding. Actual Free to Spend is what was
//   left: income less every Transaction not spent from what a Goal has set aside, less the Goal funding.

export type YearFigures = {
	/** Take-home pay in the Plan; income received, in the actual. */
	baseline: Cents;
	commitments: Cents;
	/**
	 * Every Bucket's allowance, Personal Allowances included, plus Covers from Free to Spend;
	 * what was spent from them, in the actual.
	 */
	allowances: Cents;
	goalFunding: Cents;
	/** Negative when the Plan assigns more than take-home pay, or more was spent than came in. */
	freeToSpend: Cents;
};

export type YearMonth = {
	month: MonthKey;
	/** `past`: over; `current`: the Household's month, under way; `ahead`: not begun. */
	when: "past" | "current" | "ahead";
	/** No take-home pay was set for the month. */
	noBaseline: boolean;
	plan: YearFigures;
	/** What happened, so far for the current month; null for months ahead. */
	actual: YearFigures | null;
	/** The Commitments that make the month lumpy (see lumpsIn); empty when it isn't. */
	lumps: Lump[];
};

export type YearActuals = {
	/** Spending per month (`period` is the month) and Target, private totals folded in. */
	spending: readonly SpendCell[];
	income: readonly { month: MonthKey; amount: Cents }[];
	/** Moves from Free to Spend into Goals (not from Extra income or a Sweep). */
	goalFunding: readonly { month: MonthKey; amount: Cents }[];
	/** Moves from Free to Spend into Buckets (Covers; not from Extra income or another Bucket). */
	covers?: readonly { month: MonthKey; amount: Cents }[];
	/** Extra income a Parent added to a month's Free to Spend (#86). */
	extraToFree?: readonly { month: MonthKey; amount: Cents }[];
};

const sumIn = (rows: readonly { month: MonthKey; amount: Cents }[], month: MonthKey) =>
	rows.reduce((sum, row) => (row.month === month ? sum + row.amount : sum), 0);

/** What actually happened in `month`. */
function actualIn(actuals: YearActuals, month: MonthKey): YearFigures {
	let commitments = 0;
	let allowances = 0;
	let other = 0;
	for (const cell of actuals.spending) {
		if (cell.period !== month) continue;
		const kind = targetKind(cell.target);
		if (kind === "commitment") commitments += cell.amount;
		else if (kind === "bucket") allowances += cell.amount;
		// Goal spending comes out of what it has set aside, not the month's money.
		else if (kind !== "goal") other += cell.amount;
	}
	const takeHomePay = sumIn(actuals.income, month);
	const goalFunding = sumIn(actuals.goalFunding, month);
	return {
		baseline: takeHomePay,
		commitments,
		allowances,
		goalFunding,
		freeToSpend: takeHomePay - commitments - allowances - other - goalFunding,
	};
}

/**
 * The 12 months of `year`, with `current` the Household's month. `records` must reach December
 * (or `current`, if later); `goals` are the active Goals as they stand now, for months ahead.
 */
export function yearGrid({
	year,
	current,
	records,
	goals,
	actuals,
}: {
	year: number;
	current: MonthKey;
	records: PlanRecords;
	goals: ProjectionGoal[];
	actuals: YearActuals;
}): YearMonth[] {
	const first = `${String(year).padStart(4, "0")}-01` as MonthKey;
	const last = addMonths(first, 11);
	const aheadCount = last < current ? 0 : monthsBetween(current, last) + 1;
	const ahead: PlanAhead | null =
		aheadCount > 0 ? planAhead(records, goals, current, aheadCount) : null;
	const projected = ahead ? project(ahead).months : [];
	return Array.from({ length: 12 }, (_, i) => {
		const month = addMonths(first, i);
		const when = month < current ? "past" : month === current ? "current" : "ahead";
		const lumps = lumpsIn({ month, commitments: commitmentsIn(records, month) });
		const actual = when === "ahead" ? null : actualIn(actuals, month);
		if (when !== "ahead") {
			const plan = planForMonth(records, month);
			const goalFunding = actual?.goalFunding ?? 0;
			const covers = sumIn(actuals.covers ?? [], month);
			const extraToFree = sumIn(actuals.extraToFree ?? [], month);
			return {
				month,
				when,
				noBaseline: plan.baseline === null,
				plan: {
					baseline: plan.baseline ?? 0,
					commitments: totalCommitments(plan),
					allowances: plan.buckets.reduce((sum, b) => sum + b.allowance, 0) + covers,
					goalFunding,
					freeToSpend: freeToSpend(plan) - goalFunding - covers + extraToFree,
				},
				actual,
				lumps,
			};
		}
		const index = monthsBetween(current, month);
		const p = projected[index];
		const resolved = ahead?.months[index];
		return {
			month,
			when,
			noBaseline: resolved?.baselineSetIn == null,
			plan: {
				baseline: p?.baseline ?? 0,
				commitments: p?.commitments ?? 0,
				allowances: p?.allowances ?? 0,
				goalFunding: p?.goalFunding ?? 0,
				freeToSpend: p?.freeToSpend ?? 0,
			},
			actual,
			lumps,
		};
	});
}
