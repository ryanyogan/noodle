import { expectedIn } from "./commitments";
import type { Cents } from "./money";
import { addMonths, type DayKey, type MonthKey, monthOfDay, monthsBetween } from "./month";
import { type PlanRecords, planForMonth } from "./plan";

// Scenarios: the Plan projected forward, as it stands and as Levers change it.
//
// The model is deliberately plain, so a Parent can check any number by hand:
// - Each month's Baseline, Commitments and allowances are the Plan's as stored (ADR-0009),
//   including changes already set for later months. Commitments take what their cadence expects
//   that month (so an annual one shows up once a year).
// - Every dated Goal is funded its monthly needed amount (as goalProgress works it out today)
//   out of Free to Spend each month until it reaches its target; an undated Goal isn't funded.
//   Earmarks earn nothing: no interest or investment returns, and no inflation.
// - Covers, Windfalls, Sweeps and spending don't change the Plan, so they aren't projected.
// - Levers mirror the writes that apply a Scenario: an allowance Lever sets the allowance from
//   the first month on (a later month set on its own keeps its own), ending a Commitment takes it
//   out from its month on, a Goal Lever changes its target and date, and a new Commitment (say
//   the payment on a home or car an Affordability Check found) takes its amount every month from
//   its month on, for as many months as it runs (a loan's or lease's term) or for good.

/** A single adjustable quantity in a Scenario. */
export type Lever =
	| { kind: "allowance"; bucketId: string; amount: Cents }
	| { kind: "end-commitment"; commitmentId: string; fromMonth: MonthKey }
	| { kind: "goal"; goalId: string; target: Cents; targetDate: DayKey | null }
	| {
			kind: "add-commitment";
			/** The new Commitment's ID once applied, so applying again adds it only once. */
			commitmentId: string;
			name: string;
			/** Taken every month (a monthly cadence). */
			amount: Cents;
			fromMonth: MonthKey;
			/** How many months it runs (a loan's term); null for good. */
			months: number | null;
	  };

/** An active Goal as it stands this month. */
export type ProjectionGoal = {
	id: string;
	target: Cents;
	targetDate: DayKey | null;
	/** Its Earmark now. */
	saved: Cents;
	/** Goal funding already Moved into it this month (part of `saved`). */
	fundedThisMonth: Cents;
};

/** The Plan resolved for each month ahead, ready to project many times over. */
export type PlanAhead = {
	months: {
		month: MonthKey;
		baseline: Cents;
		buckets: {
			id: string;
			allowance: Cents;
			/**
			 * The allowance in force was set in the first month or earlier, so an allowance Lever
			 * (set from the first month) replaces it; false once a later month set its own.
			 */
			fromStart: boolean;
		}[];
		/** What each Commitment is expected to take this month. */
		commitments: { id: string; expected: Cents }[];
	}[];
	goals: ProjectionGoal[];
};

export type ProjectedMonth = {
	month: MonthKey;
	baseline: Cents;
	commitments: Cents;
	allowances: Cents;
	goalFunding: Cents;
	/** Negative when the Plan assigns more than the Baseline (never clamped). */
	freeToSpend: Cents;
};

export type ProjectedGoal = {
	goalId: string;
	target: Cents;
	targetDate: DayKey | null;
	/** What it's funded each month to reach its target in time; null when undated or past due. */
	monthly: Cents | null;
	/** Its Earmark at the end of each month. */
	earmarks: Cents[];
	/** The month it reaches its target, or null if not within the months projected. */
	reachedIn: MonthKey | null;
};

export type Projection = {
	months: ProjectedMonth[];
	goals: ProjectedGoal[];
	/** Free to Spend over every month projected. */
	freeToSpend: Cents;
};

/** The longest a Scenario projects: five years. */
export const MAX_PROJECTION_MONTHS = 60;

/**
 * Resolves the Plan for `count` months from `start` (the Household's current month). `records`
 * must hold every record up to the last of them. The slow part of a projection, done once so
 * `project` can run on every Lever change.
 */
