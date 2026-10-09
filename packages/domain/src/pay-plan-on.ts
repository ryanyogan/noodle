import { EXTRA_INCOME_FROM } from "./extra-income";
import type { Cents } from "./money";
import type { PayHistory, PayMonthFigure } from "./pay-history";
import type { PayRange } from "./pay-range";

// What to plan on (issue 159, phase b; ADR-0067): from what a Parent's pay has been, the figure
// the Plan can count on. ADR-0040 says "the lowest it usually is"; this is how that is read off
// twelve months: the second-lowest, so one freak month doesn't set it.

/** How many months that count there must be before a figure is suggested. */
export const PLAN_ON_FROM = 6;

export type PlanOn = {
	/** The second-lowest month's Income. */
	amount: Cents;
	/** How many months it is read from, and in how many of them the pay came to `amount` or more. */
	of: number;
	atLeast: number;
	/** The one month that was lower, left out; null when the two lowest are the same. */
	below: PayMonthFigure | null;
};

/**
 * The pay a Parent can count on: the second-lowest of the months that count (up to twelve), so
 * it is what they were paid or more in all of those months but one. Null with fewer than six,
 * where leaving one out would be leaving out too much to go on.
 */
export function planOn(history: PayHistory): PlanOn | null {
	const counted = history.months.filter((m) => m.counted);
	if (counted.length < PLAN_ON_FROM) return null;
	const [lowest, second] = [...counted].sort((a, b) => a.total - b.total);
	if (!lowest || !second) return null;
	const below = lowest.total < second.total;
	return {
		amount: second.total,
		of: counted.length,
		atLeast: counted.length - (below ? 1 : 0),
		below: below ? { month: lowest.month, total: lowest.total } : null,
	};
}

/**
 * The Take-home pay those figures make: each Parent's `planOn`, with what everyone else's pay
 * (and the Household's own) can be counted on for, as `payRanges` reads it. Still one Household
 * figure (ADR-0040).
 */
export function planOnTakeHome(
	planOns: readonly { memberId: string; amount: Cents }[],
	ranges: readonly PayRange[],
): { takeHome: Cents; others: Cents } {
	const own = new Set(planOns.map((one) => one.memberId));
	const others = ranges
		.filter((range) => range.whosePay === null || !own.has(range.whosePay))
		.reduce((sum, range) => sum + range.countOn, 0);
	const takeHome = planOns.reduce((sum, one) => sum + one.amount, others);
	return { takeHome: takeHome as Cents, others: others as Cents };
}

/** Whether `takeHome` is worth offering: more than a few dollars from what the Plan counts on. */
export const planOnDiffers = (takeHome: Cents, baseline: Cents | null): boolean =>
	takeHome > 0 && (baseline === null || Math.abs(takeHome - baseline) > EXTRA_INCOME_FROM);
