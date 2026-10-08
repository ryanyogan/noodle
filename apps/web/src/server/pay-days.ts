import { loadMoneyIn, loadParentPay, setParentPay as setParentPayInDb } from "@noodle/db";
import {
	addMonths,
	type Cents,
	dayKeyAt,
	type ExpectedPaycheck,
	expectedPaychecks,
	MAX_CENTS,
	parsePaySchedule,
	type SalaryPay,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// How each Parent is paid, and a salaried Parent's expected paychecks in a month (issue 156,
// phase 1). Income is the Household's, never private, so both Parents read all of it and either
// says how either is paid, as either says whose pay a line of Income is.

/** A Parent, how they are paid, and (on a salary) the month's expected paychecks. */
export type ParentPayDays = {
	memberId: string;
	name: string;
	/** Null for hourly, or pay that varies. */
	pay: SalaryPay | null;
	payDays: ExpectedPaycheck[];
};

/**
 * Each Parent with how they are paid and, for one on a salary, the month's expected paychecks
 * read against Income that counts and is their pay. Only read: nothing is stored about which
 * line is which paycheck, and no total changes.
 */
export const getPayDays = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ month: monthKeySchema }))
	.handler(async ({ data, context }): Promise<ParentPayDays[]> => {
		const parents = await loadParentPay(getDb(), context.household.id);
		if (!parents.some((parent) => parent.pay)) {
			return parents.map((parent) => ({ ...parent, payDays: [] }));
		}
		// The months either side too: a paycheck lands up to a few days outside its pay day's
		// month, and one line is one paycheck only, the neighbouring months' pay days included.
		const lines = (
			await loadMoneyIn(getDb(), context.household.id, {
				from: `${addMonths(data.month, -2)}-01`,
				until: `${addMonths(data.month, 3)}-01`,
			})
		).filter((line) => line.kind === "income" && !line.needsReview);
		const today = dayKeyAt(new Date(), context.household.timeZone);
		return parents.map((parent) => ({
			...parent,
			payDays: parent.pay
				? expectedPaychecks({
						pay: parent.pay,
						month: data.month,
						lines: lines.filter((line) => line.whosePay === parent.memberId),
						today,
					})
				: [],
		}));
	});

const payScheduleSchema = z.unknown().transform((value, ctx) => {
	const schedule = parsePaySchedule(value);
	if (schedule) return schedule;
	ctx.addIssue({ code: "custom", message: "Not a pay schedule" });
	return z.NEVER;
});

/** Says how a Parent is paid: on a salary, or (null) hourly / pay that varies. */
export const setParentPay = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			memberId: ulidSchema,
			pay: z
				.object({
					paycheckCents: z.number().int().positive().max(MAX_CENTS),
					schedule: payScheduleSchema,
				})
				.nullable(),
		}),
	)
	.handler(async ({ data, context }): Promise<{ ok: boolean }> => {
		const result = await setParentPayInDb(getDb(), {
			householdId: context.household.id,
			memberId: data.memberId,
			pay: data.pay
				? { paycheck: data.pay.paycheckCents as Cents, schedule: data.pay.schedule }
				: null,
		});
		if (result.ok) await notifyHousehold(context.household.id, ["months"]);
		return result;
	});
