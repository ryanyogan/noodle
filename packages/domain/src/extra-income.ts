import type { GoalStatus } from "./goals";
import type { Cents } from "./money";
import {
	addMonths,
	type DayKey,
	daysElapsed,
	daysInMonth,
	type MonthKey,
	monthEnded,
	monthOfDay,
} from "./month";
import type { BucketState } from "./month-state";
import type { PlanScope } from "./plan-scope";

/**
 * Income received on a day: a paycheck, a bonus, a tax refund. A Refund of a purchase is not
 * income; it is spending with a negative amount that restores its Bucket.
 */
export type Income = {
	amount: Cents;
	/** The day it landed: the bank's, or the one a Parent typed. Never changed by a pay day. */
	date: DayKey;
	/** The pay day it is the pay for, when it is a salaried Parent's paycheck (ADR-0063). */
	payDay?: DayKey | null;
};

/**
 * The day a line of Income counts on: the pay day it is the pay for, else the day it landed
 * (ADR-0063). Every total of Income by month reads the month from this day, never from `date`;
 * its twin in SQL is `incomeCountsOn` in @noodle/db (counting.ts).
 */
export const countsOn = (line: { date: DayKey; payDay?: DayKey | null }): DayKey =>
	line.payDay ?? line.date;

/**
 * Income above take-home pay by no more than this ($25) is the usual pay landing a few dollars
 * different, not Extra income: it raises no To do, Nudge or Check-in card (#86). Once income is
 * more than this above take-home pay, all of the difference is Extra income.
 */
export const EXTRA_INCOME_FROM: Cents = 2_500;

/**
 * A month's Extra income: the income received in it beyond take-home pay (when that's more than
 * EXTRA_INCOME_FROM), and how much of that is still awaiting a decision once `decided` (Moved to
 * Goals, Buckets or Free to Spend) is taken off. There is no Extra income without take-home pay,
 * since there's nothing to be beyond.
 */
export function extraIncomeOf({
	baseline,
	received,
	decided,
}: {
	baseline: Cents | null;
	/** Income received in the month. */
	received: Cents;
	/** Extra income already Moved to Goals, Buckets or Free to Spend. */
	decided: Cents;
}): { windfall: Cents; pending: Cents } {
	const beyond = baseline === null ? 0 : received - baseline;
	const extraIncome = beyond > EXTRA_INCOME_FROM ? beyond : 0;
	return { windfall: extraIncome, pending: Math.max(0, extraIncome - decided) };
}

/**
 * Income that counts in `month` by the end of `day` (every day of it, when omitted), each line on
 * the day it counts on.
 */
export function receivedIn(income: Income[], month: MonthKey, day?: number): Cents {
	return income.reduce((sum, i) => {
		const on = countsOn(i);
		return monthOfDay(on) === month && (day === undefined || Number(on.slice(8, 10)) <= day)
			? sum + i.amount
			: sum;
	}, 0);
}

/** The warning waits until mid-month: before then one paycheck early or late is just timing. */
export const INCOME_WARNING_FROM_DAY = 15;

/** Income short of what's expected by no more than this share of take-home pay isn't a warning. */
const INCOME_TOLERANCE = 0.05;

export type IncomeCheck = {
	/** Received this month by the end of the as-of day. */
	received: Cents;
	/** What was expected by then. */
	expected: Cents;
	/** How far `received` is behind `expected`; 0 when it isn't. */
	short: Cents;
	/**
	 * Income is below take-home pay: worth a calm word from mid-month on. While the month runs it is
	 * "behind where it usually is by now"; once it has `ended` it simply came in below the usual.
	 */
	below: boolean;
	/**
	 * The month is over: `received` is all of its Income and `expected` what a month usually brings
	 * (all of the month before, up to take-home pay). Nothing is "by now" or still to come.
	 */
	ended: boolean;
};

/**
 * Whether `month`'s income is keeping up with take-home pay as of `asOf`. Expected by now is what
 * came in by the same day last month (up to take-home pay), since paychecks land on much the same
 * days each month; without last month's income to go by, take-home pay pro-rated over the month.
 * Null when there's no take-home pay, the month hasn't started, or no income has been recorded this
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
	return { received, expected, short, below, ended: monthEnded(month, asOf) };
}

/** On This Month the step is offered in the month's last days, when little more pay is due. */
export const LOWER_PAY_LAST_DAYS = 5;

