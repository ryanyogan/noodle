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

/** A month as a sentence names it: the year only when it isn't this one. */
function named(month: MonthKey, current: MonthKey) {
	const year = month.slice(0, 4);
	return year === current.slice(0, 4) ? monthName(month) : `${monthName(month)} ${year}`;
}

/**
 * What a picker says when a search finds nothing in a month that is over, or null for the month
 * it is now and later ones, which can still be given a Bucket. A past month's Plan is closed, so
 * its picker never offers to create one.
 */
export function pastPlanSentence(month: MonthKey, current: MonthKey): string | null {
	if (month >= current) return null;
	return `Nothing in ${named(month, current)} matches, and a past month’s Plan can’t be given a new Bucket.`;
}

/** In place of Split, for a month with nothing to file in: every Split belongs somewhere. */
export const noSplitSentence = (month: MonthKey, current: MonthKey) =>
	`It can’t be split: each Split belongs to a Bucket, and ${named(month, current)} had none.`;

/** On Save, for an Unassigned Transaction of such a month: an edit is saved with where it belongs. */
export const cantSaveSentence = (month: MonthKey, current: MonthKey) =>
	`${named(month, current)} had no Buckets, so there’s nothing to assign this to and changes to it can’t be saved.`;

/** The one sentence a picker shows instead of an empty list; the year only when it isn't this one. */
export function noBucketsSentence(month: MonthKey, current: MonthKey, canFileWithout: boolean) {
	const name = named(month, current);
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
