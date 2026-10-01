import {
	addIncome,
	decideExtraIncome as decideExtraIncomeInDb,
	type IncomeWriteResult,
	removeIncome as removeIncomeInDb,
	undoExtraIncome as undoExtraIncomeInDb,
} from "@noodle/db";
import {
	type Cents,
	dayKeyAt,
	MAX_CENTS,
	type MonthKey,
	monthKeyAt,
	monthOfDay,
	monthState,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { type HouseholdSummary, householdMiddleware } from "./household";
import { loadMonth, monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { dayKeySchema, ulidSchema } from "./schemas";

// Income and Extra income. Each write is idempotent per its client ULID; a write the database guard
// refuses comes back as `{ ok: false }` rather than an error.

export type { IncomeWriteResult };

const amountSchema = z.number().int().min(1).max(MAX_CENTS);

const currentMonth = (household: Pick<HouseholdSummary, "timeZone">) =>
	monthKeyAt(new Date(), household.timeZone);

/** Extra income are decided in the month they came in, or once it has ended; never ahead. */
function assertNotFuture(household: Pick<HouseholdSummary, "timeZone">, month: MonthKey) {
	if (month > currentMonth(household)) throw new Error("That month hasn’t begun.");
}

/**
 * Records income received today, in the Household's time zone, or on `date`, an earlier day this
 * month: putting back income just removed (its Undo) keeps the day it came in.
 */
export const recordIncome = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			incomeId: ulidSchema,
			amountCents: amountSchema,
			note: z.string().trim().max(80).nullable(),
			date: dayKeySchema.optional(),
		}),
	)
	.handler(async ({ data, context }) => {
		const { household } = context;
		const today = dayKeyAt(new Date(), household.timeZone);
		const date = data.date ?? today;
		if (date > today || monthOfDay(date) !== monthOfDay(today)) {
			throw new Error("Income can only be recorded for a day this month so far.");
		}
		await addIncome(getDb(), {
			householdId: household.id,
			incomeId: data.incomeId,
			date,
			amountCents: data.amountCents,
			note: data.note || null,
			createdByMemberId: context.parent.id,
		});
		const month = monthOfDay(date);
		await notifyHousehold(
			household.id,
			[`month:${month}`],
			[{ type: "income", month, recordedBy: context.parent.id }],
		);
	});

/**
 * Removes income recorded by mistake. Refused while the part of its month's Extra income already
 * decided would no longer be covered.
 */
export const removeIncome = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ incomeId: ulidSchema, month: monthKeySchema }))
	.handler(async ({ data, context }): Promise<IncomeWriteResult> => {
		const { household } = context;
		const result = await removeIncomeInDb(getDb(), { householdId: household.id, ...data });
		if (result.ok) await notifyHousehold(household.id, [`month:${data.month}`]);
		return result;
	});

/** Refused Extra income Moves say what was left of the Extra income, to explain why. */
export type ExtraIncomeOutcome = { ok: true } | { ok: false; left: Cents };

/**
 * Moves `amountCents` of a month's Extra income to what a Goal has set aside or one of the month's Buckets.
 * Refused unless the Extra income still has that much left, and the destination can take it.
 */
export const decideExtraIncome = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			moveId: ulidSchema,
			month: monthKeySchema,
			to: z.discriminatedUnion("kind", [
				z.object({ kind: z.literal("goal"), goalId: ulidSchema }),
				z.object({ kind: z.literal("bucket"), bucketId: ulidSchema }),
			]),
			amountCents: amountSchema,
		}),
	)
	.handler(async ({ data, context }): Promise<ExtraIncomeOutcome> => {
		const { household } = context;
		assertNotFuture(household, data.month);
		const db = getDb();
		const result = await decideExtraIncomeInDb(db, {
			householdId: household.id,
			createdByMemberId: context.parent.id,
			...data,
		});
		if (!result.ok) {
			const month = await loadMonth(db, household, context.parent.id, data.month);
			return { ok: false, left: monthState(month).windfallLeft };
		}
		await notifyHousehold(household.id, ["goals", `month:${data.month}`]);
		return { ok: true };
	});

/** Undoes Extra income Move. Refused once a Goal it went to has spent the money. */
export const undoExtraIncome = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ moveId: ulidSchema, month: monthKeySchema }))
	.handler(async ({ data, context }): Promise<IncomeWriteResult> => {
		const { household } = context;
		const result = await undoExtraIncomeInDb(getDb(), { householdId: household.id, ...data });
		if (result.ok) await notifyHousehold(household.id, ["goals", `month:${data.month}`]);
		return result;
	});
