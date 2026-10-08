import {
	type Cents,
	type DayKey,
	DEFAULT_PAY_DAYS,
	type ExpectedPaycheck,
	type LatePay,
	type MonthKey,
	monthOfDay,
	type PaySchedule,
	type PayScheduleKind,
	type SalaryPay,
} from "@noodle/domain";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { weekdayNames } from "./check-in";
import { ordinal } from "./commitments";
import { formatMoney, monthName, shortDay } from "./format";
import { MoneyInRefused } from "./money-in";
import { monthQuery, monthsKey } from "./queries";
import type { MoneyInLine } from "./server/money-in";
import {
	getLatePay,
	getPayDayChoices,
	getPayDays,
	getPayDaysNotMoved,
	type ParentPayDays,
	type ParentPaySaved,
	type PayDayNotMoved,
	setParentPay,
	setPayDay,
} from "./server/pay-days";
import { ChangedElsewhere, expectedVersionOf, noteVersion } from "./transaction-versions";

// How each Parent is paid and a salaried Parent's expected paychecks (issue 156, phase 1), as
// Plan › Income says them.

export type { ParentPayDays };

/** Each Parent with how they are paid and, on a salary, the month's expected paychecks. */
export const payDaysQuery = (month: MonthKey) =>
	queryOptions({
		// Under the month's key: Income landing, or changing whose pay it is, refetches it.
		queryKey: [...monthQuery(month).queryKey, "pay-days"],
		queryFn: () => getPayDays({ data: { month } }),
	});

/** The paychecks left in the month they landed in, of this month or due into it, and why. */
export const payDaysNotMovedQuery = (month: MonthKey) =>
	queryOptions({
		// Under the month's key, like the pay days: whatever changes its Income refetches it.
		queryKey: [...monthQuery(month).queryKey, "pay-days-not-moved"],
		queryFn: () => getPayDaysNotMoved({ data: { month } }),
	});

/** The pay days that haven't come in, this month's and last month's. */
export const latePayQuery = () =>
	queryOptions({
		// Under the months' key: Income landing, or a Parent saying whose pay or which pay day,
		// refetches it.
		queryKey: [...monthsKey, "late-pay"],
		queryFn: () => getLatePay(),
	});

/** "Robin's pay for Oct 15 hasn't come in". */
export const latePayText = (late: LatePay) =>
	`${late.name}’s pay for ${shortDay(late.day)} hasn’t come in`;

/** Says how a Parent is paid; every month's expected paychecks are read again after. */
export function useSetParentPay() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (data: { memberId: string; pay: SalaryPay | null }) => {
			const { memberId, pay } = data;
			const result = await setParentPay({
				data: {
					memberId,
					pay: pay ? { paycheckCents: pay.paycheck, schedule: pay.schedule } : null,
				},
			});
			if (!result.ok) throw new Error("Refused");
			return result satisfies ParentPaySaved;
		},
		// Every month: a paycheck that is now the pay for a pay day counts in that day's month.
		onSuccess: () => queryClient.invalidateQueries({ queryKey: monthsKey }),
	});
}

/** The pay days a line of Income can be said to be the pay for. */
export const payDayChoicesQuery = (line: Pick<MoneyInLine, "id" | "whosePay" | "version">) =>
	queryOptions({
		queryKey: [...monthsKey, "pay-day-choices", line.id, line.whosePay, line.version],
		queryFn: () => getPayDayChoices({ data: { incomeId: line.id } }),
	});

/** In the select: "Not a paycheck for a pay day". */
export const NOT_A_PAYCHECK = "none";

/**
 * A Parent says by hand which pay day a line of Income is the pay for, or (null) that it is not
 * a paycheck for one. Every month is read again: the line counts in the pay day's month.
 */
export function useSetPayDay() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ line, payDay }: { line: MoneyInLine; payDay: string | null }) => {
			const result = await setPayDay({
				data: { incomeId: line.id, payDay, expectedVersion: expectedVersionOf(line) },
			});
			if (!result.ok) {
				if (result.reason === "changed-elsewhere")
					throw new ChangedElsewhere(line.id, result.current);
				throw new MoneyInRefused(result.reason);
			}
			noteVersion(line.id, result.line.version);
			return result.line;
		},
		// Not waited for: the line says what it now is at once, and the list it is open in may
		// draw it again as the months are read.
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: monthsKey });
		},
	});
}

