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

// Pay days (issue 156, phase 1). A Parent says how they are paid: on a salary, with the usual
// amount of one paycheck and the days it is due, or hourly / pay that varies, with nothing to
// set. A salaried Parent's expected paychecks are listed per month, each read as in once Income
// that is their pay has landed near its pay day. The list only reads: Income still counts in the
// month it landed, and the Take-home pay is still one Household figure (ADR-0040).

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

/** Income that is the Parent's pay: all a pay day is matched on. */
export type PaycheckLine = { id: string; amount: Cents; date: DayKey };

export type ExpectedPaycheck = {
	/** The pay day. */
	day: DayKey;
	/** What one paycheck usually is. */
	expected: Cents;
} & (
	| {
			/** Income near the pay day is this paycheck. */
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

/**
 * A salaried Parent's expected paychecks in `month`, one per pay day, each read against `lines`
 * (Income that counts and is that Parent's pay; give the neighbouring months' too, since a
 * paycheck may land just outside the month).
 *
 * A line can be a pay day's paycheck when it is within `PAYCHECK_WITHIN` of the expected amount
 * and landed from `PAY_DAY_WINDOW_DAYS` before the pay day to as many after, both ends counted.
 * One line is one paycheck at most, the neighbouring months' pay days included, so a deposit
 * that is last month's late paycheck is not also this month's early one. When several lines fit,
 * the closest in amount takes the pay day; among equals the closest in days, then the earliest.
 * A pay day with none is "expected" until its last day has passed (`today`, the Household's),
 * then "late".
 */
export function expectedPaychecks(input: {
	pay: SalaryPay;
	month: MonthKey;
	lines: readonly PaycheckLine[];
	today: DayKey;
}): ExpectedPaycheck[] {
	const { pay, month, lines, today } = input;
	const payDays = [-1, 0, 1].flatMap((by) => payDaysIn(pay.schedule, addMonths(month, by)));
	const fits = payDays
		.flatMap((day) =>
			lines.map((line) => ({
				day,
				line,
				off: Math.abs(line.amount - pay.paycheck),
				days: Math.abs(daysBetween(day, line.date)),
			})),
		)
		.filter((fit) => fit.off <= PAYCHECK_WITHIN && fit.days <= PAY_DAY_WINDOW_DAYS)
		.sort(
			(a, b) =>
				a.off - b.off ||
				a.days - b.days ||
				a.line.date.localeCompare(b.line.date) ||
				a.line.id.localeCompare(b.line.id) ||
				a.day.localeCompare(b.day),
		);
	const paid = new Map<DayKey, PaycheckLine>();
	const taken = new Set<string>();
	for (const fit of fits) {
		if (paid.has(fit.day) || taken.has(fit.line.id)) continue;
		paid.set(fit.day, fit.line);
		taken.add(fit.line.id);
	}
	return payDays
		.filter((day) => monthOfDay(day) === month)
		.map((day): ExpectedPaycheck => {
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
