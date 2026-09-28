import type { Cents } from "./money";
import type { BucketState, MonthState } from "./month-state";

/** Somewhere a Cover can take money from: a Bucket, or Free to Spend when `bucket` is null. */
export type CoverSource = {
	bucket: BucketState | null;
	/** What it has left to give. */
	left: Cents;
	/** Whether that is enough to bring the overspent Bucket back to zero. */
	coversAll: boolean;
};

/**
 * What a Move's source has left to give this month: a Bucket's left, or Free to Spend when
 * `bucketId` is null. Null when the Bucket isn't in the Plan.
 */
export function leftToMove(state: MonthState, bucketId: string | null): Cents | null {
	if (bucketId === null) return state.freeToSpend;
	return state.buckets.find((b) => b.id === bucketId)?.left ?? null;
}

/**
 * Where to Cover an overspent Bucket from: Free to Spend and every other Bucket with money
 * left. Those with enough to bring it back to zero come first, Free to Spend before Buckets
 * (it isn't planned for anything yet), then Buckets with the most left. Empty when the Bucket
 * isn't over.
 */
export function coverSources(state: MonthState, bucketId: string): CoverSource[] {
	const over = state.buckets.find((b) => b.id === bucketId);
	if (!over || over.left >= 0) return [];
	const overBy = -over.left;
	const buckets = state.buckets
		.filter((b) => b.id !== bucketId && b.left > 0)
		.sort((a, b) => b.left - a.left)
		.map((bucket) => ({ bucket, left: bucket.left, coversAll: bucket.left >= overBy }));
	const sources: CoverSource[] =
		state.freeToSpend > 0
			? [
					{ bucket: null, left: state.freeToSpend, coversAll: state.freeToSpend >= overBy },
					...buckets,
				]
			: buckets;
	// Array.prototype.sort is stable, so each group keeps the order above.
	return sources.sort((a, b) => Number(b.coversAll) - Number(a.coversAll));
}
