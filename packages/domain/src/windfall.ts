import type { GoalStatus } from "./goals";
import type { Cents } from "./money";
import {
	addMonths,
	type DayKey,
	daysElapsed,
	daysInMonth,
	type MonthKey,
	monthOfDay,
} from "./month";
import type { BucketState } from "./month-state";

/**
 * Income received on a day: a paycheck, a bonus, a tax refund. A Refund of a purchase is not
 * income; it is spending with a negative amount that restores its Bucket.
 */
export type Income = { amount: Cents; date: DayKey };

/**
 * A month's Windfall: the income received in it beyond the Baseline, and how much of that is
 * still awaiting a decision once `decided` (Moved to Goals or Buckets) is taken off. There is no
 * Windfall without a Baseline, since there's nothing to be beyond.
 */
export function windfallOf({
	baseline,
	received,
	decided,
}: {
	baseline: Cents | null;
	/** Income received in the month. */
	received: Cents;
	/** Windfall already Moved to Goals or Buckets. */
	decided: Cents;
}): { windfall: Cents; pending: Cents } {
	const windfall = baseline === null ? 0 : Math.max(0, received - baseline);
	return { windfall, pending: Math.max(0, windfall - decided) };
}

/** Income in `month`, received by the end of `day` (every day of it, when omitted). */
export function receivedIn(income: Income[], month: MonthKey, day?: number): Cents {
	return income.reduce(
		(sum, i) =>
			monthOfDay(i.date) === month && (day === undefined || Number(i.date.slice(8, 10)) <= day)
				? sum + i.amount
				: sum,
		0,
	);
}

/** The warning waits until mid-month: before then one paycheck early or late is just timing. */
export const INCOME_WARNING_FROM_DAY = 15;

/** Income short of what's expected by no more than this share of the Baseline isn't a warning. */
const INCOME_TOLERANCE = 0.05;

export type IncomeCheck = {
	/** Received this month by the end of the as-of day. */
	received: Cents;
	/** What was expected by then. */
	expected: Cents;
	/** How far `received` is behind `expected`; 0 when it isn't. */
	short: Cents;
	/** Income is tracking below the Baseline: worth a calm word from mid-month on. */
	below: boolean;
};

/**
 * Whether `month`'s income is keeping up with the Baseline as of `asOf`. Expected by now is what
 * came in by the same day last month (up to the Baseline), since paychecks land on much the same
 * days each month; without last month's income to go by, the Baseline pro-rated over the month.
 * Null when there's no Baseline, the month hasn't started, or no income has been recorded this
 * month or last (the Household isn't recording income, so there's nothing to warn about).
 */
export function incomeCheck({
	baseline,
	income,
	month,
	asOf,
}: {
	baseline: Cents | null;
	/** Income from (at least) this month and last. */
	income: Income[];
	month: MonthKey;
	asOf: DayKey;
}): IncomeCheck | null {
	const elapsed = daysElapsed(month, asOf);
	if (baseline === null || baseline <= 0 || elapsed === 0) return null;
	const last = addMonths(month, -1);
	const lastMonthTotal = receivedIn(income, last);
	const received = receivedIn(income, month, elapsed);
	if (lastMonthTotal <= 0 && receivedIn(income, month) <= 0) return null;
	const days = daysInMonth(month);
	// Once this month is over, all of last month counts, however long each month is.
	const sameDayLastMonth =
		elapsed === days ? daysInMonth(last) : Math.min(elapsed, daysInMonth(last));
	const expected =
		lastMonthTotal > 0
			? Math.min(baseline, receivedIn(income, last, sameDayLastMonth))
			: Math.round((baseline * elapsed) / days);
	const short = Math.max(0, expected - received);
	const below = elapsed >= INCOME_WARNING_FROM_DAY && short > baseline * INCOME_TOLERANCE;
	return { received, expected, short, below };
}

/** Where a Windfall can go: a Goal's Earmark, or a Bucket this month. */
export type WindfallDestination =
	| { kind: "goal"; goalId: string }
	| { kind: "bucket"; bucketId: string };

export type WindfallSuggestion = {
	to: WindfallDestination;
	name: string;
	/** What to send: what the destination needs, up to what's pending. */
	amount: Cents;
	/**
	 * `behind`: a Goal behind its schedule. `emergency`: the Household's emergency Goal.
	 * `overspent`: a Bucket that's over.
	 */
	reason: "behind" | "emergency" | "overspent";
};

/**
 * Where a pending Windfall could go, best first: Goals behind schedule, nearest target date
 * first; then the emergency Goal; then overspent Buckets, most overspent first. Each is an
 * alternative sized on its own, for what it needs up to the whole Windfall. Deterministic rules,
 * not a model: the same month always suggests the same.
 */
export function windfallSuggestions({
	pending,
	goals,
	emergencyGoalId,
	buckets,
}: {
	pending: Cents;
	/** The Household's active Goals (neither completed nor archived). */
	goals: {
		id: string;
		name: string;
		targetDate: DayKey | null;
		status: GoalStatus;
		remaining: Cents;
	}[];
	emergencyGoalId: string | null;
	/** The month's Buckets the Parent may Move money into. */
	buckets: Pick<BucketState, "id" | "name" | "left">[];
}): WindfallSuggestion[] {
	if (pending <= 0) return [];
	const behind = goals
		.filter((g) => (g.status === "behind" || g.status === "past-due") && g.remaining > 0)
		.sort((a, b) => (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999"));
	const emergency = goals.find(
		(g) => g.id === emergencyGoalId && g.remaining > 0 && !behind.includes(g),
	);
	const over = buckets.filter((b) => b.left < 0).sort((a, b) => a.left - b.left);
	return [
		...behind.map(
			(g): WindfallSuggestion => ({
				to: { kind: "goal", goalId: g.id },
				name: g.name,
				amount: Math.min(pending, g.remaining),
				reason: "behind",
			}),
		),
		...(emergency
			? [
					{
						to: { kind: "goal", goalId: emergency.id },
						name: emergency.name,
						amount: Math.min(pending, emergency.remaining),
						reason: "emergency",
					} satisfies WindfallSuggestion,
				]
			: []),
		...over.map(
			(b): WindfallSuggestion => ({
				to: { kind: "bucket", bucketId: b.id },
				name: b.name,
				amount: Math.min(pending, -b.left),
				reason: "overspent",
			}),
		),
	];
}
