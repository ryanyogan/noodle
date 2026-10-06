import { FEES_AND_INTEREST, type MonthKey } from "@noodle/domain";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./index";
import { addBucket, restoreBucket } from "./plan";
import { buckets } from "./schema";

/** How the Plan came to have its "Fees and interest" Bucket: it was there, brought back, or added. */
export type FeesBucketAdded = { bucketId: string; how: "there" | "restored" | "added" };

/**
 * The Household's "Fees and interest" Bucket in `month`'s Plan (issue 137), never a second of that
 * name: one already in the Plan is used as it is, an archived one is brought back from `month` on
 * (at $0, as a new one starts), and only with neither is one added, under `bucketId` (resets
 * monthly, $0 allowance). The name is matched whatever its capitals; a Personal Allowance never
 * counts. Sending it again with the same ID adds nothing more.
 */
export async function addFeesBucket(
	db: Db,
	input: {
		householdId: string;
		memberId: string;
		bucketId: string;
		month: MonthKey;
		color: number;
	},
): Promise<FeesBucketAdded> {
	const name = FEES_AND_INTEREST.toLowerCase();
	const rows = await db
		.select({
			id: buckets.id,
			name: buckets.name,
			fromMonth: buckets.fromMonth,
			archivedFromMonth: buckets.archivedFromMonth,
		})
		.from(buckets)
		.where(and(eq(buckets.householdId, input.householdId), isNull(buckets.ownerMemberId)));
	const named = rows.filter((bucket) => bucket.name.trim().toLowerCase() === name);
	const there = named.find(
		(bucket) =>
			bucket.fromMonth <= input.month &&
			(bucket.archivedFromMonth === null || input.month < bucket.archivedFromMonth),
	);
	if (there) return { bucketId: there.id, how: "there" };
	// The one archived last, when there are several.
	const [archived] = named
		.filter(
			(bucket) => bucket.archivedFromMonth !== null && bucket.archivedFromMonth <= input.month,
		)
		.sort((a, b) => ((a.archivedFromMonth ?? "") < (b.archivedFromMonth ?? "") ? 1 : -1));
	const { householdId, memberId, month } = input;
	if (
		archived &&
		(await restoreBucket(db, {
			householdId,
			memberId,
			bucketId: archived.id,
			month,
			amountCents: 0,
		}))
	) {
		return { bucketId: archived.id, how: "restored" };
	}
	await addBucket(db, {
		householdId,
		memberId,
		bucketId: input.bucketId,
		name: FEES_AND_INTEREST,
		color: input.color,
		month,
		allowanceCents: 0,
	});
	return { bucketId: input.bucketId, how: "added" };
}
