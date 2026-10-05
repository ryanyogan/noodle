import type { Cents } from "./money";
import { addMonths, type MonthKey } from "./month";
import { effective, freeToSpend, type PlanRecords, planForMonth } from "./plan";

// Free to Spend that builds up (issue 113, ADR-0054). A month's Free to Spend either starts fresh
// (the default) or builds up: what it ends with, when above zero, is added to the next month's.
// Like a Bucket that Carries over (see rollover.ts), the carry is derived by walking the months
// and is never stored, so a late change to an ended month reaches the months after it.

/** A month's total of something, e.g. everything Moved out of Free to Spend in it. */
export type MonthAmount = { month: MonthKey; amount: Cents };

type CarryRecords = Pick<PlanRecords, "freeCarries">;

/** Whether `month`'s Free to Spend builds up: the latest setting at or before it, else it starts fresh. */
export function freeCarries(records: CarryRecords, month: MonthKey): boolean {
	return effective(records.freeCarries ?? [], month)?.carries ?? false;
}

/**
 * The first month whose Free to Spend can reach `month`: the start of the unbroken run of months
 * building up that ends the month before it. Null when the month before starts fresh, so nothing
 * is carried in and no history is needed. Months before a Parent turned building up on, or
 * before a stretch where it was off, never count.
 */
export function freeCarrySince(records: CarryRecords, month: MonthKey): MonthKey | null {
	const before = (records.freeCarries ?? [])
		.filter((record) => record.month < month)
		.sort((a, b) => (a.month < b.month ? -1 : 1));
	let since: MonthKey | null = null;
	for (let i = before.length - 1; i >= 0; i--) {
		const record = before[i];
		if (!record?.carries) break;
		since = record.month;
	}
	return since;
}

/** One month of Free to Spend building up. */
export type FreeCarryMonth = {
	month: MonthKey;
	/** Whether the month builds up (else it starts fresh and carries nothing on). */
	carries: boolean;
	/** Carried in from the month before. */
	carriedIn: Cents;
	/** Free to Spend at the month's end, carried-in money included; negative when over-planned. */
	left: Cents;
	/** What it carries into the next month: `left` when it builds up and is above zero, else nothing. */
	carriedOut: Cents;
};

type CarryInputs = {
	/** Every Plan record through the last month walked. */
	records: PlanRecords;
	/**
	 * Per month, everything Moved out of Free to Spend (Covers from it and Goal funding, never
	 * Moves of Extra income), for at least every month walked.
	 */
	outOfFree: readonly MonthAmount[];
	/** Per month, Extra income a Parent added to Free to Spend, for the same months. */
	extraToFree: readonly MonthAmount[];
};

/**
 * Free to Spend month by month from `from` through `to`, each month with what the one before
 * carried into it (nothing into `from`). A month that ends below zero carries nothing: the next
 * month starts clean, though money carried into an over-planned month does count toward it.
 */
export function freeCarryMonths({
	records,
	outOfFree,
	extraToFree,
	from,
	to,
}: CarryInputs & { from: MonthKey; to: MonthKey }): FreeCarryMonth[] {
	const out = totals(outOfFree);
	const extra = totals(extraToFree);
	const months: FreeCarryMonth[] = [];
	let carriedIn = 0;
	for (let month = from; month <= to; month = addMonths(month, 1)) {
		const left =
			freeToSpend(planForMonth(records, month)) -
			(out.get(month) ?? 0) +
			(extra.get(month) ?? 0) +
			carriedIn;
		const carries = freeCarries(records, month);
		const carriedOut = carries ? Math.max(0, left) : 0;
		months.push({ month, carries, carriedIn, left, carriedOut });
		carriedIn = carriedOut;
	}
	return months;
}

/**
 * What `month`'s Free to Spend starts with from earlier months: zero unless the month before
 * builds up. Pass it to `monthState` as `freeCarriedIn`.
 */
export function freeCarriedIn({ month, ...inputs }: CarryInputs & { month: MonthKey }): Cents {
	const since = freeCarrySince(inputs.records, month);
	if (since === null) return 0;
	const months = freeCarryMonths({ ...inputs, from: since, to: addMonths(month, -1) });
	return months[months.length - 1]?.carriedOut ?? 0;
}

/**
 * What of a month's leftover Free to Spend is offered to a Goal once the Household's "Keep back"
 * amount stays behind: never below zero. Keeping back only shapes that offer; money kept back
 * builds up (or ends with the month) like the rest.
 */
export function aboveKeepBack({ left, keepBack }: { left: Cents; keepBack: Cents }): Cents {
	return Math.max(0, left - Math.max(0, keepBack));
}

function totals(rows: readonly MonthAmount[]): Map<MonthKey, Cents> {
	const byMonth = new Map<MonthKey, Cents>();
	for (const { month, amount } of rows) byMonth.set(month, (byMonth.get(month) ?? 0) + amount);
	return byMonth;
}
