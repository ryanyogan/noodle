import { type Cents, type DayKey, monthOfDay } from "@noodle/domain";
import { dayName, formatMoney, shortDay } from "./format";

// A line the bank took back, or changed, after money back on it had counted in a month that has
// ended is kept as it was, so that month doesn't change (issue 141, ADR-0058). It says so.

/** The month a day is in, by name: "October". */
const monthNamed = (day: DayKey) =>
	new Date(`${monthOfDay(day)}-01T12:00:00Z`).toLocaleDateString("en-US", {
		month: "long",
		timeZone: "UTC",
	});

/** The word on the row's badge. */
export const BANK_TOOK_BACK_WORD = "Kept";

/**
 * The sentence on the row's detail; null for a line the bank left alone. The day reads as days do
 * elsewhere ("Today", "Yesterday", "Tue, Oct 6") when the Household's today is given, and as a
 * plain date ("Oct 6") where a row has no today to go by.
 */
export function bankTookBackText(
	line: { date: DayKey; bankTookBackOn?: DayKey | null; bankAmount?: Cents | null },
	today?: string,
): string | null {
	if (!line.bankTookBackOn) return null;
	const named = today ? dayName(line.bankTookBackOn, today) : shortDay(line.bankTookBackOn);
	// Mid-sentence: "on Tue, Oct 6", but "today" and "yesterday" without the "on".
	const on = /^(Today|Yesterday)$/.test(named) ? named.toLowerCase() : `on ${named}`;
	const month = monthNamed(line.date);
	return line.bankAmount === null || line.bankAmount === undefined
		? `The bank took this back ${on}. It stays here so ${month} doesn’t change.`
		: `The bank changed this to ${formatMoney(Math.abs(line.bankAmount) as Cents)} ${on}. It stays as it was so ${month} doesn’t change.`;
}