/**
 * The one-tap step for a low month (#86, ADR-0040): take-home pay in the Plan is the pay the
 * Household can count on, so when less than that arrives, this month's take-home pay is lowered to
 * what came in and Free to Spend stops reading too high.
 */
export type LowerTakeHomePay = {
	/** This month's take-home pay as it stands. */
	was: Cents;
	/** What it becomes: the Income received so far this month. */
	to: Cents;
	/** How far the Income is below take-home pay. */
	short: Cents;
	/**
	 * The month is in its last LOWER_PAY_LAST_DAYS days: worth offering on This Month. Before then
	 * a paycheck may still be on its way, so the step only sits quietly on Plan › Income.
	 */
	prompt: boolean;
};

/**
 * Whether `month`'s take-home pay can be lowered to what came in, and to what. Null unless `month`
 * is the Household's current month (an ended month's Plan is closed), it has take-home pay, some
 * Income has been recorded in it (a Household that records none isn't short), and the Income is
 * more than EXTRA_INCOME_FROM below take-home pay: a few dollars short is the usual pay landing a
 * little different, as a few dollars over is.
 */
export function lowerTakeHomePay({
	baseline,
	income,
	month,
	asOf,
}: {
	baseline: Cents | null;
	income: Income[];
	month: MonthKey;
	asOf: DayKey;
}): LowerTakeHomePay | null {
	if (baseline === null || baseline <= 0 || monthOfDay(asOf) !== month) return null;
	const received = receivedIn(income, month);
	const short = baseline - received;
	if (received <= 0 || short <= EXTRA_INCOME_FROM) return null;
	const daysLeft = daysInMonth(month) - daysElapsed(month, asOf);
	return { was: baseline, to: received, short, prompt: daysLeft < LOWER_PAY_LAST_DAYS };
}

/** A change to one month's take-home pay only ("Just <Month>"): later months keep their amount. */
export type TakeHomePayJust = { month: MonthKey; amountCents: Cents; scope: PlanScope };

/** The Plan change that lowers `month`'s take-home pay to what came in, for that month only. */
export const lowerTakeHomePayChange = (
	month: MonthKey,
	step: LowerTakeHomePay,
): TakeHomePayJust => ({
	month,
	amountCents: step.to,
	scope: "just",
});

/** Its Undo: `month`'s take-home pay back to what it was, again for that month only. */
export const undoLowerTakeHomePay = (month: MonthKey, step: LowerTakeHomePay): TakeHomePayJust => ({
	month,
	amountCents: step.was,
	scope: "just",
});

/** Free to Spend once the step is taken: it falls by exactly what take-home pay falls by. */
export const freeToSpendAfterLowering = (freeToSpend: Cents, step: LowerTakeHomePay): Cents =>
	freeToSpend - step.short;

/**
 * Where Extra income can go: what a Goal has set aside, a Bucket this month, or the month's Free
 * to Spend (a Parent's own choice, never by default: ADR-0001).
 */
export type ExtraIncomeDestination =
	| { kind: "goal"; goalId: string }
	| { kind: "bucket"; bucketId: string }
	| { kind: "free-to-spend" };

export type ExtraIncomeSuggestion = {
	to: ExtraIncomeDestination;
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
 * Where a pending Extra income could go, best first: Goals behind schedule, nearest target date
 * first; then the emergency Goal; then overspent Buckets, most overspent first. Each is an
 * alternative sized on its own, for what it needs up to the whole Extra income. Deterministic rules,
 * not a model: the same month always suggests the same.
 */
export function extraIncomeSuggestions({
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
}): ExtraIncomeSuggestion[] {
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
			(g): ExtraIncomeSuggestion => ({
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
					} satisfies ExtraIncomeSuggestion,
				]
			: []),
		...over.map(
			(b): ExtraIncomeSuggestion => ({
				to: { kind: "bucket", bucketId: b.id },
				name: b.name,
				amount: Math.min(pending, -b.left),
				reason: "overspent",
			}),
		),
	];
}
