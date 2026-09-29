/** A calendar month of the Plan, as "YYYY-MM". */
export type MonthKey = `${number}-${number}`;

/** A calendar day, as "YYYY-MM-DD". */
export type DayKey = `${number}-${number}-${number}`;

function partsAt(instant: Date, timeZone: string) {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(instant);
	const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
	return { year: part("year"), month: part("month"), day: part("day") };
}

/** The month an instant falls in for a Household in the given IANA time zone. */
export function monthKeyAt(instant: Date, timeZone: string): MonthKey {
	const { year, month } = partsAt(instant, timeZone);
	return `${year}-${month}` as MonthKey;
}

/** The day an instant falls on for a Household in the given IANA time zone. */
export function dayKeyAt(instant: Date, timeZone: string): DayKey {
	const { year, month, day } = partsAt(instant, timeZone);
	return `${year}-${month}-${day}` as DayKey;
}

/** The month a day belongs to. */
export function monthOfDay(day: DayKey): MonthKey {
	return day.slice(0, 7) as MonthKey;
}

/** Whole months from `from` to `to`: 1 from one month to the next, negative going back. */
export function monthsBetween(from: MonthKey, to: MonthKey): number {
	const [fromYear, fromMonth] = from.split("-").map(Number);
	const [toYear, toMonth] = to.split("-").map(Number);
	return ((toYear ?? 0) - (fromYear ?? 0)) * 12 + ((toMonth ?? 0) - (fromMonth ?? 0));
}

const utcOf = (day: DayKey) => {
	const [year, month, date] = day.split("-").map(Number);
	return Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1);
};

/** Whole days from `from` to `to`: 1 from one day to the next, negative going back. */
export function daysBetween(from: DayKey, to: DayKey): number {
	return Math.round((utcOf(to) - utcOf(from)) / 86_400_000);
}

/** The day `days` after `day` (before it, when negative). */
export function addDays(day: DayKey, days: number): DayKey {
	return new Date(utcOf(day) + days * 86_400_000).toISOString().slice(0, 10) as DayKey;
}

/** The month `months` after `month` (before it, when negative). */
export function addMonths(month: MonthKey, months: number): MonthKey {
	const [year = 1970, m = 1] = month.split("-").map(Number);
	const index = year * 12 + (m - 1) + months;
	return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}` as MonthKey;
}

/** 28–31, accounting for leap years. */
export function daysInMonth(month: MonthKey): number {
	const [year, m] = month.split("-").map(Number);
	// Day 0 of the next month is the last day of this one.
	return new Date(Date.UTC(year ?? 1970, m ?? 1, 0)).getUTCDate();
}

/** The last day of a month. */
export function lastDayOf(month: MonthKey): DayKey {
	return `${month}-${String(daysInMonth(month)).padStart(2, "0")}` as DayKey;
}

/**
 * How many days of `month` have passed by the end of `asOf`, counting `asOf` itself:
 * 0 before the month starts, every day once it has ended.
 */
export function daysElapsed(month: MonthKey, asOf: DayKey): number {
	const days = daysInMonth(month);
	const asOfMonth = monthOfDay(asOf);
	if (asOfMonth < month) return 0;
	if (asOfMonth > month) return days;
	return Math.min(days, Number(asOf.slice(8, 10)));
}
