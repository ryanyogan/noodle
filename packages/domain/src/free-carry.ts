import type { Cents } from "./money";
import { addMonths, type MonthKey } from "./month";
import { freeToSpend, type PlanRecords, planForMonth } from "./plan";

// Free to Spend is carried over (issue 113, ADR-0054). A month's Free to Spend is what the months
// before it left, or were short by, plus the month's own figure. Like a Bucket that Carries over
// (see rollover.ts), the carry is derived by walking the months and is never stored, so a late
// change to an ended month reaches the months after it.
//
// - An ended month hands on what it actually ended with: what was carried into it plus its Actual
//   Free to Spend (see actualFigures in year.ts), not what its Plan said would be left.
// - The Household's month and the months ahead hand on their Plan figure plus what they carried.

/** A month's total of something, e.g. everything Moved out of Free to Spend in it. */
export type MonthAmount = { month: MonthKey; amount: Cents };

/**
 * The first month Free to Spend is carried from: the Household's first month with take-home pay
 * set, a Bucket or a Commitment. Months before it (bank history imported from before Noodle was
 * in use) carry nothing. Null when nothing is planned by `through`. This is the one place that
 * rule lives.
 */
export function firstCarryMonth(records: PlanRecords, through: MonthKey): MonthKey | null {
	const months = [
		...records.baselines.map((b) => b.month),
		...records.buckets.map((b) => b.fromMonth),
		...records.commitments.map((c) => c.fromMonth),
	].filter((month) => month <= through);
	if (months.length === 0) return null;
	return months.reduce((first, month) => (month < first ? month : first));
}

/** One month of Free to Spend being carried over. */
export type FreeCarryMonth = {
	month: MonthKey;
	/** Whether the month is over (before the Household's month): it hands on its actual. */
	ended: boolean;
	/** Carried in from the month before; below zero when the months before were short. */
	carriedIn: Cents;
	/**
	 * The month's own figure, nothing carried: an ended month's Actual Free to Spend, else its
	 * Plan's (take-home pay less Commitments, allowances, Covers and Goal funding, plus Extra
	 * income added).
	 */
	own: Cents;
	/** What it hands on to the next month: `carriedIn + own`, whatever the sign. */
	left: Cents;
};

export type CarryInputs = {
	/** Every Plan record through the last month walked. */
	records: PlanRecords;
	/** The Household's month: the months before it are over. */
	current: MonthKey;
	/** Per ended month walked, its Actual Free to Spend (a month with none counts as zero). */
	actual: readonly MonthAmount[];
	/**
	 * Per month not yet over, everything Moved out of Free to Spend (Covers from it and Goal
	 * funding, never Moves of Extra income). Ended months' are not read.
	 */
	outOfFree: readonly MonthAmount[];
	/** Per month not yet over, Extra income a Parent added to Free to Spend. */
	extraToFree: readonly MonthAmount[];
};

/**
 * Free to Spend month by month from the first month with a Plan through `to`, each month with
 * what the one before handed on (nothing into the first). Empty when `to` is before that month.
 */
export function freeCarryMonths({
	records,
	current,
	actual,
	outOfFree,
	extraToFree,
	to,
}: CarryInputs & { to: MonthKey }): FreeCarryMonth[] {
	const from = firstCarryMonth(records, to);
	if (from === null) return [];
	const actuals = totals(actual);
	const out = totals(outOfFree);
	const extra = totals(extraToFree);
	const months: FreeCarryMonth[] = [];
	let carriedIn = 0;
	for (let month = from; month <= to; month = addMonths(month, 1)) {
		const ended = month < current;
		const own = ended
			? (actuals.get(month) ?? 0)
			: freeToSpend(planForMonth(records, month)) - (out.get(month) ?? 0) + (extra.get(month) ?? 0);
		const left = carriedIn + own;
		months.push({ month, ended, carriedIn, own, left });
		carriedIn = left;
	}
	return months;
}

/**
 * What the months before `month` left for its Free to Spend, or were short by: zero for the first
 * month with a Plan and any before it. Pass it to `monthState` as `freeCarriedIn`.
 */
export function freeCarriedIn({ month, ...inputs }: CarryInputs & { month: MonthKey }): Cents {
	const months = freeCarryMonths({ ...inputs, to: addMonths(month, -1) });
	return months[months.length - 1]?.left ?? 0;
}

function totals(rows: readonly MonthAmount[]): Map<MonthKey, Cents> {
	const byMonth = new Map<MonthKey, Cents>();
	for (const { month, amount } of rows) byMonth.set(month, (byMonth.get(month) ?? 0) + amount);
	return byMonth;
}
