import type { Cents } from "./money";
import { addMonths, lastDayOf, type MonthKey } from "./month";
import { type Move, monthState } from "./month-state";
import { type PlanRecords, planForMonth } from "./plan";

/** Everything spent against a Bucket in a month. */
export type MonthlySpend = { bucketId: string; month: MonthKey; amount: Cents };

/**
 * The first month whose leftovers can carry into `month`: the first month before it that any
 * Bucket was Rolling. Null when none was, so nothing rolls over and no history is needed.
 */
export function rolloverSince(
	records: Pick<PlanRecords, "rolling">,
	month: MonthKey,
): MonthKey | null {
	let since: MonthKey | null = null;
	for (const record of records.rolling) {
		if (record.rolling && record.month < month && (since === null || record.month < since)) {
			since = record.month;
		}
	}
	return since;
}

/**
 * What each Bucket carries into `month`, per Bucket ID (Buckets carrying nothing are left out).
 * A month's leftover (allowance, plus what rolled into it, plus Moves, less spending) carries
 * into the next month only if the Bucket was Rolling in that month; overspending carries too, as
 * a negative amount, unless it was Covered. A Fresh-start month, or a month the Bucket wasn't in
 * the Plan, carries nothing. So setting a Bucket Rolling or Fresh-start this month changes what
 * rolls into next month, never what rolled into this one.
 */
export function rolledOver({
	records,
	spent,
	moves,
	month,
}: {
	records: PlanRecords;
	/** Monthly spending totals for (at least) every month from `rolloverSince` to before `month`. */
	spent: MonthlySpend[];
	/** Moves from (at least) the same months. */
	moves: Move[];
	month: MonthKey;
}): Record<string, Cents> {
	const since = rolloverSince(records, month);
	if (since === null) return {};
	// A month's total counts as spent on its first day; only the month's end matters here.
	const spending = spent.map(({ bucketId, month, amount }) => ({
		bucketId,
		amount,
		date: `${month}-01` as const,
	}));
	let carry: Record<string, Cents> = {};
	for (let m = since; m < month; m = addMonths(m, 1)) {
		const state = monthState({
			plan: planForMonth(records, m),
			spending,
			moves,
			rolledOver: carry,
			asOf: lastDayOf(m),
		});
		carry = Object.fromEntries(
			state.buckets.filter((b) => b.rolling && b.left !== 0).map((b) => [b.id, b.left]),
		);
	}
	return carry;
}
