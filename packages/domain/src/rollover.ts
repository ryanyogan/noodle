import type { Cents } from "./money";
import { addMonths, lastDayOf, type MonthKey } from "./month";
import { type MonthState, type Move, monthState } from "./month-state";
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
	let carry: Record<string, Cents> = {};
	for (const state of monthsFrom(records, spent, moves, since, month)) carry = carryOf(state);
	return carry;
}

/** What a month's Rolling Buckets carry into the next, per Bucket ID. */
const carryOf = (state: MonthState): Record<string, Cents> =>
	Object.fromEntries(
		state.buckets.filter((b) => b.rolling && b.left !== 0).map((b) => [b.id, b.left]),
	);

/**
 * Each month's state from `since` up to, not including, `until`, as of its last day, each with
 * what rolled into it from the month before (nothing into `since`).
 */
function* monthsFrom(
	records: PlanRecords,
	spent: MonthlySpend[],
	moves: Move[],
	since: MonthKey,
	until: MonthKey,
): Generator<MonthState> {
	// A month's total counts as spent on its first day; only the month's end matters here.
	const spending = spent.map(({ bucketId, month, amount }) => ({
		bucketId,
		amount,
		date: `${month}-01` as const,
	}));
	let carry: Record<string, Cents> = {};
	for (let m = since; m < until; m = addMonths(m, 1)) {
		const state = monthState({
			plan: planForMonth(records, m),
			spending,
			moves,
			rolledOver: carry,
			asOf: lastDayOf(m),
		});
		yield state;
		carry = carryOf(state);
	}
}

/** One month of a Bucket: what it had, what was spent, and what was left at the month's end. */
export type BucketMonth = {
	month: MonthKey;
	/** Whether the Bucket was in that month's Plan; every amount is zero in a month it wasn't. */
	inPlan: boolean;
	rolling: boolean;
	allowance: Cents;
	/** Carried in from the month before; negative if it was overspent. */
	rolledOver: Cents;
	/** Moved in, less moved out. */
	moved: Cents;
	spent: Cents;
	/** Left at the month's end (so far, in a month not over yet): what a Rolling Bucket carries on. */
	left: Cents;
};

/**
 * A Bucket month by month, from `from` through `to`: its allowance, what rolled into it, Moves,
 * spending, and its balance at each month's end, carried exactly as `rolledOver` carries it.
 * `spent` and `moves` must reach back to `rolloverSince(records, to)` when that is before `from`.
 */
export function bucketMonths({
	records,
	spent,
	moves,
	bucketId,
	from,
	to,
}: {
	records: PlanRecords;
	spent: MonthlySpend[];
	moves: Move[];
	bucketId: string;
	from: MonthKey;
	to: MonthKey;
}): BucketMonth[] {
	const since = earliest(rolloverSince(records, to), from);
	const months: BucketMonth[] = [];
	for (const state of monthsFrom(records, spent, moves, since, addMonths(to, 1))) {
		if (state.month < from) continue;
		const bucket = state.buckets.find((b) => b.id === bucketId);
		months.push({
			month: state.month,
			inPlan: bucket !== undefined,
			rolling: bucket?.rolling ?? false,
			allowance: bucket?.allowance ?? 0,
			rolledOver: bucket?.rolledOver ?? 0,
			moved: bucket?.moved ?? 0,
			spent: bucket?.spent ?? 0,
			left: bucket?.left ?? 0,
		});
	}
	return months;
}

const earliest = (a: MonthKey | null, b: MonthKey): MonthKey => (a !== null && a < b ? a : b);
