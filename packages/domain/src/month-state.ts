import { dueDatesIn } from "./commitments";
import type { Cents } from "./money";
import { type DayKey, daysElapsed, daysInMonth, type MonthKey, monthOfDay } from "./month";
import {
	freeToSpend,
	type Plan,
	type PlanBucket,
	type PlanCommitment,
	totalAllowances,
	totalCommitments,
} from "./plan";

/** Spending recorded against a Bucket on a day (a Transaction or one of its Splits). */
export type Spend = { bucketId: string; amount: Cents; date: DayKey };

/** A payment recorded against a Commitment on a day (a Transaction or one of its Splits). */
export type Charge = { commitmentId: string; amount: Cents; date: DayKey };

/**
 * A Move of planned money within one month's Plan, from a Bucket (or from Free to Spend, when
 * `fromBucketId` is null) to a Bucket. No real money moves. A Cover is one.
 */
export type Move = {
	fromBucketId: string | null;
	toBucketId: string;
	amount: Cents;
	month: MonthKey;
};

/**
 * `ahead`: spent faster than Pace allows (by more than a small tolerance).
 * `over`: spent more than the allowance.
 */
export type BucketStatus = "on-pace" | "ahead" | "over";

export type BucketState = PlanBucket & {
	/** Carried in from last month, when the Bucket was Rolling then; negative if it was overspent. */
	rolledOver: Cents;
	/** Moved into the Bucket this month, less what was moved out of it. */
	moved: Cents;
	/** What the Bucket has to spend this month: its allowance, what rolled over, and what was moved into it. */
	available: Cents;
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

/**
 * `not-due`: not due this month, and not charged.
 * `upcoming`: due more times than it has been charged so far, each charge as expected.
 * `paid`: charged each time it's due, each for the expected amount.
 * `differs`: what was charged isn't what was expected for those charges.
 */
export type CommitmentStatus = "not-due" | "upcoming" | "paid" | "differs";

export type CommitmentState = PlanCommitment & {
	/** The days this month it's due. */
	dueDates: DayKey[];
	/** What the Plan sets aside for it this month: its amount each time it's due. */
	expected: Cents;
	/** What has been charged to it this month so far. */
	actual: Cents;
	/** How many charges that took. */
	charges: number;
	/**
	 * How much more (negative: less) was charged than expected for the charges so far. Each
	 * charge, up to the number of times it's due, is expected to be `amount`; any beyond that
	 * wasn't expected at all.
	 */
	difference: Cents;
	status: CommitmentStatus;
};

export type MonthState = Omit<Plan, "buckets" | "commitments"> & {
	asOf: DayKey;
	daysInMonth: number;
	/** Days after the as-of day until the month ends. */
	daysLeft: number;
	/** Everything assigned to Buckets. */
	planned: Cents;
	/** Everything the Commitments are expected to take this month. */
	committed: Cents;
	/** Moved from Free to Spend into Buckets this month. */
	movedToBuckets: Cents;
	/** Negative when the Plan assigns more than the Baseline. */
	freeToSpend: Cents;
	/** What's left across Buckets, not counting any Bucket's overspending. */
	leftInBuckets: Cents;
	commitments: CommitmentState[];
	buckets: BucketState[];
};

/** Spending ahead of Pace by no more than this share of the allowance still counts as on Pace. */
const PACE_TOLERANCE = 0.03;

/**
 * The state of a month: each Bucket's allowance, spent, left, Pace, and status, each
 * Commitment's expected and actual amounts, and Free to Spend, as of the end of a given day.
 * Moves shift money between Buckets and Free to Spend; what rolled over from last month (see
 * `rolledOver`) adds to a Bucket without touching Free to Spend. Spending, charges, and Moves outside the
 * month, or involving a Bucket or Commitment not in the Plan, are ignored. The server and the client's optimistic updates both call this, so the numbers a
 * Parent sees before and after a save are the same.
 */
export function monthState({
	plan,
	spending,
	charges = [],
	moves = [],
	rolledOver = {},
	asOf,
}: {
	plan: Plan;
	spending: Spend[];
	charges?: Charge[];
	moves?: Move[];
	/** Per Bucket ID, what carried in from last month. */
	rolledOver?: Record<string, Cents>;
	asOf: DayKey;
}): MonthState {
	const days = daysInMonth(plan.month);
	const elapsed = daysElapsed(plan.month, asOf);
	const spentByBucket = new Map<string, Cents>();
	for (const spend of spending) {
		if (monthOfDay(spend.date) !== plan.month) continue;
		spentByBucket.set(spend.bucketId, (spentByBucket.get(spend.bucketId) ?? 0) + spend.amount);
	}
	const inPlan = new Set(plan.buckets.map((b) => b.id));
	const movedByBucket = new Map<string, Cents>();
	let movedToBuckets = 0;
	for (const { fromBucketId: from, toBucketId: to, amount, month } of moves) {
		if (month !== plan.month || !inPlan.has(to) || (from !== null && !inPlan.has(from))) continue;
		movedByBucket.set(to, (movedByBucket.get(to) ?? 0) + amount);
		if (from === null) movedToBuckets += amount;
		else movedByBucket.set(from, (movedByBucket.get(from) ?? 0) - amount);
	}
	const buckets = plan.buckets.map((bucket): BucketState => {
		const moved = movedByBucket.get(bucket.id) ?? 0;
		const carried = rolledOver[bucket.id] ?? 0;
		const available = bucket.allowance + carried + moved;
		const spent = spentByBucket.get(bucket.id) ?? 0;
		const left = available - spent;
		// Pace spreads what the Bucket has to spend evenly across the month.
		const paced = Math.max(0, available);
		const paceSpent = Math.round((paced * elapsed) / days);
		const status: BucketStatus =
			left < 0 ? "over" : spent - paceSpent > paced * PACE_TOLERANCE ? "ahead" : "on-pace";
		return {
			...bucket,
			rolledOver: carried,
			moved,
			available,
			spent,
			left,
			pace: { spent: paceSpent, leftShare: 1 - elapsed / days },
			status,
		};
	});
	const chargedByCommitment = new Map<string, Cents[]>();
	for (const charge of charges) {
		if (monthOfDay(charge.date) !== plan.month) continue;
		const amounts = chargedByCommitment.get(charge.commitmentId) ?? [];
		chargedByCommitment.set(charge.commitmentId, [...amounts, charge.amount]);
	}
	const commitments = plan.commitments.map((commitment): CommitmentState => {
		const dueDates = dueDatesIn(commitment, plan.month);
		const charged = chargedByCommitment.get(commitment.id) ?? [];
		const actual = charged.reduce((sum, amount) => sum + amount, 0);
		const difference = actual - commitment.amount * Math.min(charged.length, dueDates.length);
		const status: CommitmentStatus =
			difference !== 0
				? "differs"
				: charged.length < dueDates.length
					? "upcoming"
					: dueDates.length > 0
						? "paid"
						: "not-due";
		return {
			...commitment,
			dueDates,
			expected: commitment.amount * dueDates.length,
			actual,
			charges: charged.length,
			difference,
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
		committed: totalCommitments(plan),
		movedToBuckets,
		freeToSpend: freeToSpend(plan) - movedToBuckets,
		leftInBuckets: buckets.reduce((sum, b) => sum + Math.max(0, b.left), 0),
		commitments,
		buckets,
	};
}
