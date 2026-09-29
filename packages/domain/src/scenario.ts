import { type CommitmentTerms, expectedIn } from "./commitments";
import {
	activeLevers,
	addedTerms,
	addedUntil,
	changedTerms,
	holdsIn,
	type Lever,
	type LeverOf,
	type LeverRange,
} from "./levers";
import type { Cents } from "./money";
import { addMonths, type DayKey, type MonthKey, monthOfDay, monthsBetween } from "./month";
import { type PlanRecords, planForMonth } from "./plan";

// Scenarios: the Plan projected forward, as it stands and as Levers change it.
//
// The model is deliberately plain, so a Parent can check any number by hand:
// - Each month's Baseline, Commitments and allowances are the Plan's as stored (ADR-0009),
//   including changes already set for later months. Commitments take what their cadence expects
//   that month (so an annual one shows up once a year, and a biweekly one three times in some).
// - Every dated Goal is funded its monthly needed amount (as goalProgress works it out today)
//   out of Free to Spend each month until it reaches its target; an undated Goal isn't funded.
//   When a Lever changes a Goal's target or date, what it needs each month is worked out again
//   from its Earmark then. Earmarks earn nothing: no interest or investment returns.
// - Spending is assumed to equal the allowances. Covers, Windfalls, Sweeps and spending don't
//   change the Plan, so they aren't projected.
// - The Cushion is money built up month by month: a starting balance (the Household's Accounts,
//   when given) plus each month's Free to Spend and one-offs.
// - Levers mirror the writes that apply a Scenario, over their range of months (see levers.ts):
//   one that changes the Baseline, an allowance or a Commitment's terms from a month holds until
//   a later month the Plan set on its own, and the Plan's own value comes back at its end.
//   Growth compounds yearly in steps from its first month, and isn't applied to Goal funding or
//   one-offs. A muted Lever is left out altogether.

export type { Lever } from "./levers";

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
		/** The month the Baseline in force was set; null when none is. */
		baselineSetIn: MonthKey | null;
		buckets: {
			id: string;
			allowance: Cents;
			/**
			 * The month the allowance in force was set; null when none is. A Lever from a month
			 * replaces it only if it was set then or earlier, as applying it would.
			 */
			setIn: MonthKey | null;
		}[];
		commitments: {
			id: string;
			/** What it's expected to take this month. */
			expected: Cents;
			terms: CommitmentTerms;
			/** The month its terms in force were set. */
			setIn: MonthKey;
		}[];
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
	/** One-offs this month: income less expenses. */
	oneOffs: Cents;
	/** The Cushion at the end of the month: negative when it's run out (never clamped). */
	cushion: Cents;
};

export type ProjectedGoal = {
	goalId: string;
	/** A Goal a Lever adds, not yet in the Plan. */
	added: boolean;
	/** Its target and date in the first month it's funded (or projected, if never). */
	target: Cents;
	targetDate: DayKey | null;
	/** What it's funded each month to reach its target in time; null when undated or past due. */
	monthly: Cents | null;
	/** Its Earmark at the end of each month (0 for an added one before its first month). */
	earmarks: Cents[];
	/** The month it reaches its target, or null if not within the months projected. */
	reachedIn: MonthKey | null;
};

export type Projection = {
	months: ProjectedMonth[];
	goals: ProjectedGoal[];
	/** Free to Spend over every month projected. */
	freeToSpend: Cents;
	/** One-offs over every month projected: income less expenses. */
	oneOffs: Cents;
	/** The Cushion the projection starts from. */
	startingCushion: Cents;
	/** The Cushion's lowest month-end (the earliest, on a tie); null with no months. */
	lowest: { month: MonthKey; amount: Cents } | null;
	/** The first month the Cushion ends below zero, if any. */
	firstNegative: MonthKey | null;
};

export type ProjectOptions = {
	/** The Cushion to start from, such as the Household's Account balances; 0 when unset. */
	startingBalance?: Cents;
};

/** The longest a Scenario projects: five years. */
export const MAX_PROJECTION_MONTHS = 60;

