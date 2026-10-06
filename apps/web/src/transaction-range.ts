import { addMonths, type MonthKey } from "@noodle/domain";
import { monthName } from "./format";

/**
 * How many months the Transactions page lists (issue 99), each ending at the month in the
 * address: the last 3 months, that month's year so far, or every month up to it. Left out, the
 * list is the month alone. Kept in the address as `?range=`, so a link shows the same list.
 */
export const TRANSACTION_RANGES = ["3m", "year", "all"] as const;
export type TransactionRange = (typeof TRANSACTION_RANGES)[number];

/** The ranges as the control words them; "" is the month alone. */
export const RANGE_OPTIONS: { value: TransactionRange; label: string }[] = [
	{ value: "3m", label: "Last 3 months" },
	{ value: "year", label: "This year" },
	{ value: "all", label: "All time" },
];

/** Where a range starts, as the server takes it: a first month, or every month before too. */
export function rangeBounds(
	range: TransactionRange | undefined,
	month: MonthKey,
): { fromMonth?: MonthKey; andEarlier?: true } {
	if (range === "3m") return { fromMonth: addMonths(month, -2) };
	if (range === "year") return { fromMonth: `${month.slice(0, 4)}-01` as MonthKey };
	if (range === "all") return { andEarlier: true };
	return {};
}

const short = (month: MonthKey) => monthName(month).slice(0, 3);

/**
 * A range's months in words: "Aug – Oct 2026", "Dec 2025 – Feb 2026", "all time". A range of one
 * month (this year, in January) is that month.
 */
export function rangeName(range: TransactionRange, month: MonthKey): string {
	const { fromMonth } = rangeBounds(range, month);
	const year = month.slice(0, 4);
	if (!fromMonth) return "all time";
	if (fromMonth === month) return `${monthName(month)} ${year}`;
	const fromYear = fromMonth.slice(0, 4);
	return `${short(fromMonth)}${fromYear === year ? "" : ` ${fromYear}`} – ${short(month)} ${year}`;
}

/** What the list's total is called: the month's, or the range's, said with its months. */
export function totalLabel(
	range: TransactionRange | undefined,
	month: MonthKey,
	at: { filtered: boolean; current: MonthKey },
): string {
	if (!range) return at.filtered ? "Total for these filters" : `Spent in ${monthName(month)}`;
	const all = month === at.current ? "all time" : `up to ${monthName(month)} ${month.slice(0, 4)}`;
	const name = range === "all" ? all : rangeName(range, month);
	if (at.filtered) return `These filters, ${name}`;
	return range === "all"
		? month === at.current
			? "Spent, all time"
			: `Spent ${all}`
		: `Spent ${name}`;
}

/** The month a row is under in a list of more than a month: "September 2026". */
export const monthHeading = (month: string) => `${monthName(month)} ${month.slice(0, 4)}`;
