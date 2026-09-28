import type { Cents } from "./money";
import { type DayKey, daysElapsed, daysInMonth, monthOfDay } from "./month";
import { freeToSpend, type Plan, type PlanBucket, totalAllowances } from "./plan";

/** Spending recorded against a Bucket on a day (a Transaction or one of its Splits). */
export type Spend = { bucketId: string; amount: Cents; date: DayKey };

/**
 * `ahead`: spent faster than Pace allows (by more than a small tolerance).
 * `over`: spent more than the allowance.
 */
export type BucketStatus = "on-pace" | "ahead" | "over";

export type BucketState = PlanBucket & {
	spent: Cents;
	/** Negative once the Bucket is overspent. */
	left: Cents;
	pace: {
		/** What should have been spent by the end of the as-of day if spent evenly. */
		spent: Cents;
		/** The share of the allowance that should still be left by then, 0–1. */
		leftShare: number;
	};
	status: BucketStatus;
};

export type MonthState = Omit<Plan, "buckets"> & {
	asOf: DayKey;
	daysInMonth: number;
	/** Days after the as-of day until the month ends. */
	daysLeft: number;
	/** Everything assigned to Buckets. */
	planned: Cents;
	/** Negative when the Plan assigns more than the Baseline. */
	freeToSpend: Cents;
	/** What's left across Buckets, not counting any Bucket's overspending. */
	leftInBuckets: Cents;
	buckets: BucketState[];
};

/** Spending ahead of Pace by no more than this share of the allowance still counts as on Pace. */
const PACE_TOLERANCE = 0.03;

/**
 * The state of a month: each Bucket's allowance, spent, left, Pace, and status, and Free to
 * Spend, as of the end of a given day. Spending outside the month, or against a Bucket not in
 * the Plan, is ignored. The server and the client's optimistic updates both call this, so the
 * numbers a Parent sees before and after a save are the same.
 */
export function monthState({
	plan,
	spending,
	asOf,
}: {
	plan: Plan;
	spending: Spend[];
	asOf: DayKey;
}): MonthState {
	const days = daysInMonth(plan.month);
	const elapsed = daysElapsed(plan.month, asOf);
	const spentByBucket = new Map<string, Cents>();
	for (const spend of spending) {
		if (monthOfDay(spend.date) !== plan.month) continue;
		spentByBucket.set(spend.bucketId, (spentByBucket.get(spend.bucketId) ?? 0) + spend.amount);
	}
	const buckets = plan.buckets.map((bucket): BucketState => {
		const spent = spentByBucket.get(bucket.id) ?? 0;
		const left = bucket.allowance - spent;
		const paceSpent = Math.round((bucket.allowance * elapsed) / days);
		const status: BucketStatus =
			left < 0
				? "over"
				: spent - paceSpent > bucket.allowance * PACE_TOLERANCE
					? "ahead"
					: "on-pace";
		return {
			...bucket,
			spent,
			left,
			pace: { spent: paceSpent, leftShare: 1 - elapsed / days },
			status,
		};
	});
	return {
		month: plan.month,
		baseline: plan.baseline,
		asOf,
		daysInMonth: days,
		daysLeft: days - elapsed,
		planned: totalAllowances(plan),
		freeToSpend: freeToSpend(plan),
		leftInBuckets: buckets.reduce((sum, b) => sum + Math.max(0, b.left), 0),
		buckets,
	};
}
