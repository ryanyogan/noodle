import { countsOn, EXTRA_INCOME_FROM } from "./extra-income";
import type { Cents } from "./money";
import { addMonths, type DayKey, type MonthKey, monthOfDay } from "./month";

// Whose pay, and its range (issue 133; ADR-0040 as amended by ADR-0057). Income says whose pay it
// is: a Parent's, or the Household's. A Parent whose pay varies is shown its range over the last
// three full months; the Take-home pay stays one Household figure that counts on the low end.

/** Income, with whose pay it is: a Parent's ID, or null for the Household. */
export type PayLine = {
	amount: Cents;
	date: DayKey;
	/** The pay day it is the pay for: it counts in that day's month (ADR-0063). */
	payDay?: DayKey | null;
	whosePay: string | null;
};

export type PayRange = {
	/** A Parent's ID, or null for the Household. */
	whosePay: string | null;
	/** What has come in in the month looked at. */
	soFar: Cents;
	/** The lowest and highest month of the three full months before it; null unless all three had pay. */
	usual: { low: Cents; high: Cents } | null;
	/** The pay moves by more than a few dollars from month to month. */
	varies: boolean;
	/**
	 * What can be counted on. A Parent's: the lowest of the three months that had pay, so one who
	 * started a month or two ago counts for what they've been paid; 0 when the pay has stopped (none
	 * last month and none yet this month). The Household's own: the lowest of the three, 0 unless
	 * all three had some, since one line of its own is a one-off.
	 */
	countOn: Cents;
};

/** How many full months what is usual is read from. */
export const PAY_RANGE_MONTHS = 3;

/**
 * Each Parent's pay (and the Household's) in `month` and over the three full months before it,
 * from Income that counts. Parents first, in the order of their IDs, the Household last. Whoever
 * had no pay in any of the four months is left out.
 */
export function payRanges(lines: readonly PayLine[], month: MonthKey): PayRange[] {
	const months = Array.from({ length: PAY_RANGE_MONTHS }, (_, i) => addMonths(month, -(i + 1)));
	const byWho = new Map<string | null, { soFar: number; months: Map<MonthKey, number> }>();
	for (const line of lines) {
		const lineMonth = monthOfDay(countsOn(line));
		if (lineMonth !== month && !months.includes(lineMonth)) continue;
		let who = byWho.get(line.whosePay);
		if (!who) {
			who = { soFar: 0, months: new Map() };
			byWho.set(line.whosePay, who);
		}
		if (lineMonth === month) who.soFar += line.amount;
		else who.months.set(lineMonth, (who.months.get(lineMonth) ?? 0) + line.amount);
	}
	return [...byWho.entries()]
		.sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0))
		.map(([whosePay, who]) => {
			const totals = months.map((m) => who.months.get(m) ?? 0);
			const low = Math.min(...totals) as Cents;
			const high = Math.max(...totals) as Cents;
			const usual = totals.every((total) => total > 0) ? { low, high } : null;
			return {
				whosePay,
				soFar: who.soFar as Cents,
				usual,
				varies: usual !== null && high - low > EXTRA_INCOME_FROM,
				countOn: countOn(whosePay, totals, who.soFar),
			};
		});
}

/** What `totals` (the full months, newest first) and the month so far let a Household count on. */
function countOn(whosePay: string | null, totals: readonly number[], soFar: number): Cents {
	const paid = totals.filter((total) => total > 0);
	if (whosePay === null) return (paid.length === totals.length ? Math.min(...paid) : 0) as Cents;
	const stopped = (totals[0] ?? 0) <= 0 && soFar <= 0;
	return (stopped || paid.length === 0 ? 0 : Math.min(...paid)) as Cents;
}

/**
 * "Use $X as what you can count on": the low ends added up, offered as the Take-home pay when a
 * Parent's pay varies and that sum has moved more than a few dollars away from it. Somebody who
 * started or stopped is counted as `countOn` says, and is never the reason for the offer. Still
 * one Household figure (ADR-0040); null when there is nothing to offer.
 */
export function countOnOffer(input: {
	baseline: Cents | null;
	ranges: readonly PayRange[];
}): Cents | null {
	const { baseline, ranges } = input;
	if (baseline === null) return null;
	if (!ranges.some((range) => range.whosePay !== null && range.varies)) return null;
	const sum = ranges.reduce((total, range) => total + range.countOn, 0);
	if (sum <= 0 || Math.abs(sum - baseline) <= EXTRA_INCOME_FROM) return null;
	return sum as Cents;
}
