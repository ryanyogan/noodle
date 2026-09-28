import type { Cents } from "./money";
import { addDays, type DayKey, daysBetween, daysInMonth, type MonthKey } from "./month";

/** How often a Commitment is due. */
export type Cadence = "monthly" | "biweekly" | "annual";

export const CADENCES: readonly Cadence[] = ["monthly", "biweekly", "annual"];

/**
 * What a Commitment expects: `amount` each time it's due, on a schedule set by `cadence` and
 * one day it's due, `dueDate`. The schedule runs both ways from that day, so any real due date
 * sets it:
 * - monthly: every month, on `dueDate`'s day of the month (the last day in shorter months);
 * - biweekly: every 14th day before and after `dueDate`, so a month has two or three;
 * - annual: every year in `dueDate`'s month, on its day (Feb 29 is Feb 28 in common years).
 */
export type CommitmentTerms = { amount: Cents; cadence: Cadence; dueDate: DayKey };

const dayIn = (month: MonthKey, day: number): DayKey =>
	`${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}` as DayKey;

/** The days in `month` a Commitment on these terms is due, in order. */
export function dueDatesIn(
	terms: Pick<CommitmentTerms, "cadence" | "dueDate">,
	month: MonthKey,
): DayKey[] {
	const day = Number(terms.dueDate.slice(8, 10));
	switch (terms.cadence) {
		case "monthly":
			return [dayIn(month, day)];
		case "annual":
			return terms.dueDate.slice(5, 7) === month.slice(5, 7) ? [dayIn(month, day)] : [];
		case "biweekly": {
			const first = `${month}-01` as DayKey;
			// Days from the 1st to the next due date on or after it.
			const offset = ((daysBetween(first, terms.dueDate) % 14) + 14) % 14;
			const dates: DayKey[] = [];
			for (let d = offset; d < daysInMonth(month); d += 14) dates.push(addDays(first, d));
			return dates;
		}
	}
}

/** What a Commitment on these terms is expected to take in `month`. */
export function expectedIn(terms: CommitmentTerms, month: MonthKey): Cents {
	return terms.amount * dueDatesIn(terms, month).length;
}
