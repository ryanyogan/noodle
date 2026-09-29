import type { AttributedSpend, For } from "./for";
import type { Cents } from "./money";
import type { DayKey } from "./month";
import type { Charge } from "./month-state";

/** What a Transaction, or one of its Splits, is assigned to: a Bucket or a Commitment. */
export type Assignment = { bucketId: string } | { commitmentId: string };

/**
 * What a Split is assigned to: a Bucket, a Commitment, or a Goal. A Split assigned to a Goal is
 * Goal spending, out of the Goal's Earmark, never a Bucket or Free to Spend. A whole Transaction
 * is only Goal spending when it's spent from the Goal itself.
 */
export type SplitAssignment = Assignment | { goalId: string };

/** A portion of a Transaction with its own amount, assignment, and For. */
export type Split = { amount: Cents; assignment: SplitAssignment; for: For };

/** Part of a Transaction spent from a Goal's Earmark through one of its Splits. */
export type GoalSpend = { goalId: string; amount: Cents; date: DayKey };

/**
 * A Transaction as it counts toward its month: assigned as a whole (with one For), or, when it
 * has Splits, through those alone.
 */
export type AssignedTransaction = {
	date: DayKey;
	amount: Cents;
	/** Its whole assignment; ignored once it has Splits. */
	assignment: Assignment | null;
	for: For;
	splits: Split[];
};

/** How much of `amount` its Splits still leave unassigned; negative when they take too much. */
export function splitRemainder(amount: Cents, splits: Pick<Split, "amount">[]): Cents {
	return splits.reduce((left, split) => left - split.amount, amount);
}

/** Whether Splits can stand in for a whole Transaction: two or more, each positive, adding up. */
export function splitsBalance(amount: Cents, splits: Pick<Split, "amount">[]): boolean {
	return (
		splits.length >= 2 &&
		splits.every((split) => Number.isInteger(split.amount) && split.amount > 0) &&
		splitRemainder(amount, splits) === 0
	);
}

/**
 * What a Transaction adds to its month: Bucket spending (with who it was For) and Commitment
 * charges. A split Transaction contributes each Split to its own Bucket or Commitment and its
 * own Members instead of its whole assignment. Splits of one Transaction paying the same
 * Commitment are one charge of it, as the whole Transaction would have been. Splits assigned to
 * a Goal add nothing to the month: they're `goalSpending`, taken from the Goal's Earmark.
 */
export function assignedParts(transaction: AssignedTransaction): {
	spending: AttributedSpend[];
	charges: Charge[];
	goalSpending: GoalSpend[];
} {
	const { date } = transaction;
	const parts: Split[] =
		transaction.splits.length > 0
			? transaction.splits
			: transaction.assignment
				? [{ amount: transaction.amount, assignment: transaction.assignment, for: transaction.for }]
				: [];
	const spending: AttributedSpend[] = [];
	const goalSpending: GoalSpend[] = [];
	const charged = new Map<string, Cents>();
	for (const { amount, assignment, for: forIds } of parts) {
		if ("bucketId" in assignment) {
			spending.push({ bucketId: assignment.bucketId, amount, date, for: forIds });
		} else if ("goalId" in assignment) {
			goalSpending.push({ goalId: assignment.goalId, amount, date });
		} else {
			charged.set(assignment.commitmentId, (charged.get(assignment.commitmentId) ?? 0) + amount);
		}
	}
	const charges = [...charged].map(([commitmentId, amount]) => ({ commitmentId, amount, date }));
	return { spending, charges, goalSpending };
}
