import type { Cents } from "./money";
import { addDays, type DayKey, daysBetween, type MonthKey, monthOfDay } from "./month";

// Pay to come (issue 159, phase a; ADR-0066). A Parent whose pay varies records pay they have
// earned that is not in yet: who it is from, how much, and when it is expected. It is a note of
// what is on its way and counts nowhere: not as Income, toward the Take-home pay, as Extra income
// or in Free to Spend. Pay counts in the month it arrives, as Income like any other; the line of
// Income it arrives as is then kept on the Pay to come, which stops waiting. A payment for part
// of it leaves the rest waiting.

/**
 * A line of Income this close to what is still to come, either way, is offered as all of it: what
 * comes off a client's payment on the way is a bank's wire fee, $15 to $50 in the US. Only the
 * exact amount is ever matched without a Parent saying so.
 */
export const PAY_TO_COME_WITHIN: Cents = 50_00 as Cents;
/** By hand a Parent may pick Income that landed up to this many days before they recorded it. */
export const PAY_TO_COME_BEFORE_DAYS = 31;

/** A line of Income a Pay to come arrived as, in whole or in part. */
export type PayArrival = {
	incomeId: string;
	/** How much of the Pay to come this line is: all that was left, or the line's own amount. */
	covers: Cents;
	/** The line's own amount and the day it landed. */
	amount: Cents;
	date: DayKey;
};

export type PayToCome = {
	id: string;
	/** The Parent whose pay it is. */
	memberId: string;
	/** Who it is from: a client's name, as the Parent typed it. */
	from: string;
	/** What was earned. */
	amount: Cents;
	/** The day it is expected; null when the Parent didn't say. */
	expectedOn: DayKey | null;
	/** The Household's day it was recorded on. */
	recordedOn: DayKey;
	/** The Income it has arrived as, earliest first. */
	arrivals: PayArrival[];
	/** Lines of Income a Parent said are not this pay: never offered or matched to it again. */
	notThis: string[];
};

/** What has arrived of it. */
export const payToComeIn = (pay: Pick<PayToCome, "arrivals">): Cents =>
	pay.arrivals.reduce((sum, arrival) => sum + arrival.covers, 0) as Cents;

/** What is still to come of it: nothing once all of it is in. */
export const payToComeLeft = (pay: Pick<PayToCome, "amount" | "arrivals">): Cents =>
	Math.max(0, pay.amount - payToComeIn(pay)) as Cents;

/** A line of Income that counts and is not the pay for a Pay day. */
export type PayToComeLine = {
	id: string;
	amount: Cents;
	date: DayKey;
	/** Whose pay it is: a Parent's ID, or null when nobody has said. */
	whosePay: string | null;
};

/**
 * How a line's amount reads against what is still to come: `exact`; `close` (within
 * `PAY_TO_COME_WITHIN`, either way); `part` (less than that); `more`.
 */
export type PayFit = "exact" | "close" | "part" | "more";

export function payFit(left: Cents, amount: Cents): PayFit {
	if (amount === left) return "exact";
	if (Math.abs(amount - left) <= PAY_TO_COME_WITHIN) return "close";
	return amount < left ? "part" : "more";
}

/** The lines some Pay to come has already arrived as: one line is one payment at most. */
const arrivedLines = (all: readonly PayToCome[]) =>
	new Set(all.flatMap((pay) => pay.arrivals.map((arrival) => arrival.incomeId)));

/**
 * The lines a Parent can say `pay` arrived as, newest first, each with how its amount fits: the
 * Parent's own pay, or Income nobody has said whose pay it is, that landed no more than
 * `PAY_TO_COME_BEFORE_DAYS` before it was recorded, is no other Pay to come's, and that the
 * Parent hasn't said is not this one. None once all of it is in.
 */
export function payToComeChoices(
	pay: PayToCome,
	all: readonly PayToCome[],
	lines: readonly PayToComeLine[],
): { line: PayToComeLine; fit: PayFit }[] {
	const left = payToComeLeft(pay);
	if (left === 0) return [];
	const taken = arrivedLines(all);
	const since = addDays(pay.recordedOn, -PAY_TO_COME_BEFORE_DAYS);
	return lines
		.filter(
			(line) =>
				(line.whosePay === pay.memberId || line.whosePay === null) &&
				line.date >= since &&
				!taken.has(line.id) &&
				!pay.notThis.includes(line.id),
		)
		.map((line) => ({ line, fit: payFit(left, line.amount) }))
		.sort((a, b) => b.line.date.localeCompare(a.line.date) || a.line.id.localeCompare(b.line.id));
}

