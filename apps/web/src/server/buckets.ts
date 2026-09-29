import { loadBucketHistory, loadPlanRecords } from "@noodle/db";
import {
	addMonths,
	type BucketMonth,
	type BucketRecord,
	type DayKey,
	dayKeyAt,
	monthOfDay,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { ulidSchema } from "./schemas";

/** How many months, this one included, a Bucket's page looks back over. */
export const BUCKET_MONTHS = 12;

/**
 * A Bucket over the last year, month by month: its allowance, spending, Moves and balance, as
 * totals only. The other Parent's Personal Allowance reads the same way, since its monthly totals
 * are all that ever crosses to them (ADR-0003); its Transactions come from the Transactions list,
 * which never returns them. `bucket` is null once no Plan has it.
 */
export type BucketPageData = {
	bucket: BucketRecord | null;
	months: BucketMonth[];
	asOf: DayKey;
};

export const getBucket = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ bucketId: ulidSchema }))
	.handler(async ({ data, context }): Promise<BucketPageData> => {
		const db = getDb();
		const asOf = dayKeyAt(new Date(), context.household.timeZone);
		const month = monthOfDay(asOf);
		const records = await loadPlanRecords(db, context.household.id, month);
		const bucket = records.buckets.find((b) => b.id === data.bucketId) ?? null;
		if (!bucket) return { bucket, months: [], asOf };
		const months = await loadBucketHistory(db, viewerOf(context), records, {
			bucketId: bucket.id,
			from: addMonths(month, 1 - BUCKET_MONTHS),
			to: month,
		});
		return { bucket, months, asOf };
	});
