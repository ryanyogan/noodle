import type { Cents } from "./money";
import {
	addDays,
	addMonths,
	type DayKey,
	daysBetween,
	daysInMonth,
	type MonthKey,
	monthOfDay,
} from "./month";

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

/** What a Commitment on these terms takes in a year: 12 monthly, 26 biweekly, or 1 annual payment. */
export function yearlyCost(terms: Pick<CommitmentTerms, "amount" | "cadence">): Cents {
	switch (terms.cadence) {
		case "monthly":
			return terms.amount * 12;
		case "biweekly":
			return terms.amount * 26;
		case "annual":
			return terms.amount;
	}
}

/** What a Commitment on these terms takes in an average month: its yearly cost over 12. */
export function monthlyEquivalent(terms: Pick<CommitmentTerms, "amount" | "cadence">): Cents {
	return Math.round(yearlyCost(terms) / 12);
}

/** The first day on or after `from` a Commitment on these terms is due. */
export function nextDueDate(
	terms: Pick<CommitmentTerms, "cadence" | "dueDate">,
	from: DayKey,
): DayKey {
	const start = monthOfDay(from);
	// Every cadence is due at least once in any 12 months, so the 13th is never reached.
	for (let i = 0; ; i++) {
		const due = dueDatesIn(terms, addMonths(start, i)).find((day) => day >= from);
		if (due) return due;
	}
}

/**
 * Commitments in the order they're next due on or after `from`, the earliest first; ties in the
 * order they were added (their IDs are ULIDs).
 */
export function byNextDue<T extends { id: string } & Pick<CommitmentTerms, "cadence" | "dueDate">>(
	commitments: readonly T[],
	from: DayKey,
): T[] {
	return commitments
		.map((commitment) => ({ commitment, next: nextDueDate(commitment, from) }))
		.sort(
			(a, b) =>
				(a.next < b.next ? -1 : a.next > b.next ? 1 : 0) ||
				(a.commitment.id < b.commitment.id ? -1 : 1),
		)
		.map(({ commitment }) => commitment);
}
