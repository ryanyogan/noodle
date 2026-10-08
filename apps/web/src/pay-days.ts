import {
	type Cents,
	DEFAULT_PAY_DAYS,
	type ExpectedPaycheck,
	type MonthKey,
	type PaySchedule,
	type PayScheduleKind,
	type SalaryPay,
} from "@noodle/domain";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { ordinal } from "./commitments";
import { formatMoney, shortDay } from "./format";
import { monthQuery, monthsKey } from "./queries";
import { getPayDays, type ParentPayDays, setParentPay } from "./server/pay-days";

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
		},
		onSuccess: () =>
			queryClient.invalidateQueries({
				predicate: ({ queryKey }) => queryKey[0] === monthsKey[0] && queryKey.at(-1) === "pay-days",
			}),
	});
}

/** A Parent who is not on a salary. */
export const HOURLY_LABEL = "Hourly, or pay that varies";

export const PAY_SCHEDULE_LABELS: Record<PayScheduleKind, string> = {
	"twice-a-month": "Twice a month",
	monthly: "Monthly",
};

/** "Twice a month, on the 1st and the 15th". */
export const scheduleText = (schedule: PaySchedule) =>
	schedule.kind === "monthly"
		? `Monthly, on the ${ordinal(schedule.day)}`
		: `Twice a month, on the ${ordinal(schedule.days[0])} and the ${ordinal(schedule.days[1])}`;

/** "Salary · $2,500 a paycheck · Twice a month, on the 1st and the 15th". */
export const payText = (pay: SalaryPay | null) =>
	pay
		? `Salary · ${formatMoney(pay.paycheck)} a paycheck · ${scheduleText(pay.schedule)}`
		: HOURLY_LABEL;

/** The schedule a form's choices make: its kind and the two days it offers, the second unused for monthly. */
export function scheduleOf(
	kind: PayScheduleKind,
	first: number,
	second: number,
): PaySchedule | null {
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

/** What the row's amount is: what came in, else what one paycheck usually is. */
export const paycheckAmount = (paycheck: ExpectedPaycheck): Cents =>
	paycheck.state === "in" ? paycheck.amount : paycheck.expected;
