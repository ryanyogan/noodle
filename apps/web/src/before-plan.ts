import type { MonthKey } from "@noodle/domain";
import { monthName } from "./format";

// A Transaction dated before the Household's first Plan (issue 117): bank history often goes back
// further than the Buckets do. A month's spending is filed in that month's Plan, so such a month
// has nothing to file in, and a past month's Plan can't be given a Bucket now. The picker says so.

type Places = { buckets: readonly unknown[]; commitments: readonly unknown[] };

/**
 * True for a month that is over and whose Plan (once loaded) has nothing this Parent can file in:
 * no Bucket and no Commitment. The month it is now, and later ones, can still be given a Bucket.
 */
export function nothingToFileIn(
	plan: Places | null | undefined,
	month: MonthKey,
	current: MonthKey,
): boolean {
	if (!plan) return false;
	return month < current && plan.buckets.length === 0 && plan.commitments.length === 0;
}

/** The one sentence a picker shows instead of an empty list; the year only when it isn't this one. */
export function noBucketsSentence(month: MonthKey, current: MonthKey, canFileWithout: boolean) {
	const year = month.slice(0, 4);
	const name = year === current.slice(0, 4) ? monthName(month) : `${monthName(month)} ${year}`;
	return `${name} had no Buckets yet. Transactions from before your Plan can stay Unassigned${
		canFileWithout ? ", or file this one without a Bucket" : ""
	}.`;
}

/** Assigned nowhere as a whole: what "File without a Bucket" is offered for. */
export const isUnassigned = (transaction: {
	bucketId: string | null;
	commitmentId: string | null;
	goal: unknown;
	splits: readonly unknown[];
}) =>
	transaction.bucketId === null &&
	transaction.commitmentId === null &&
	!transaction.goal &&
	transaction.splits.length === 0;