/** The latest record at or before `month`. */
function effective<T extends { month: MonthKey }>(records: T[], month: MonthKey): T | undefined {
	let found: T | undefined;
	for (const record of records) {
		if (record.month <= month && (!found || record.month > found.month)) found = record;
	}
	return found;
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
	const groups = new Map<K, T[]>();
	for (const item of items) {
		const k = key(item);
		const group = groups.get(k);
		if (group) group.push(item);
		else groups.set(k, [item]);
	}
	return groups;
}

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
	const allowances = groupBy(records.allowances, (a) => a.bucketId);
	const terms = groupBy(records.commitmentTerms, (t) => t.commitmentId);
	const months: PlanAhead["months"] = [];
	for (let i = 0; i < count; i++) {
		const month = addMonths(start, i);
		const plan = planForMonth(records, month);
		months.push({
			month,
			baseline: plan.baseline ?? 0,
			baselineSetIn: effective(records.baselines, month)?.month ?? null,
			buckets: plan.buckets.map((b) => ({
				id: b.id,
				allowance: b.allowance,
				setIn: effective(allowances.get(b.id) ?? [], month)?.month ?? null,
			})),
			commitments: plan.commitments.map(({ id, amount, cadence, dueDate }) => ({
				id,
				expected: expectedIn({ amount, cadence, dueDate }, month),
				terms: { amount, cadence, dueDate },
				setIn: effective(terms.get(id) ?? [], month)?.month ?? month,
			})),
		});
	}
	return { months, goals };
}

/**
 * The last of `levers` holding in `month`: later Levers win. With `setIn` (when the Plan's own
 * value in force was set), only a Lever from that month or later replaces it.
 */
function holding<T extends LeverRange>(
	levers: readonly T[] | undefined,
	month: MonthKey,
	start: MonthKey,
	setIn?: MonthKey | null,
): T | undefined {
	if (!levers) return undefined;
	for (let i = levers.length - 1; i >= 0; i--) {
		const lever = levers[i] as T;
		if (!holdsIn(lever, month)) continue;
		const from = lever.fromMonth < start ? start : lever.fromMonth;
		if (setIn == null || setIn <= from) return lever;
	}
	return undefined;
}

type GoalParams = { target: Cents; targetDate: DayKey | null };

