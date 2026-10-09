import { countsOn } from "./extra-income";
import type { Cents } from "./money";
import { addMonths, type MonthKey, monthOfDay } from "./month";
import type { PayLine } from "./pay-range";

// What a Parent's pay has been (issue 159, phase b; ADR-0067): their Income by month over the
// last twelve months that have ended, with the average, the lowest and the highest. Pay counts in
// the month it arrives (ADR-0066), so a late client makes a low month here, which is the point.

/** How many ended months are looked back over. */
export const PAY_HISTORY_MONTHS = 12;

/** The shorter of the two averages. */
export const PAY_HISTORY_RECENT = 6;

export type PayMonth = {
	month: MonthKey;
	total: Cents;
	/**
	 * In the averages: a month that has ended, from the first month Noodle has this Parent's Income
	 * for. A month with nothing in after that is a month of $0, and counts.
	 */
	counted: boolean;
};

export type PayMonthFigure = { month: MonthKey; total: Cents };

export type PayHistory = {
	/** The twelve months before the month looked at, oldest first, then that month itself. */
	months: PayMonth[];
	/** How many of the twelve count. */
	counted: number;
	/** Over the last six months that count (fewer when there are fewer); null with none. */
	recent: { average: Cents; months: number } | null;
	/** Over every month that counts, when that is more than six; null otherwise. */
	year: { average: Cents; months: number } | null;
	low: PayMonthFigure | null;
	high: PayMonthFigure | null;
};

const average = (months: readonly PayMonth[]) =>
	Math.round(months.reduce((sum, m) => sum + m.total, 0) / months.length) as Cents;

/**
 * `whosePay`'s Income by month, from Income that counts: the twelve months before `month` and
 * `month` itself, which is shown and never in the averages (it hasn't ended, or is the one being
 * read). Of two months with the same total, the later is the lowest or highest.
 */
export function payHistory(
	lines: readonly PayLine[],
	whosePay: string,
	month: MonthKey,
): PayHistory {
	const totals = new Map<MonthKey, number>();
	for (const line of lines) {
		if (line.whosePay !== whosePay) continue;
		const lineMonth = monthOfDay(countsOn(line));
		totals.set(lineMonth, (totals.get(lineMonth) ?? 0) + line.amount);
	}
	let started = false;
	const months: PayMonth[] = [];
	for (let back = PAY_HISTORY_MONTHS; back >= 0; back--) {
		const m = addMonths(month, -back);
		const total = (totals.get(m) ?? 0) as Cents;
		if (total > 0) started = true;
		months.push({ month: m, total, counted: started && back > 0 });
	}
	const counted = months.filter((m) => m.counted);
	const figure = (pick: (a: PayMonth, b: PayMonth) => PayMonth): PayMonthFigure | null => {
		if (counted.length === 0) return null;
		const { month: m, total } = counted.reduce(pick);
		return { month: m, total };
	};
	return {
		months,
		counted: counted.length,
		recent:
			counted.length > 0
				? {
						average: average(counted.slice(-PAY_HISTORY_RECENT)),
						months: Math.min(counted.length, PAY_HISTORY_RECENT),
					}
				: null,
		year:
			counted.length > PAY_HISTORY_RECENT
				? { average: average(counted), months: counted.length }
				: null,
		low: figure((a, b) => (b.total <= a.total ? b : a)),
		high: figure((a, b) => (b.total >= a.total ? b : a)),
	};
}