export function planAhead(
	records: PlanRecords,
	goals: ProjectionGoal[],
	start: MonthKey,
	count: number,
): PlanAhead {
	const months: PlanAhead["months"] = [];
	for (let i = 0; i < count; i++) {
		const month = addMonths(start, i);
		const plan = planForMonth(records, month);
		months.push({
			month,
			baseline: plan.baseline ?? 0,
			buckets: plan.buckets.map((b) => ({
				id: b.id,
				allowance: b.allowance,
				fromStart: !records.allowances.some(
					(a) => a.bucketId === b.id && a.month > start && a.month <= month,
				),
			})),
			commitments: plan.commitments.map((c) => ({ id: c.id, expected: expectedIn(c, month) })),
		});
	}
	return { months, goals };
}

/** Projects the Plan ahead with Levers applied (none: the Plan as it stands). */
export function project(ahead: PlanAhead, levers: readonly Lever[] = []): Projection {
	const allowances = new Map<string, Cents>();
	const ended = new Map<string, MonthKey>();
	const goalLevers = new Map<string, Extract<Lever, { kind: "goal" }>>();
	const added: { amount: Cents; from: MonthKey; until: MonthKey | null }[] = [];
	for (const lever of levers) {
		if (lever.kind === "allowance") allowances.set(lever.bucketId, lever.amount);
		else if (lever.kind === "end-commitment") ended.set(lever.commitmentId, lever.fromMonth);
		else if (lever.kind === "goal") goalLevers.set(lever.goalId, lever);
		else {
			added.push({
				amount: lever.amount,
				from: lever.fromMonth,
				until: lever.months === null ? null : addMonths(lever.fromMonth, lever.months),
			});
		}
	}

	const start = ahead.months[0]?.month;
	const goals = ahead.goals.map((goal) => {
		const lever = goalLevers.get(goal.id);
		const target = lever?.target ?? goal.target;
		const targetDate = lever ? lever.targetDate : goal.targetDate;
		// As goalProgress: the target's month counts, and what's funded this month is still to come.
		const monthsLeft =
			targetDate === null || start === undefined
				? 0
				: monthsBetween(start, monthOfDay(targetDate)) + 1;
		const monthly =
			monthsLeft > 0
				? Math.ceil(Math.max(0, target - (goal.saved - goal.fundedThisMonth)) / monthsLeft)
				: null;
		return { goal, target, targetDate, monthly, earmark: goal.saved, earmarks: [] as Cents[] };
	});
	const reachedIn = new Map<string, MonthKey>();

	let total = 0;
	const months = ahead.months.map((m, i): ProjectedMonth => {
		let commitments = 0;
		for (const c of m.commitments) {
			const from = ended.get(c.id);
			if (from === undefined || m.month < from) commitments += c.expected;
		}
		for (const a of added) {
			if (m.month >= a.from && (a.until === null || m.month < a.until)) commitments += a.amount;
		}
		let allowanceTotal = 0;
		for (const b of m.buckets) {
			const lever = b.fromStart ? allowances.get(b.id) : undefined;
			allowanceTotal += lever ?? b.allowance;
		}
		let goalFunding = 0;
		for (const g of goals) {
			// This month's funding so far is already in the Earmark, and still comes out of it.
			const already = i === 0 ? g.goal.fundedThisMonth : 0;
			const due = g.monthly === null ? 0 : Math.max(0, g.monthly - already);
			const funding = Math.min(due, Math.max(0, g.target - g.earmark));
			g.earmark += funding;
			g.earmarks.push(g.earmark);
			goalFunding += already + funding;
			if (g.earmark >= g.target && !reachedIn.has(g.goal.id)) reachedIn.set(g.goal.id, m.month);
		}
		const freeToSpend = m.baseline - commitments - allowanceTotal - goalFunding;
		total += freeToSpend;
		return {
			month: m.month,
			baseline: m.baseline,
			commitments,
			allowances: allowanceTotal,
			goalFunding,
			freeToSpend,
		};
	});

	return {
		months,
		goals: goals.map((g) => ({
			goalId: g.goal.id,
			target: g.target,
			targetDate: g.targetDate,
			monthly: g.monthly,
			earmarks: g.earmarks,
			reachedIn: reachedIn.get(g.goal.id) ?? null,
		})),
		freeToSpend: total,
	};
}

/** Money a Scenario frees against the Plan, month by month, added up as it goes. */
export function moneyFreed(plan: Projection, scenario: Projection): Cents[] {
	let freed = 0;
	return scenario.months.map((m, i) => {
		freed += m.freeToSpend - (plan.months[i]?.freeToSpend ?? 0);
		return freed;
	});
}
