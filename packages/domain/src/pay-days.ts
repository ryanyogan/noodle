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

// Pay days (issue 156). A Parent says how they are paid: on a salary, with the usual amount of
// one paycheck and the days it is due, or hourly / pay that varies, with nothing to set. Income
// that is a salaried Parent's pay and landed near a pay day is the pay for it: the pay day is
// kept on the line, and the line counts in the pay day's month (`countsOn`, ADR-0063), so a
// paycheck for the 1st that the bank posted on the 30th is next month's Income. The bank's date
// and amount never change, and the Take-home pay is still one Household figure (ADR-0040).

/**
 * When a salaried Parent is paid. Stored as JSON (`members.pay_schedule`), told apart by `kind`,
 * so every two weeks and weekly can be added as further kinds without a migration.
 */
export type PaySchedule =
	/** Two days of the month, the earlier first: the 1st and the 15th. */
	| { kind: "twice-a-month"; days: [number, number] }
	/** One day of the month. */
	| { kind: "monthly"; day: number };

export const PAY_SCHEDULE_KINDS = ["twice-a-month", "monthly"] as const;
export type PayScheduleKind = (typeof PAY_SCHEDULE_KINDS)[number];

/** How a salaried Parent is paid: what one paycheck usually is, and when. */
export type SalaryPay = { paycheck: Cents; schedule: PaySchedule };

/** What "Twice a month" starts from. */
export const DEFAULT_PAY_DAYS: [number, number] = [1, 15];

/** A deposit this close to the expected paycheck, either way, can be it (the owner, on #156). */
export const PAYCHECK_WITHIN: Cents = 300_00 as Cents;
/** A paycheck lands from this many days before its pay day to this many after. */
export const PAY_DAY_WINDOW_DAYS = 5;

const dayOfMonth = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31;

/**
 * A schedule as stored or sent, checked: null for anything that is not one this version knows
 * (a kind added later, two pay days on the same day), which reads as no schedule.
 */
export function parsePaySchedule(value: unknown): PaySchedule | null {
	if (typeof value !== "object" || value === null) return null;
	const schedule = value as { kind?: unknown; days?: unknown; day?: unknown };
	if (schedule.kind === "monthly") {
		return dayOfMonth(schedule.day) ? { kind: "monthly", day: schedule.day } : null;
	}
	if (schedule.kind === "twice-a-month") {
		if (!Array.isArray(schedule.days) || schedule.days.length !== 2) return null;
		const [a, b] = schedule.days as unknown[];
		if (!dayOfMonth(a) || !dayOfMonth(b) || a === b) return null;
		return { kind: "twice-a-month", days: a < b ? [a, b] : [b, a] };
	}
	return null;
}

/**
 * The pay days of `schedule` that fall in `month`, earliest first. A day the month does not have
 * (the 31st in June, the 30th in February) is its last day; two that land on the same day are one.
 */
export function payDaysIn(schedule: PaySchedule, month: MonthKey): DayKey[] {
	const last = daysInMonth(month);
	const days = schedule.kind === "monthly" ? [schedule.day] : schedule.days;
	const inMonth = [...new Set(days.map((day) => Math.min(day, last)))].sort((a, b) => a - b);
	return inMonth.map((day) => `${month}-${String(day).padStart(2, "0")}` as DayKey);
}

/**
 * Income that is the Parent's pay: what a pay day is matched on. `payDay` is the pay day kept on
 * the line; `byHand` that a Parent said it (with no `payDay`: "Not a paycheck for a pay day"),
 * which the automatic rule never goes against.
 */
export type PaycheckLine = {
	id: string;
	amount: Cents;
	date: DayKey;
	payDay?: DayKey | null;
	byHand?: boolean;
};

