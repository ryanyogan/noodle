import {
	type AccountPairResult,
	changeMoneyInKind,
	deleteMoneyInRule,
	editMoneyIn,
	loadMoneyIn,
	loadMoneyInAccounts,
	loadMoneyInReview,
	loadMoneyInRules,
	type MoneyInKindResult,
	type MoneyInLine,
	rememberAccountPair,
	type StoredMoneyInRule,
	saveMoneyInRule,
	stateWhosePay,
} from "@noodle/db";
import {
	addMonths,
	type Cents,
	type DayKey,
	MAX_CENTS,
	MONEY_IN_KINDS,
	PAY_RANGE_MONTHS,
	type PayRange,
	payRanges,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { HouseholdChange } from "../household-changes";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// Money in and its kind (issue 131, ADR-0057): Income, a Refund, Paid back, a Transfer or Between
// us. Money in is the Household's, never private, so both Parents read and change all of it.

export type { MoneyInKindResult, MoneyInLine };

/** A month's money in, of every kind, newest first. */
export const getMoneyIn = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ month: monthKeySchema }))
	.handler(
		({ data, context }): Promise<MoneyInLine[]> =>
			loadMoneyIn(getDb(), context.household.id, {
				from: `${data.month}-01`,
				until: `${addMonths(data.month, 1)}-01`,
			}),
	);

/** The money in waiting in Review for a Parent to say its kind, newest first. */
export const getMoneyInReview = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		({ context }): Promise<MoneyInLine[]> => loadMoneyInReview(getDb(), context.household.id),
	);

/**
 * A Parent says what kind a money-in line is. Refused while Extra income already decided in its
 * month needs it as Income (`extra-income`), or when it was changed on another screen
 * (`changed-elsewhere`, with the line as it is now). With `ruleId`, a Rule is stated too: money in
 * with this line's wording is that kind from now on. Idempotent per `transferId`.
 */
export const setMoneyInKind = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			incomeId: ulidSchema,
			kind: z.enum(MONEY_IN_KINDS),
			transferId: ulidSchema,
			expectedVersion: z.number().int().min(0).optional(),
			ruleId: ulidSchema.optional(),
		}),
	)
	.handler(async ({ data, context }): Promise<MoneyInKindResult> => {
		const db = getDb();
		const viewer = viewerOf(context);
		const result = await changeMoneyInKind(db, viewer, data);
		if (!result.ok) return result;
		if (data.ruleId && result.line.note)
			await saveMoneyInRule(db, viewer, {
				ruleId: data.ruleId,
				wording: result.line.note,
				kind: data.kind,
			});
		await notifyHousehold(context.household.id, [
			...result.months.map((month) => `month:${month}` as HouseholdChange),
			"months",
			"bucket-uses",
		]);
		return result;
	});

/** The Household's Accounts by name, to say which one money came from. */
export const getMoneyInAccounts = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(({ context }) => loadMoneyInAccounts(getDb(), context.household.id));

/**
 * A remembered pair of Accounts (ADR-0057): this Transfer came from another of the Household's
 * Accounts, and money worded like it into the same Account always does.
 */
export const rememberMoneyInPair = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ incomeId: ulidSchema, otherAccountId: ulidSchema, ruleId: ulidSchema }))
	.handler(async ({ data, context }): Promise<AccountPairResult> => {
		const result = await rememberAccountPair(getDb(), viewerOf(context), data);
		if (result.ok) await notifyHousehold(context.household.id, ["rules", "months"]);
		return result;
	});

/** The Household's Rules for money in: wording that is always one kind. */
export const getMoneyInRules = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		({ context }): Promise<StoredMoneyInRule[]> => loadMoneyInRules(getDb(), context.household.id),
	);

/** Removes a Rule for money in; what it already decided stays as it is. */
export const removeMoneyInRule = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ ruleId: ulidSchema }))
	.handler(async ({ data, context }) => {
		await deleteMoneyInRule(getDb(), context.household.id, data.ruleId);
		await notifyHousehold(context.household.id, ["rules"]);
	});

/**
 * A Parent changes whose pay a money-in line is, its note, or, on a line they typed in, its amount
 * or date (issue 133). Made on the version they were looking at; answered like a change of kind.
 */
export const editMoneyInLine = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			incomeId: ulidSchema,
			expectedVersion: z.number().int().min(0).optional(),
			edit: z.object({
				whosePay: ulidSchema.nullable().optional(),
				note: z.string().trim().max(200).nullable().optional(),
				amountCents: z.number().int().positive().max(MAX_CENTS).optional(),
				date: z
					.string()
					.regex(/^\d{4}-\d{2}-\d{2}$/)
					.optional(),
			}),
		}),
	)
	.handler(async ({ data, context }): Promise<MoneyInKindResult> => {
		const result = await editMoneyIn(getDb(), viewerOf(context), {
			incomeId: data.incomeId,
			expectedVersion: data.expectedVersion,
			edit: {
				...data.edit,
				amountCents: data.edit.amountCents as Cents | undefined,
				date: data.edit.date as DayKey | undefined,
			},
		});
		if (!result.ok) return result;
		await notifyHousehold(context.household.id, [
			...result.months.map((month) => `month:${month}` as HouseholdChange),
			"months",
		]);
		return result;
	});

/**
 * "Always treat deposits from <name> as <Parent>'s pay": a Rule from this line's wording, which
 * also gives that Parent the deposits already here that are still the Household's. Sent once,
 * never again from the outbox, as any Rule stated from a line (ADR-0056).
 */
export const alwaysWhosePay = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({ ruleId: ulidSchema, incomeId: ulidSchema, payMemberId: ulidSchema.nullable() }),
	)
	.handler(async ({ data, context }): Promise<{ changed: number } | null> => {
		const db = getDb();
		const viewer = viewerOf(context);
		const [line] = await loadMoneyIn(db, context.household.id, { id: data.incomeId });
		if (!line?.note) return null;
		const stated = await stateWhosePay(db, viewer, {
			ruleId: data.ruleId,
			wording: line.note,
			payMemberId: data.payMemberId,
		});
		if (!stated) return null;
		if (stated.changed > 0) await notifyHousehold(context.household.id, ["months"]);
		return { changed: stated.changed };
	});

/**
 * Each Parent's pay (and the Household's) in a month and over the three full months before it,
 * from money in that counts as Income.
 */
export const getPayRanges = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ month: monthKeySchema }))
	.handler(async ({ data, context }): Promise<PayRange[]> => {
		const lines = await loadMoneyIn(getDb(), context.household.id, {
			from: `${addMonths(data.month, -PAY_RANGE_MONTHS)}-01`,
			until: `${addMonths(data.month, 1)}-01`,
		});
		return payRanges(
			lines.filter((line) => line.kind === "income" && !line.needsReview),
			data.month,
		);
	});