/**
 * The lines offered as `pay` having arrived ("Is this it?"): of its choices, those that landed on
 * or after the day it was recorded and are all of it, exactly or within `PAY_TO_COME_WITHIN`; the
 * exact ones first.
 */
export function payToComeOffers(
	pay: PayToCome,
	all: readonly PayToCome[],
	lines: readonly PayToComeLine[],
): PayToComeLine[] {
	return payToComeChoices(pay, all, lines)
		.filter(({ line, fit }) => line.date >= pay.recordedOn && (fit === "exact" || fit === "close"))
		.sort((a, b) => Number(b.fit === "exact") - Number(a.fit === "exact"))
		.map(({ line }) => line);
}

/** A line of Income to keep on a Pay to come. */
export type PayToComeMatch = { payToComeId: string; incomeId: string; covers: Cents };

/**
 * What is matched without asking: a line that is the same Parent's pay, landed on or after the
 * day the Pay to come was recorded, and is exactly what is still to come, when that is the only
 * Pay to come the line can be and the only line it can be. Anything else (a few dollars off, a
 * part, two clients owing the same amount, Income nobody has said whose pay it is) is left for a
 * Parent to say. With `only`, just those lines are matched (the ones that have just arrived or
 * changed); the rest still count toward what is ambiguous.
 */
export function payToComeMatches(input: {
	all: readonly PayToCome[];
	lines: readonly PayToComeLine[];
	only?: readonly string[];
}): PayToComeMatch[] {
	const { all, lines } = input;
	const only = input.only ? new Set(input.only) : null;
	const taken = arrivedLines(all);
	const open = all.filter((pay) => payToComeLeft(pay) > 0);
	const fits = (pay: PayToCome, line: PayToComeLine) =>
		line.whosePay === pay.memberId &&
		line.date >= pay.recordedOn &&
		line.amount === payToComeLeft(pay) &&
		!taken.has(line.id) &&
		!pay.notThis.includes(line.id);
	const matches: PayToComeMatch[] = [];
	for (const line of lines) {
		if (only && !only.has(line.id)) continue;
		const [pay, another] = open.filter((candidate) => fits(candidate, line));
		if (!pay || another) continue;
		if (lines.some((other) => other.id !== line.id && fits(pay, other))) continue;
		matches.push({ payToComeId: pay.id, incomeId: line.id, covers: line.amount });
	}
	return matches;
}

/** How many days past its expected day a Pay to come still waiting is; null when it isn't late. */
export function payToComeLateBy(
	pay: Pick<PayToCome, "amount" | "arrivals" | "expectedOn">,
	today: DayKey,
): number | null {
	if (pay.expectedOn === null || payToComeLeft(pay) === 0 || today <= pay.expectedOn) return null;
	return daysBetween(pay.expectedOn, today);
}

/** What Plan › Income says of one Parent's Pay to come in a month. */
export type PayToComeMonth = {
	/** Earned, not in yet: the expected day first, earliest first, then those with none. */
	waiting: { pay: PayToCome; left: Cents; lateBy: number | null }[];
	/** The total still to come. It counts nowhere. */
	total: Cents;
	/** What arrived in the month: each line of Income a Pay to come came in as. */
	arrived: { pay: PayToCome; arrival: PayArrival }[];
};

/**
 * One month's reading of `pays`. What is still waiting is listed from the month it was recorded
 * to the current month (or the month it is expected in, if later), since it was not in during any
 * of them; late is always against `today`. What arrived is listed in the month its Income landed.
 */
export function payToComeMonth(
	pays: readonly PayToCome[],
	month: MonthKey,
	today: DayKey,
): PayToComeMonth {
	const current = monthOfDay(today);
	const waiting = pays
		.filter((pay) => {
			if (payToComeLeft(pay) === 0 || month < monthOfDay(pay.recordedOn)) return false;
			const last = pay.expectedOn ? monthOfDay(pay.expectedOn) : current;
			return month <= (last > current ? last : current);
		})
		.map((pay) => ({ pay, left: payToComeLeft(pay), lateBy: payToComeLateBy(pay, today) }))
		.sort(
			(a, b) =>
				(a.pay.expectedOn ?? "9999").localeCompare(b.pay.expectedOn ?? "9999") ||
				a.pay.id.localeCompare(b.pay.id),
		);
	const arrived = pays
		.flatMap((pay) => pay.arrivals.map((arrival) => ({ pay, arrival })))
		.filter(({ arrival }) => monthOfDay(arrival.date) === month)
		.sort((a, b) => a.arrival.date.localeCompare(b.arrival.date));
	const total = waiting.reduce((sum, { left }) => sum + left, 0) as Cents;
	return { waiting, total, arrived };
}
