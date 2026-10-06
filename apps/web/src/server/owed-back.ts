import {
	confirmPaidBack,
	loadOwedBack,
	loadUnmatchedPaidBack,
	type OwedBackItem,
	type OwedBackRemoveResult,
	type OwedBackResult,
	offerPaidBackFor,
	type PaidBackConfirmResult,
	type PaidBackOffered,
	removeOwedBack,
	sayOwedBack,
	type UnmatchedPaidBack,
} from "@noodle/db";
import { dayKeyAt, MAX_CENTS, monthOfDay, OWED_BACK_NAME_MAX } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { HouseholdChange } from "../household-changes";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// Paid back and Owed back (issue 132, ADR-0058): who is paying part of a purchase back and how
// much, and which of those a Paid back money-in line settles once a Parent confirms.

export type { OwedBackItem, OwedBackResult, PaidBackConfirmResult, PaidBackOffered };

const centsSchema = z.number().int().min(1).max(MAX_CENTS);

/** Owed back items as this Parent may see their purchases, oldest first: all, or one purchase's. */
export const getOwedBack = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ open: z.boolean().optional(), transactionId: ulidSchema.optional() }))
	.handler(
		({ data, context }): Promise<OwedBackItem[]> =>
			loadOwedBack(getDb(), viewerOf(context), {
				...(data.open ? { open: true } : {}),
				...(data.transactionId ? { transactionId: data.transactionId } : {}),
			}),
	);

/**
 * A Parent says someone's paying part of a purchase back: a name, or a Child, and how much (half
 * when not said). Saying it again for the same purchase changes it. Idempotent per `owedBackId`.
 */
export const setOwedBack = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			owedBackId: ulidSchema,
			transactionId: ulidSchema,
			splitId: ulidSchema.nullable().optional(),
			who: z.string().max(OWED_BACK_NAME_MAX * 2),
			memberId: ulidSchema.nullable().optional(),
			amountCents: centsSchema.optional(),
		}),
	)
	.handler(async ({ data, context }): Promise<OwedBackResult> => {
		const { amountCents, ...rest } = data;
		const result = await sayOwedBack(getDb(), viewerOf(context), {
			...rest,
			...(amountCents === undefined ? {} : { amountCents: amountCents as never }),
		});
		if (result.ok) await notifyHousehold(context.household.id, ["months"]);
		return result;
	});

/** A Parent takes the Owed back off a purchase; what was Paid back on it this month waits again. */
export const clearOwedBack = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ owedBackId: ulidSchema }))
	.handler(async ({ data, context }): Promise<OwedBackRemoveResult> => {
		const today = dayKeyAt(new Date(), context.household.timeZone);
		const result = await removeOwedBack(getDb(), viewerOf(context), { ...data, today });
		if (result.ok)
			await notifyHousehold(context.household.id, [`month:${monthOfDay(today)}`, "months"]);
		return result;
	});

/** A Paid back line offered against what's still Owed back; null when the line isn't Paid back. */
export const getPaidBackOffer = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ incomeId: ulidSchema }))
	.handler(
		({ data, context }): Promise<PaidBackOffered | null> =>
			offerPaidBackFor(getDb(), viewerOf(context), data.incomeId),
	);

/**
 * A Parent confirms what a Paid back line settles: the whole of it for months still running.
 * Each match counts in the month the money arrived, or this month when that one has ended.
 */
export const confirmPaidBackMatches = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			incomeId: ulidSchema,
			matches: z
				.array(z.object({ id: ulidSchema, owedBackId: ulidSchema, amount: centsSchema }))
				.max(200),
		}),
	)
	.handler(async ({ data, context }): Promise<PaidBackConfirmResult> => {
		const today = dayKeyAt(new Date(), context.household.timeZone);
		const result = await confirmPaidBack(getDb(), viewerOf(context), {
			incomeId: data.incomeId,
			matches: data.matches as never,
			today,
		});
		if (result.ok)
			await notifyHousehold(context.household.id, [
				...result.months.map((month) => `month:${month}` as HouseholdChange),
				"months",
				"bucket-uses",
			]);
		return result;
	});

/** Paid back lines with money not matched to anything Owed back yet, newest first. */
export const getUnmatchedPaidBack = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		({ context }): Promise<UnmatchedPaidBack[]> =>
			loadUnmatchedPaidBack(getDb(), context.household.id),
	);
