import { addFeesBucket as addFeesBucketInDb, type FeesBucketAdded } from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { queueAi } from "./ai-queue";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { assertEditable } from "./plan";
import { ulidSchema } from "./schemas";

/**
 * Review's Confirm on a fee or interest (issue 137): `month`'s Plan gets its "Fees and interest"
 * Bucket, and says which Bucket that is. One the Household already has by that name is used again
 * (an archived one is brought back) instead of a second being added under `bucketId`.
 */
export const addFeesBucket = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			bucketId: ulidSchema,
			month: monthKeySchema,
			color: z.number().int().min(1).max(8),
		}),
	)
	.handler(async ({ data, context }): Promise<FeesBucketAdded> => {
		assertEditable(context.household, data.month);
		const added = await addFeesBucketInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
		if (added.how !== "there") {
			await notifyHousehold(context.household.id, ["months"]);
			// A new Bucket may fit what waits in Review.
			await queueAi({ ...viewerOf(context), kind: "buckets-changed" });
		}
		return added;
	});