export type ExpectedPaycheck = {
	/** The pay day. */
	day: DayKey;
	/** What one paycheck usually is. */
	expected: Cents;
} & (
	| {
			/** Income is this pay day's paycheck: kept on the line, or near it and not kept yet. */
			state: "in";
			lineId: string;
			/** What really came in, and the day it landed. */
			amount: Cents;
			postedOn: DayKey;
	  }
	/** Not in yet, and its days are not over. */
	| { state: "expected" }
	/** Its days are over and nothing came in: "Hasn't come in". */
	| { state: "late" }
);

type Fit<L> = { day: DayKey; line: L; off: number; days: number };

/**
 * Every way `lines` can be a paycheck of `pay`: a line within `PAYCHECK_WITHIN` of the expected
 * amount that landed from `PAY_DAY_WINDOW_DAYS` before a pay day to as many after, both ends
 * counted.
 */
function fitsOf<L extends { id: string; amount: Cents; date: DayKey }>(
	pay: SalaryPay,
	lines: readonly L[],
): Fit<L>[] {
	return lines
		.flatMap((line) =>
			[-1, 0, 1]
				.flatMap((by) => payDaysIn(pay.schedule, addMonths(monthOfDay(line.date), by)))
				.map((day) => ({
					day,
					line,
					off: Math.abs(line.amount - pay.paycheck),
					days: Math.abs(daysBetween(day, line.date)),
				})),
		)
		.filter((fit) => fit.off <= PAYCHECK_WITHIN && fit.days <= PAY_DAY_WINDOW_DAYS);
}

/** The best fit first: the closest in amount; among equals the closest in days, then the earliest. */
const bestFirst = <L extends { id: string; date: DayKey }>(a: Fit<L>, b: Fit<L>) =>
	a.off - b.off ||
	a.days - b.days ||
	a.line.date.localeCompare(b.line.date) ||
	a.line.id.localeCompare(b.line.id) ||
	a.day.localeCompare(b.day);

/**
 * A salaried Parent's expected paychecks in `month`, one per pay day, each read against `lines`
 * (Income that counts and is that Parent's pay; give the neighbouring months' too, since a
 * paycheck may land just outside the month).
 *
 * A pay day kept on a line is that line's, whatever its amount and day. The pay days left are
 * read by the rule that keeps them (`fitsOf`), for a line that fits and is not kept yet: one line
 * is one paycheck at most, the neighbouring months' pay days included, so a deposit that is last
 * month's late paycheck is not also this month's early one. A line a Parent said is not a
 * paycheck for a pay day is nobody's. A pay day with none is "expected" until its last day has
 * passed (`today`, the Household's), then "late".
 */
export function expectedPaychecks(input: {
	pay: SalaryPay;
	month: MonthKey;
	lines: readonly PaycheckLine[];
	today: DayKey;
}): ExpectedPaycheck[] {
	const { pay, month, lines, today } = input;
	const paid = new Map<DayKey, PaycheckLine>();
	for (const line of lines) if (line.payDay && !paid.has(line.payDay)) paid.set(line.payDay, line);
	const open = lines.filter((line) => !line.payDay && !line.byHand);
	const taken = new Set<string>();
	for (const fit of fitsOf(pay, open).sort(bestFirst)) {
		if (paid.has(fit.day) || taken.has(fit.line.id)) continue;
		paid.set(fit.day, fit.line);
		taken.add(fit.line.id);
	}
	return payDaysIn(pay.schedule, month).map((day): ExpectedPaycheck => {
		const line = paid.get(day);
		if (line) {
			return {
				day,
				expected: pay.paycheck,
				state: "in",
				lineId: line.id,
				amount: line.amount,
				postedOn: line.date,
			};
		}
		const over = today > addDays(day, PAY_DAY_WINDOW_DAYS);
		return { day, expected: pay.paycheck, state: over ? "late" : "expected" };
	});
}