/** Projects the Plan ahead with Levers applied (none: the Plan as it stands); muted ones don't count. */
export function project(
	ahead: PlanAhead,
	levers: readonly Lever[] = [],
	options: ProjectOptions = {},
): Projection {
	const start = ahead.months[0]?.month ?? ("0000-01" as MonthKey);
	const active = activeLevers(levers);
	const of = <K extends Lever["kind"]>(kind: K) =>
		active.filter((l): l is LeverOf<K> => l.kind === kind);

	const baselines = of("baseline");
	const growth = of("growth");
	const oneOffs = of("one-off");
	const allowances = groupBy(of("allowance"), (l) => l.bucketId);
	const archived = groupBy(of("archive-bucket"), (l) => l.bucketId);
	const addedBuckets = of("add-bucket");
	const newTerms = groupBy(of("commitment-terms"), (l) => l.commitmentId);
	const ended = groupBy(of("end-commitment"), (l) => l.commitmentId);
	const addedCommitments = of("add-commitment").map((lever) => ({
		lever,
		range: { fromMonth: lever.fromMonth, untilMonth: addedUntil(lever) },
		terms: addedTerms(lever),
	}));
	const goalLevers = groupBy(of("goal"), (l) => l.goalId);

	const fromOf = (lever: LeverRange) => (lever.fromMonth < start ? start : lever.fromMonth);

	/** Growth's factor for `month`: each Lever holding compounds once per full year since its start. */
	const grown = (month: MonthKey, pct: (lever: LeverOf<"growth">) => number) => {
		let factor = 1;
		for (const lever of growth) {
			if (!holdsIn(lever, month)) continue;
			const years = Math.floor(monthsBetween(lever.fromMonth, month) / 12);
			factor *= (1 + pct(lever) / 100) ** years;
		}
		return factor;
	};
	const scaled = (amount: Cents, factor: number) =>
		factor === 1 ? amount : Math.round(amount * factor);

	// Goals: the Plan's, then any a Lever adds.
	const planGoalIds = new Set(ahead.goals.map((g) => g.id));
	const goals = [
		...ahead.goals.map((goal) => ({
			id: goal.id,
			added: false,
			saved: goal.saved,
			fundedThisMonth: goal.fundedThisMonth,
			paramsIn: (month: MonthKey): GoalParams | null =>
				holding(goalLevers.get(goal.id), month, start) ?? goal,
			fallback: goal as GoalParams,
		})),
		...of("add-goal")
			.filter((lever) => !planGoalIds.has(lever.goalId))
			.map((lever) => ({
				id: lever.goalId,
				added: true,
				saved: 0,
				fundedThisMonth: 0,
				paramsIn: (month: MonthKey): GoalParams | null =>
					holdsIn(lever, month)
						? (holding(goalLevers.get(lever.goalId), month, start) ?? lever)
						: null,
				fallback: lever as GoalParams,
			})),
	].map((g) => ({
		...g,
		params: null as GoalParams | null,
		first: null as { params: GoalParams; monthly: Cents | null } | null,
		monthly: null as Cents | null,
		earmark: g.saved,
		earmarks: [] as Cents[],
		reachedIn: null as MonthKey | null,
	}));

	const startingCushion = options.startingBalance ?? 0;
	let cushion = startingCushion;
	let totalFree = 0;
	let totalOneOffs = 0;
	let lowest: Projection["lowest"] = null;
	let firstNegative: MonthKey | null = null;

	const months = ahead.months.map((m, i): ProjectedMonth => {
		const { month } = m;
		const costs = grown(month, (l) => l.costsPct);

		const baselineLever = holding(baselines, month, start, m.baselineSetIn);
		const baseline = scaled(
			baselineLever ? baselineLever.amount : m.baseline,
			grown(month, (l) => l.incomePct),
		);

		let commitments = 0;
		for (const c of m.commitments) {
			if (holding(ended.get(c.id), month, start)) continue;
			const lever = holding(newTerms.get(c.id), month, start, c.setIn);
			commitments += lever
				? expectedIn(changedTerms(c.terms, lever, fromOf(lever)), month)
				: c.expected;
		}
		for (const added of addedCommitments) {
			const id = added.lever.commitmentId;
			if (!holdsIn(added.range, month) || holding(ended.get(id), month, start)) continue;
			const lever = holding(newTerms.get(id), month, start);
			const terms = lever ? changedTerms(added.terms, lever, fromOf(lever)) : added.terms;
			commitments += expectedIn(terms, month);
		}
		commitments = scaled(commitments, costs);

		let allowanceTotal = 0;
		for (const b of m.buckets) {
			if (holding(archived.get(b.id), month, start)) continue;
			allowanceTotal += holding(allowances.get(b.id), month, start, b.setIn)?.amount ?? b.allowance;
		}
		for (const added of addedBuckets) {
			if (!holdsIn(added, month) || holding(archived.get(added.bucketId), month, start)) continue;
			allowanceTotal +=
				holding(allowances.get(added.bucketId), month, start)?.amount ?? added.amount;
		}
		allowanceTotal = scaled(allowanceTotal, costs);

		let goalFunding = 0;
		for (const g of goals) {
			const params = g.paramsIn(month);
			if (
				i === 0 ||
				params?.target !== g.params?.target ||
				params?.targetDate !== g.params?.targetDate
			) {
				// As goalProgress: the target's month counts, and what's funded this month is still to come.
				const monthsLeft =
					params === null || params.targetDate === null
						? 0
						: monthsBetween(month, monthOfDay(params.targetDate)) + 1;
				const funded = i === 0 ? g.saved - g.fundedThisMonth : g.earmark;
				g.monthly =
					params !== null && monthsLeft > 0
						? Math.ceil(Math.max(0, params.target - funded) / monthsLeft)
						: null;
				g.params = params;
				if (params !== null && g.first === null) g.first = { params, monthly: g.monthly };
			}
			// This month's funding so far is already in the Earmark, and still comes out of it.
			const already = i === 0 ? g.fundedThisMonth : 0;
			const due = g.monthly === null ? 0 : Math.max(0, g.monthly - already);
			const funding = params === null ? 0 : Math.min(due, Math.max(0, params.target - g.earmark));
			g.earmark += funding;
			g.earmarks.push(g.earmark);
			goalFunding += already + funding;
			if (params !== null && g.earmark >= params.target && g.reachedIn === null) {
				g.reachedIn = month;
			}
		}

		let oneOffTotal = 0;
		for (const lever of oneOffs) {
			if (lever.fromMonth === month) {
				oneOffTotal += lever.flow === "income" ? lever.amount : -lever.amount;
			}
		}

		const freeToSpend = baseline - commitments - allowanceTotal - goalFunding;
		totalFree += freeToSpend;
		totalOneOffs += oneOffTotal;
		cushion += freeToSpend + oneOffTotal;
		if (lowest === null || cushion < lowest.amount) lowest = { month, amount: cushion };
		if (cushion < 0 && firstNegative === null) firstNegative = month;
		return {
			month,
			baseline,
			commitments,
			allowances: allowanceTotal,
			goalFunding,
			freeToSpend,
			oneOffs: oneOffTotal,
			cushion,
		};
	});

	return {
		months,
		goals: goals.map((g) => ({
			goalId: g.id,
			added: g.added,
			target: (g.first?.params ?? g.fallback).target,
			targetDate: (g.first?.params ?? g.fallback).targetDate,
			monthly: g.first?.monthly ?? null,
			earmarks: g.earmarks,
			reachedIn: g.reachedIn,
		})),
		freeToSpend: totalFree,
		oneOffs: totalOneOffs,
		startingCushion,
		lowest,
		firstNegative,
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

/** What one Lever does to a Scenario: the Scenario with it, less the Scenario without it. */
export type LeverImpact = {
	/** Free to Spend over every month projected (positive: the Lever frees money). */
	freeToSpend: Cents;
	/** The Cushion at the end of the months projected (Free to Spend and one-offs). */
	cushion: Cents;
	/** The Cushion's lowest point (positive: the Lever raises it). */
	lowest: Cents;
	/**
	 * The first month the Lever changes Free to Spend and one-offs, and by how much: "frees
	 * $1,400/mo from March". Null when it changes nothing (say, its target is gone).
	 */
	firstChange: { month: MonthKey; amount: Cents } | null;
	/** What it changes each month projected: Free to Spend and one-offs (the month breakdown). */
	byMonth: { freeToSpend: Cents; oneOffs: Cents }[];
	/**
	 * Goals the Lever moves: when each is reached with it and without it, and `months` later with
	 * it (negative: sooner; null when either isn't reached within the months projected). A Goal
	 * the Lever adds isn't listed.
	 */
	goals: {
		goalId: string;
		reachedIn: MonthKey | null;
		without: MonthKey | null;
		months: number | null;
	}[];
};

/**
 * Each Lever's impact, leaving it out of the Scenario one at a time (one projection each, plus
 * one with them all). A muted Lever's is what it would do turned back on: the Scenario with it
 * unmuted, less the Scenario as it is.
 */
export function leverImpacts(
	ahead: PlanAhead,
	levers: readonly Lever[],
	options: ProjectOptions = {},
): LeverImpact[] {
	const scenario = project(ahead, levers, options);
	return levers.map((lever, index): LeverImpact => {
		const [all, without] = lever.muted
			? [
					project(
						ahead,
						levers.map((l, i) => (i === index ? { ...l, muted: false } : l)),
						options,
					),
					scenario,
				]
			: [
					scenario,
					project(
						ahead,
						levers.filter((_, i) => i !== index),
						options,
					),
				];
		let firstChange: LeverImpact["firstChange"] = null;
		const byMonth = all.months.map((m, i) => {
			const other = without.months[i];
			const change = {
				freeToSpend: m.freeToSpend - (other?.freeToSpend ?? 0),
				oneOffs: m.oneOffs - (other?.oneOffs ?? 0),
			};
			const amount = change.freeToSpend + change.oneOffs;
			if (amount !== 0 && firstChange === null) firstChange = { month: m.month, amount };
			return change;
		});
		const goals: LeverImpact["goals"] = [];
		for (const goal of all.goals) {
			const other = without.goals.find((g) => g.goalId === goal.goalId);
			if (!other || other.reachedIn === goal.reachedIn) continue;
			goals.push({
				goalId: goal.goalId,
				reachedIn: goal.reachedIn,
				without: other.reachedIn,
				months:
					goal.reachedIn === null || other.reachedIn === null
						? null
						: monthsBetween(other.reachedIn, goal.reachedIn),
			});
		}
		const last = (p: Projection) => p.months.at(-1)?.cushion ?? p.startingCushion;
		return {
			freeToSpend: all.freeToSpend - without.freeToSpend,
			cushion: last(all) - last(without),
			lowest: (all.lowest?.amount ?? 0) - (without.lowest?.amount ?? 0),
			firstChange,
			byMonth,
			goals,
		};
	});
}
