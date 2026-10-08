import {
	loadMoneyIn,
	loadMoneyInLine,
	loadParentPay,
	loadPayDayChoices,
	type MoneyInKindResult,
	matchPayDays,
	type PayDayChoice,
	type PayDayNotMoved,
	setParentPay as setParentPayInDb,
	setPayDayByHand,
} from "@noodle/db";
import {
	addMonths,
	type Cents,
	type DayKey,
	dayKeyAt,
	type ExpectedPaycheck,
	expectedPaychecks,
	MAX_CENTS,
	parsePaySchedule,
	type SalaryPay,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { HouseholdChange } from "../household-changes";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// How each Parent is paid, a salaried Parent's expected paychecks in a month, and the pay day a
// line of Income is the pay for (issue 156, ADR-0063). Income is the Household's, never private,
// so both Parents read all of it and either says how either is paid, as either says whose pay a
// line of Income is.

export type { PayDayChoice, PayDayNotMoved };

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
 * read against Income that counts and is their pay: the pay day kept on a line first, then the
 * lines that fit one and have none kept yet.
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
						lines: lines
							.filter((line) => line.whosePay === parent.memberId)
							.map((line) => ({ ...line, byHand: line.payDayByHand })),
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

/** What saving how a Parent is paid did to the Income already here. */
export type ParentPaySaved = {
	ok: boolean;
	/** How many lines of Income were given a pay day. */
	matched: number;
	/** Paychecks left in the month they landed in, and why. */
	notMoved: PayDayNotMoved[];
};

/**
 * Says how a Parent is paid: on a salary, or (null) hourly / pay that varies. On a salary the
 * Income already here is brought into line at once: each paycheck near a pay day is the pay for
 * it and counts in its month, and Income nobody has said whose pay it is becomes theirs when it
 * can only be their paycheck.
 */
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
	.handler(async ({ data, context }): Promise<ParentPaySaved> => {
		const db = getDb();
		const result = await setParentPayInDb(db, {
			householdId: context.household.id,
			memberId: data.memberId,
			pay: data.pay
				? { paycheck: data.pay.paycheckCents as Cents, schedule: data.pay.schedule }
				: null,
		});
		if (!result.ok) return { ok: false, matched: 0, notMoved: [] };
		const { matched, notMoved } = data.pay
			? await matchPayDays(db, context.household.id, { claim: true })
			: { matched: 0, notMoved: [] };
		await notifyHousehold(context.household.id, ["months"]);
		return { ok: true, matched, notMoved };
	});

/** The pay days a Parent can say a line of Income is the pay for; none unless it is a salaried Parent's pay. */
export const getPayDayChoices = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ incomeId: ulidSchema }))
	.handler(async ({ data, context }): Promise<PayDayChoice[]> => {
		const db = getDb();
		const line = await loadMoneyInLine(db, context.household.id, data.incomeId);
		return line ? loadPayDayChoices(db, context.household.id, line) : [];
	});

/**
 * A Parent says by hand which pay day a line of Income is the pay for, or (null) that it is not
 * a paycheck for a pay day. Answered like any change to money in; refused while Extra income
 * decided in the month it would leave needs it, or a month it would leave or join is closed.
 */
export const setPayDay = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			incomeId: ulidSchema,
			payDay: z
				.string()
				.regex(/^\d{4}-\d{2}-\d{2}$/)
				.nullable(),
			expectedVersion: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ data, context }): Promise<MoneyInKindResult> => {
		const result = await setPayDayByHand(getDb(), viewerOf(context), {
			incomeId: data.incomeId,
			payDay: data.payDay as DayKey | null,
			expectedVersion: data.expectedVersion,
		});
		if (!result.ok) return result;
		await notifyHousehold(context.household.id, [
			...result.months.map((month) => `month:${month}` as HouseholdChange),
			"months",
		]);
		return result;
	});
