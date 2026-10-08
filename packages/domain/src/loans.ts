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

// --- Paid off, and the payments made against the schedule (issue 153, phase d) ----------------

/** A payment made to a loan: the day it is dated and what it was (below 0 for one handed back). */
export type LoanPayment = { date: DayKey; amount: Cents };

/**
 * The day a loan was paid off: the day what's owed (owedOn) came to $0 or under and stayed
 * there. Kept by hand, that is the day of the payment that brought it there, or the balance's own
 * day when the balance says nothing is owed; a payment on the balance's day or before is already
 * in it. Connected, only the bank's balance says so. Null while anything is owed, or with no
 * balance: deleting or moving the payment that paid it off, or a balance entered above $0, makes
 * it null again with nothing written (ADR-0050).
 */
export function loanPaidOffOn(
	latest: { amount: Cents; day: DayKey } | null,
	payments: readonly LoanPayment[],
	connected = false,
): DayKey | null {
	if (latest === null) return null;
	let owed = latest.amount;
	let since: DayKey | null = owed <= 0 ? latest.day : null;
	if (connected) return since;
	const after = payments
		.filter((payment) => payment.date > latest.day)
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	for (const payment of after) {
		owed -= payment.amount;
		if (owed > 0) since = null;
		else if (since === null) since = payment.date;
	}
	return since;
}

/**
 * The first month a Commitment is no longer in the Plan: the month a Parent ended it from, or the
 * month after the loan it pays down was paid off, whichever comes first. The month it was paid
 * off in still plans it, once.
 */
export function endedOrPaidOff(ended: MonthKey | null, paidOffOn: DayKey | null): MonthKey | null {
	if (paidOffOn === null) return ended;
	const after = addMonths(monthOfDay(paidOffOn), 1);
	return ended !== null && ended <= after ? ended : after;
}

/**
 * A loan's payment and due day while a monthly Commitment in the Plan pays it down: the
 * Commitment's terms this month are the ones that count, so the two can't disagree. With no such
 * Commitment (or one that isn't monthly) the facts stand as a Parent gave them.
 */
export function loanInStep(
	facts: LoanFacts,
	terms: { amount: Cents; cadence: string; dueDate: DayKey } | null | undefined,
): LoanFacts {
	if (terms?.cadence !== "monthly") return facts;
	return { ...facts, payment: terms.amount, dueDay: Number(terms.dueDate.slice(8)) };
}

/**
 * Where a scheduled payment stands. "paid": that month's payments came to the payment or more
 * (or paid the loan off). "partly": something was paid, but less. "missed": an earlier month with
 * nothing paid. "due": this month's, its due day here or gone, with nothing paid yet. "to-come":
 * a later due day.
 */
export type PaymentState = "paid" | "partly" | "missed" | "due" | "to-come";

export type SchedulePayment = {
	/** The day it is, or was, due. */
	date: DayKey;
	/** What the schedule asks for that day. */
	amount: Cents;
	state: PaymentState;
	/** What was really paid in that day's month, and the day of the latest payment in it. */
	paid: Cents;
	paidOn: DayKey | null;
	/** How many payments that month's total is. */
	payments: number;
};

export type PaymentSchedule = {
	/**
	 * Every scheduled payment, the earliest first: one for each month from the first payment made,
	 * then those still to be made (at most MAX_SCHEDULED_PAYMENTS of them).
	 */
	payments: SchedulePayment[];
	/** How many are still to be made ("due" and "to-come"), listed or not. */
	left: number;
	/** The day of the last payment still to be made; null when nothing is owed. */
	paidOffOn: DayKey | null;
};

/**
 * A loan's payments against its schedule: each month's due day with what was really paid in that
 * month, then the payments still to be made (loanSchedule, from what's owed now). A month's
 * payments are judged together, so two halves make it paid, and whatever a missed or short month
 * left unpaid is in what's owed and so in the payments to come, not asked for twice. Null when
 * there is no schedule to hold them against (loanSchedule's rule).
 */
export function paymentSchedule(input: {
	owed: Cents | null;
	payment: Cents | null;
	dueDay: number | null;
	endsOn: DayKey | null;
	today: DayKey;
	/** Every payment made to the loan, in any order. */
	payments: readonly LoanPayment[];
}): PaymentSchedule | null {
	const { owed, payment, dueDay, endsOn, today } = input;
	if (owed === null || dueDay === null) return null;
	if (owed > 0 && (payment === null || payment <= 0) && endsOn === null) return null;
	const current = monthOfDay(today);
	const months = new Map<MonthKey, { paid: Cents; paidOn: DayKey; payments: number }>();
	for (const made of input.payments) {
		// A payment dated ahead of today isn't made yet.
		if (made.date > today) continue;
		const month = monthOfDay(made.date);
		const so = months.get(month);
		months.set(month, {
			paid: (so?.paid ?? 0) + made.amount,
			paidOn: so && so.paidOn > made.date ? so.paidOn : made.date,
			payments: (so?.payments ?? 0) + 1,
		});
	}
	// A month whose payments were all handed back paid nothing.
	for (const [month, so] of months) if (so.paid <= 0) months.delete(month);
	const paidMonths = [...months.keys()].sort();
	const first = paidMonths[0];
	const last = paidMonths[paidMonths.length - 1];
	const rows: SchedulePayment[] = [];
	if (first !== undefined && last !== undefined) {
		// Once nothing is owed the schedule stops at the payment that paid it off.
		const until = owed <= 0 ? last : current;
		for (let month = first; month <= until; month = addMonths(month, 1)) {
			const so = months.get(month);
			const date = dayIn(month, dueDay);
			if (so) {
				const asked = payment !== null && payment > 0 ? payment : so.paid;
				const paidOff = owed <= 0 && month === last;
				rows.push({
					date,
					amount: asked,
					state: so.paid >= asked || paidOff ? "paid" : "partly",
					...so,
				});
			} else if (month < current && payment !== null && payment > 0) {
				rows.push({ date, amount: payment, state: "missed", paid: 0, paidOn: null, payments: 0 });
			}
		}
	}
	// This month's is made once a payment is dated in it; otherwise it is the first still to be
	// made, even when its due day has gone by.
	const from = months.has(current)
		? (`${addMonths(current, 1)}-01` as DayKey)
		: (`${current}-01` as DayKey);
	const toCome = loanSchedule({ owed, payment, dueDay, endsOn, from });
	for (const next of toCome?.payments ?? []) {
		rows.push({
			...next,
			state: next.date <= today ? "due" : "to-come",
			paid: 0,
			paidOn: null,
			payments: 0,
		});
	}
	return { payments: rows, left: toCome?.count ?? 0, paidOffOn: toCome?.paidOffOn ?? null };
}