/** A line of Income that counts, as the rule that keeps pay days reads it. */
export type PayDayLine = {
	id: string;
	amount: Cents;
	date: DayKey;
	/** Whose pay it is: a Parent's ID, or null when nobody has said. */
	whosePay: string | null;
	payDay: DayKey | null;
	byHand: boolean;
};

/** A pay day to keep on a line. */
export type PayDayMatch = {
	lineId: string;
	payDay: DayKey;
	/** The Parent whose paycheck it is. */
	memberId: string;
	/** Nobody had said whose pay the line is: it becomes this Parent's along with the pay day. */
	claims: boolean;
};

/**
 * What should match (issue 156, phase 2): the pay days to keep on `lines`, all the Household's
 * Income that counts. Pure, and safe to ask again: a line that has a pay day, or that a Parent
 * spoke for by hand, is never matched, and the pay day it holds is taken.
 *
 * A line that is a salaried Parent's pay takes the open pay day of theirs it fits (`fitsOf`), the
 * best fit first across everyone. With `claim` (a Parent has just said how they are paid), a line
 * nobody has said whose pay it is can be a Parent's paycheck too, when it fits a pay day of
 * theirs and of no other salaried Parent; whose pay a Parent chose is never changed. With `only`,
 * just those lines are matched (the ones that have just arrived or changed); the others still
 * hold their pay days.
 */
export function payDayMatches(input: {
	parents: readonly { memberId: string; pay: SalaryPay }[];
	lines: readonly PayDayLine[];
	claim?: boolean;
	only?: readonly string[];
}): PayDayMatch[] {
	const { parents, lines } = input;
	const only = input.only ? new Set(input.only) : null;
	const slot = (memberId: string, day: DayKey) => `${memberId} ${day}`;
	const taken = new Set(
		lines.flatMap((line) =>
			line.payDay && line.whosePay ? [slot(line.whosePay, line.payDay)] : [],
		),
	);
	const open = lines.filter(
		(line) => !line.payDay && !line.byHand && (only === null || only.has(line.id)),
	);
	const unclaimed = input.claim ? open.filter((line) => line.whosePay === null) : [];
	// Who each unclaimed line could be a paycheck of: it is claimed only when that is one Parent.
	const couldBe = new Map<string, Set<string>>();
	for (const { memberId, pay } of parents) {
		for (const fit of fitsOf(pay, unclaimed)) {
			const who = couldBe.get(fit.line.id) ?? new Set<string>();
			who.add(memberId);
			couldBe.set(fit.line.id, who);
		}
	}
	const fits = parents.flatMap(({ memberId, pay }) =>
		fitsOf(
			pay,
			open.filter(
				(line) =>
					line.whosePay === memberId ||
					(line.whosePay === null && couldBe.get(line.id)?.size === 1),
			),
		).map((fit) => ({ ...fit, memberId })),
	);
	fits.sort((a, b) => bestFirst(a, b) || a.memberId.localeCompare(b.memberId));
	const matched = new Set<string>();
	const matches: PayDayMatch[] = [];
	for (const fit of fits) {
		const key = slot(fit.memberId, fit.day);
		if (taken.has(key) || matched.has(fit.line.id)) continue;
		taken.add(key);
		matched.add(fit.line.id);
		matches.push({
			lineId: fit.line.id,
			payDay: fit.day,
			memberId: fit.memberId,
			claims: fit.line.whosePay === null,
		});
	}
	return matches;
}

/** By hand a Parent may say a line is the pay for a pay day this many days either side of it. */
export const PAY_DAY_BY_HAND_DAYS = 20;

/** The pay days of `schedule` a line that landed on `date` can be said to be the pay for. */
export function nearbyPayDays(schedule: PaySchedule, date: DayKey): DayKey[] {
	return [-1, 0, 1]
		.flatMap((by) => payDaysIn(schedule, addMonths(monthOfDay(date), by)))
		.filter((day) => Math.abs(daysBetween(day, date)) <= PAY_DAY_BY_HAND_DAYS);
}
