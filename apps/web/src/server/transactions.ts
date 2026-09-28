import { addQuickAdd as addQuickAddInDb, loadBucketUses } from "@noodle/db";
import { type BucketUse, dayKeyAt, MAX_CENTS } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { ulidSchema } from "./schemas";

/** How far back Quick Add looks to order Buckets by likelihood. */
const LIKELY_WINDOW_DAYS = 90;

/**
 * Records a Quick Add, dated today in the Household's time zone. Idempotent per
 * `transactionId` (a client ULID), so the client can retry it safely.
 */
export const addQuickAdd = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			transactionId: ulidSchema,
			bucketId: ulidSchema,
			amountCents: z.number().int().min(1).max(MAX_CENTS),
			note: z.string().trim().max(80).optional(),
		}),
	)
	.handler(async ({ data, context }) => {
		const result = await addQuickAddInDb(getDb(), {
			householdId: context.household.id,
			transactionId: data.transactionId,
			bucketId: data.bucketId,
			date: dayKeyAt(new Date(), context.household.timeZone),
			amountCents: data.amountCents,
			note: data.note || null,
			createdByMemberId: context.parent.id,
		});
		if (!result.ok) throw new Error("That Bucket isn’t in this month’s Plan.");
	});

/** Recent spending's Buckets, so Quick Add can offer the likeliest first. */
export const getBucketUses = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<BucketUse[]> => {
		const since = new Date(Date.now() - LIKELY_WINDOW_DAYS * 86_400_000);
		return loadBucketUses(
			getDb(),
			context.household.id,
			dayKeyAt(since, context.household.timeZone),
		);
	});
