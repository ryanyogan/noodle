import { EXTRA_INCOME_FROM, LOWER_PAY_LAST_DAYS } from "./extra-income";
import type { Cents } from "./money";
import { type DayKey, daysElapsed, daysInMonth, type MonthKey, monthOfDay } from "./month";

// A lean month says so (issue 159, phase b; ADR-0067): how far the month's Income is from the
// Take-home pay the Plan counts on, and how much Pay to come is expected against that. Pay often
// lands late in a month, so it is "in so far" until the month's last days and "short" only then.

export type LeanMonth = {
	/** The Take-home pay, the Income in so far, and the difference. */
	planned: Cents;
	inSoFar: Cents;
	gap: Cents;
	/** The month is in its last days (ADR-0040's five), when little more pay is due: "short". */
	short: boolean;
	daysLeft: number;
	/** Pay to come expected by the end of the month, with the latest of those days. */
	toCome: Cents;
	by: DayKey | null;
	/** Every one of those days has passed. */
	overdue: boolean;
	/** Pay to come with no day expected: said, and not set against the gap. */
	noDay: Cents;
	/** What the gap would be once `toCome` is in; 0 when it covers it. */
	after: Cents;
};

/**
 * How `month` stands against its Take-home pay, or null when there is nothing to say: it isn't
 * the Household's current month, it has no Take-home pay, or the Income is within a few dollars
 * of it (or over). It speaks before the month's last days only when Pay to come is waiting,
 * since then it has something to add; in the last days it also speaks for a Household with a
 * Parent whose pay `varies`, with or without any.
 */
export function leanMonth(input: {
	baseline: Cents | null;
	received: Cents;
	month: MonthKey;
	asOf: DayKey;
	varies: boolean;
	waiting: readonly { left: Cents; expectedOn: DayKey | null }[];
}): LeanMonth | null {
	const { baseline, received, month, asOf } = input;
	if (baseline === null || baseline <= 0 || monthOfDay(asOf) !== month) return null;
	const gap = baseline - received;
	if (gap <= EXTRA_INCOME_FROM) return null;
	const daysLeft = daysInMonth(month) - daysElapsed(month, asOf);
	const short = daysLeft < LOWER_PAY_LAST_DAYS;
	const waiting = input.waiting.filter((pay) => pay.left > 0);
	if (waiting.length === 0 && !(short && input.varies)) return null;
	// Expected in this month, or before it and late: either way it is due by the month's end.
	const due = waiting.filter(
		(pay) => pay.expectedOn !== null && monthOfDay(pay.expectedOn) <= month,
	);
	const toCome = due.reduce((sum, pay) => sum + pay.left, 0);
	const by = due.reduce<DayKey | null>(
		(latest, pay) =>
			latest === null || (pay.expectedOn as DayKey) > latest ? pay.expectedOn : latest,
		null,
	);
	return {
		planned: baseline,
		inSoFar: received,
		gap: gap as Cents,
		short,
		daysLeft,
		toCome: toCome as Cents,
		by,
		overdue: by !== null && by < asOf,
		noDay: waiting
			.filter((pay) => pay.expectedOn === null)
			.reduce((sum, pay) => sum + pay.left, 0) as Cents,
		after: Math.max(0, gap - toCome) as Cents,
	};
}
