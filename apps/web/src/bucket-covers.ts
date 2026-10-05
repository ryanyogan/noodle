import type { PlanMove } from "@noodle/db";
import type { MonthKey } from "@noodle/domain";

/** A Cover as one Bucket's page lists it. */
export type BucketCover = {
	move: PlanMove;
	/** "into": the money came into this Bucket. "out": it left this Bucket to cover another. */
	direction: "into" | "out";
	/** The Bucket on the other side; null when the money came from outside the Buckets. */
	otherBucketId: string | null;
};

/**
 * A month's Covers that involve a Bucket, oldest first as the Moves are: money that came into it
 * (from another Bucket, or from Free to Spend) and money that went out of it to cover another.
 * A Cover from Free to Spend is listed on the Bucket it covered. An undone Cover is no longer
 * among the month's Moves, so it isn't listed.
 */
export function coversOfBucket(
	moves: readonly PlanMove[],
	bucketId: string,
	month: MonthKey,
): BucketCover[] {
	const covers: BucketCover[] = [];
	for (const move of moves) {
		if (move.month !== month) continue;
		if (move.toBucketId === bucketId) {
			covers.push({ move, direction: "into", otherBucketId: move.fromBucketId });
		} else if (move.fromBucketId === bucketId) {
			covers.push({ move, direction: "out", otherBucketId: move.toBucketId });
		}
	}
	return covers;
}
