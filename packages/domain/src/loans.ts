import { dayIn } from "./commitments";
import type { Cents } from "./money";
import {
	addMonths,
	type DayKey,
	daysInMonth,
	type MonthKey,
	monthOfDay,
	monthsBetween,
} from "./month";

// A loan's facts and the payments still to come (issue 153). A loan is an Account of kind "loan";
// what's owed on it is the Account's (owedOn, ADR-0050), and its payments are monthly. There is
// no interest here: the schedule is what's owed now, paid off at the payment, the last one being
// whatever is left. The payments the lender really takes are what count.

/**
 * What a Parent recorded about a loan, each null until they say: what was borrowed, what one
 * payment is, the day of the month it is due (1 to 31; the last day in shorter months), and the
 * day of its last payment.
 */
export type LoanFacts = {
	borrowed: Cents | null;
	payment: Cents | null;
	dueDay: number | null;
	endsOn: DayKey | null;
};

export const NO_LOAN_FACTS: LoanFacts = {
	borrowed: null,
	payment: null,
	dueDay: null,
	endsOn: null,
};

/** A payment still to come: the day it is due and what it is. */
export type ScheduledPayment = { date: DayKey; amount: Cents };

/** As many payments as a schedule lists (50 years of them); `count` still says how many there are. */
export const MAX_SCHEDULED_PAYMENTS = 600;

export type LoanSchedule = {
	/** The payments still to come, the next first; at most MAX_SCHEDULED_PAYMENTS of them. */
	payments: ScheduledPayment[];
	/** How many payments are left, listed or not. */
	count: number;
	/** The day of the last payment; null when nothing is owed. */
	paidOffOn: DayKey | null;
};

/** How many payments of `payment` bring `owed` to $0: the last may be smaller. */
export function paymentsLeft(owed: Cents, payment: Cents): number {
	if (owed <= 0 || payment <= 0) return 0;
	return Math.ceil(owed / payment);
}

/** The first day on or after `from` a loan due on `dueDay` of each month is due. */
export function nextLoanDue(dueDay: number, from: DayKey): DayKey {
	const thisMonth = dayIn(monthOfDay(from), dueDay);
	return thisMonth >= from ? thisMonth : dayIn(addMonths(monthOfDay(from), 1), dueDay);
}

/**
 * The first day the next payment can fall on: today, or the first of next month once a payment
 * dated this month is in (this month's is made, even when it was made before its due day).
 */
export function scheduleFrom(today: DayKey, lastPaid: DayKey | null): DayKey {
	const month = monthOfDay(today);
	return lastPaid !== null && monthOfDay(lastPaid) === month
		? (`${addMonths(month, 1)}-01` as DayKey)
		: today;
}

/** How many payments are due from `from` up to and including `endsOn`. */
export function paymentsUntil(endsOn: DayKey, dueDay: number, from: DayKey): number {
	const first = nextLoanDue(dueDay, from);
	if (first > endsOn) return 0;
	const months = monthsBetween(monthOfDay(first), monthOfDay(endsOn));
	// The end's own month counts when its due day has come by then.
	return months + (dayIn(monthOfDay(endsOn), dueDay) <= endsOn ? 1 : 0);
}

/** The day of the `count`th payment from `from`: when a loan with that many left ends. */
export function endsAfter(count: number, dueDay: number, from: DayKey): DayKey {
	const first = nextLoanDue(dueDay, from);
	return dayIn(addMonths(monthOfDay(first), Math.max(1, count) - 1), dueDay);
}

/**
 * A day a monthly Commitment for the loan's payments is due, for its terms: `dueDay` in the first
 * month from `today`'s that has that day, so the 31st stays the 31st (a monthly Commitment is due
 * on its due date's day of the month).
 */
export function dueDateOn(dueDay: number, today: DayKey): DayKey {
	let month: MonthKey = monthOfDay(today);
	while (daysInMonth(month) < dueDay) month = addMonths(month, 1);
	return dayIn(month, dueDay);
}

/**
 * The payments still to come on a loan that owes `owed`, monthly on `dueDay` from the first due
 * day on or after `from`. With a payment amount: that much each time, the last being the
 * remainder. Without one but with the day it ends: what's owed spread evenly over the due days up
 * to then, the remainder on the last. Null when there isn't enough to say (nothing known to be
 * owed, no due day, or neither a payment nor an end); no payments once nothing is owed.
 */
export function loanSchedule(input: {
	owed: Cents | null;
	payment: Cents | null;
	dueDay: number | null;
	endsOn: DayKey | null;
	from: DayKey;
}): LoanSchedule | null {
	const { owed, payment, dueDay, endsOn, from } = input;
	if (owed === null || dueDay === null) return null;
	if (owed <= 0) return { payments: [], count: 0, paidOffOn: null };
	let count: number;
	let each: Cents;
	if (payment !== null && payment > 0) {
		count = paymentsLeft(owed, payment);
		each = payment;
	} else if (endsOn !== null) {
		// An end that has passed, or comes before the next due day, leaves one payment: all of it.
		count = Math.max(1, paymentsUntil(endsOn, dueDay, from));
		each = Math.floor(owed / count);
	} else {
		return null;
	}
	const first = monthOfDay(nextLoanDue(dueDay, from));
	const payments: ScheduledPayment[] = [];
	for (let i = 0; i < Math.min(count, MAX_SCHEDULED_PAYMENTS); i++) {
		payments.push({
			date: dayIn(addMonths(first, i), dueDay),
			amount: i === count - 1 ? owed - each * (count - 1) : each,
		});
	}
	return { payments, count, paidOffOn: dayIn(addMonths(first, count - 1), dueDay) };
}

/** What has been paid on a loan so far: what was borrowed less what's owed, never below $0. */
export function loanPaid(borrowed: Cents | null, owed: Cents | null): Cents | null {
	if (borrowed === null || owed === null) return null;
	return Math.max(0, borrowed - owed);
}
