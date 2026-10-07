import {
	linkMoneyInRefund,
	loadMoneyInRefund,
	type MoneyInRefund,
	type RefundLinkResult,
	unlinkMoneyInRefund,
} from "@noodle/db";
import { dayKeyAt } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { HouseholdChange } from "../household-changes";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// A Refund that landed in checking, linked to the purchase it is money back for (issue 131,
// ADR-0057): the purchase's Bucket or Commitment gets the money back in the month it landed.

export type { MoneyInRefund, RefundLinkResult };

const moved = (result: RefundLinkResult): HouseholdChange[] =>
	result.ok
		? [
				...result.months.map((month) => `month:${month}` as HouseholdChange),
				"months",
				"bucket-uses",
			]
		: [];

/** A Refund money-in line with its purchase, or the purchases to pick from; null when it isn't one. */
export const getMoneyInRefund = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ incomeId: ulidSchema }))
	.handler(
		({ data, context }): Promise<MoneyInRefund | null> =>
			loadMoneyInRefund(
				getDb(),
				viewerOf(context),
				data.incomeId,
				dayKeyAt(new Date(), context.household.timeZone),
			),
	);

/** A Parent says which purchase a Refund in checking is for. Idempotent: a line has one link. */
export const linkRefundToPurchase = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ incomeId: ulidSchema, transactionId: ulidSchema }))
	.handler(async ({ data, context }): Promise<RefundLinkResult> => {
		const today = dayKeyAt(new Date(), context.household.timeZone);
		const result = await linkMoneyInRefund(getDb(), viewerOf(context), { ...data, today });
		if (result.ok) await notifyHousehold(context.household.id, moved(result));
		return result;
	});

/** A Parent takes the link off, while the month it counted in is still running. Idempotent. */
export const unlinkRefundFromPurchase = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ incomeId: ulidSchema }))
	.handler(async ({ data, context }): Promise<RefundLinkResult> => {
		const today = dayKeyAt(new Date(), context.household.timeZone);
		const result = await unlinkMoneyInRefund(getDb(), viewerOf(context), { ...data, today });
		if (result.ok && result.months.length > 0)
			await notifyHousehold(context.household.id, moved(result));
		return result;
	});
