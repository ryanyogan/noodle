import { type DayKey, daysBetween } from "./month";

/** A past use of a Bucket, e.g. an earlier Quick Add filed into it. */
export type BucketUse = { bucketId: string; date: DayKey };

/** How many days until an old use counts half as much as one today. */
const HALF_LIFE_DAYS = 14;

/**
 * Buckets ordered by how likely the next Quick Add goes into them: each past use counts, and
 * recent uses count more (halving every two weeks). Buckets used equally often keep their Plan
 * order, so with no history this is the Plan's order.
 */
export function likelyBucketOrder<T extends { id: string }>(
	buckets: T[],
	uses: BucketUse[],
	today: DayKey,
): T[] {
	const score = new Map<string, number>();
	for (const use of uses) {
		const age = Math.max(0, daysBetween(use.date, today));
		score.set(use.bucketId, (score.get(use.bucketId) ?? 0) + 0.5 ** (age / HALF_LIFE_DAYS));
	}
	// Array.prototype.sort is stable, so ties keep the Plan's order.
	return [...buckets].sort((a, b) => (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0));
}
