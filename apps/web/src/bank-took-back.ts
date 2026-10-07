import { type Cents, type DayKey, type MonthKey, monthOfDay } from "@noodle/domain";
import { dayName, formatMoney, shortDay } from "./format";

// A line the bank took back, or changed, after money back on it had counted in a month that has
// ended is kept as it was, so that month doesn't change (issue 141, ADR-0058). It says so.

/** A month by name: "October". */
const monthNamed = (month: MonthKey) =>
	new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", {
		month: "long",
		timeZone: "UTC",
	});

/**
 * The months a kept line leaves unchanged, as the sentence ends: the line's own and those its
 * money back counted in (`restored`), each once, oldest first. "September doesn’t change",
 * "September and October don’t change", "August, September and October don’t change".
 */
function monthsUnchanged(own: MonthKey, restored: readonly MonthKey[]) {
	const names = [...new Set([own, ...restored])].sort().map(monthNamed);
	if (names.length === 1) return `${names[0]} doesn’t change`;
	return `${names.slice(0, -1).join(", ")} and ${names.at(-1)} don’t change`;
}

/** The word on the row's badge. */
export const BANK_TOOK_BACK_WORD = "Kept";

/**
 * The sentence on the row's detail; null for a line the bank left alone. The day reads as days do
 * elsewhere ("Today", "Yesterday", "Tue, Oct 6") when the Household's today is given, and as a
 * plain date ("Oct 6") where a row has no today to go by. `restored` is the months its money
 * back counted in (loadRestoreMonths), which can be later than the line's own: a September
 * purchase refunded in October is kept so that neither month changes.
 */
export function bankTookBackText(
	line: { date: DayKey; bankTookBackOn?: DayKey | null; bankAmount?: Cents | null },
	today?: string,
	restored: readonly MonthKey[] = [],
): string | null {
	if (!line.bankTookBackOn) return null;
	const named = today ? dayName(line.bankTookBackOn, today) : shortDay(line.bankTookBackOn);
	// Mid-sentence: "on Tue, Oct 6", but "today" and "yesterday" without the "on".
	const on = /^(Today|Yesterday)$/.test(named) ? named.toLowerCase() : `on ${named}`;
	const unchanged = monthsUnchanged(monthOfDay(line.date), restored);
	return line.bankAmount === null || line.bankAmount === undefined
		? `The bank took this back ${on}. It stays here so ${unchanged}.`
		: `The bank changed this to ${formatMoney(Math.abs(line.bankAmount) as Cents)} ${on}. It stays as it was so ${unchanged}.`;
}