/** "Sep 30 · $2,450.00 · Not moved to October: September is closed". */
export const notMovedText = (line: PayDayNotMoved) =>
	`${shortDay(line.date)} · ${formatMoney(line.amount)} · not moved to ${monthName(monthOfDay(line.payDay))}: ${
		line.reason === "month-closed"
			? `${monthName(line.month)} is closed`
			: `Extra income already decided in ${monthName(line.month)} needs it`
	}`;

/** A Parent who is not on a salary. */
export const HOURLY_LABEL = "Hourly, or pay that varies";

export const PAY_SCHEDULE_LABELS: Record<PayScheduleKind, string> = {
	"twice-a-month": "Twice a month",
	"every-two-weeks": "Every two weeks",
	weekly: "Weekly",
	monthly: "Monthly",
};

/** "Friday", for a day key. */
const weekdayOf = (day: DayKey) => weekdayNames[new Date(`${day}T00:00:00Z`).getUTCDay()];

/** "Twice a month, on the 1st and the 15th"; "Every two weeks, on a Friday, counted from Oct 2". */
export function scheduleText(schedule: PaySchedule): string {
	switch (schedule.kind) {
		case "monthly":
			return `Monthly, on the ${ordinal(schedule.day)}`;
		case "twice-a-month":
			return `Twice a month, on the ${ordinal(schedule.days[0])} and the ${ordinal(schedule.days[1])}`;
		case "every-two-weeks":
			return `Every two weeks, on a ${weekdayOf(schedule.anchor)}, counted from ${shortDay(schedule.anchor)}`;
		case "weekly":
			return `Weekly, on ${weekdayOf(schedule.anchor)}s`;
	}
}

/** "Salary · $2,500 a paycheck · Twice a month, on the 1st and the 15th". */
export const payText = (pay: SalaryPay | null) =>
	pay
		? `Salary · ${formatMoney(pay.paycheck)} a paycheck · ${scheduleText(pay.schedule)}`
		: HOURLY_LABEL;

/**
 * The schedule a form's choices make: its kind and the two days it offers, the second unused for
 * monthly; every two weeks or weekly, the one pay day it is counted from instead (`anchor`, "" until
 * picked).
 */
export function scheduleOf(
	kind: PayScheduleKind,
	first: number,
	second: number,
	anchor = "",
): PaySchedule | null {
	if (kind === "every-two-weeks" || kind === "weekly")
		return anchor ? { kind, anchor: anchor as DayKey } : null;
	if (kind === "monthly") return { kind, day: first };
	if (first === second) return null;
	return { kind, days: first < second ? [first, second] : [second, first] };
}

/** The days a form starts from for `schedule`: its own, else the 1st and the 15th. */
export const formDays = (schedule: PaySchedule | undefined): [number, number] =>
	schedule?.kind === "twice-a-month"
		? schedule.days
		: schedule?.kind === "monthly"
			? [
					schedule.day,
					schedule.day === DEFAULT_PAY_DAYS[1] ? DEFAULT_PAY_DAYS[0] : DEFAULT_PAY_DAYS[1],
				]
			: DEFAULT_PAY_DAYS;

export const PAYCHECK_STATE_LABELS: Record<ExpectedPaycheck["state"], string> = {
	in: "In",
	expected: "Expected",
	late: "Hasn’t come in",
};

/** Under "Pay for Oct 1": the day it landed, or what is being looked for. */
export function paycheckMeta(paycheck: ExpectedPaycheck, name: string): string {
	switch (paycheck.state) {
		case "in":
			return `Posted ${shortDay(paycheck.postedOn)}`;
		case "expected":
			return `About ${formatMoney(paycheck.expected)}`;
		case "late":
			return `No Income marked as ${name}’s pay near this day`;
	}
}

/**
 * Under a month's paychecks when it has one more pay day than most (three every two weeks, five
 * weekly): the paycheck above the Take-home pay is Extra income, as any Income over it is.
 */
export const extraPayDayText = (month: MonthKey, payDays: number) =>
	`${monthName(month)} has ${payDays} pay days, one more than most months. Pay above your take-home pay shows as Extra income for you to place.`;

/** What the row's amount is: what came in, else what one paycheck usually is. */
export const paycheckAmount = (paycheck: ExpectedPaycheck): Cents =>
	paycheck.state === "in" ? paycheck.amount : paycheck.expected;
