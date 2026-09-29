import type { Cents } from "./money";
import { addMonths, type MonthKey } from "./month";
import { effective, type Plan } from "./plan";

/**
 * How far a change to the Plan reaches: "from-on" sets the value from its month onward (later
 * months follow unless they have their own), "just" changes that one month and puts the next
 * month back to the value it had before.
 */
export type PlanScope = "from-on" | "just";

/**
 * The record that puts the month after `month` back to the value in force at `month`, written
 * alongside a "just" change so the change stays in its month. `series` is one value's
 * effective-dated records before the change. Null when the next month already has its own
 * record (which always wins) or nothing was in force at `month` to go back to.
 */
export function restoreAfterJust<T extends { month: MonthKey }>(
	series: T[],
	month: MonthKey,
): T | null {
	const next = addMonths(month, 1);
	if (series.some((record) => record.month === next)) return null;
	const inForce = effective(series, month);
	return inForce ? { ...inForce, month: next } : null;
}

/** What each value in a month's Plan was the month before, for the values it changed. */
export type PlanChanges = {
	baseline: Cents | null;
	/** By Bucket ID. */
	allowances: Record<string, Cents>;
	/** By Commitment ID. */
	commitments: Record<string, Cents>;
};

/**
 * The values `plan` changed from `before` (the Plan the month before), each with what it was:
 * the Baseline, and the allowance of every Bucket and amount of every Commitment in both Plans.
 * A value new this month, or with nothing before, is not a change.
 */
export function planChanges(plan: Plan, before: Plan | null): PlanChanges {
	const changes: PlanChanges = { baseline: null, allowances: {}, commitments: {} };
	if (!before) return changes;
	if (plan.baseline !== null && before.baseline !== null && plan.baseline !== before.baseline) {
		changes.baseline = before.baseline;
	}
	for (const bucket of plan.buckets) {
		const was = before.buckets.find((b) => b.id === bucket.id)?.allowance;
		if (was !== undefined && was !== bucket.allowance) changes.allowances[bucket.id] = was;
	}
	for (const commitment of plan.commitments) {
		const was = before.commitments.find((c) => c.id === commitment.id)?.amount;
		if (was !== undefined && was !== commitment.amount) changes.commitments[commitment.id] = was;
	}
	return changes;
}
