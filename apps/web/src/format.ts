function monthDate(key: string): Date {
	const [year, month] = key.split("-").map(Number);
	return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1));
}

/** "September" for a "YYYY-MM" month key. */
export function monthName(key: string): string {
	return monthDate(key).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}

const dollars = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 0,
	maximumFractionDigits: 2,
});

/** "$1,240" or "$1,240.50" (cents only when there are some); negatives use a true minus sign. */
export function formatMoney(cents: number): string {
	const text = dollars.format(Math.abs(cents) / 100).replace(/\.(\d)$/, ".$10");
	return cents < 0 ? `−${text}` : text;
}

/** An amount as a Parent would type it: "1,240" or "1,240.50", no currency sign. */
export function formatMoneyInput(cents: number): string {
	return formatMoney(cents).replace("$", "");
}

/** "Sep 30" for a "YYYY-MM-DD" day key. */
export function shortDay(key: string): string {
	const [year, month, day] = key.split("-").map(Number);
	return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

/** "Sep 30" for a moment (ms since the epoch), on this device's calendar. */
export function shortDayAt(at: number): string {
	return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Jun 15, 2027" for a "YYYY-MM-DD" day key. */
export function fullDay(key: string): string {
	const [year, month, day] = key.split("-").map(Number);
	return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	});
}

/** "Sat, Sep 12" for a "YYYY-MM-DD" day key; "Today" and "Yesterday" relative to `today`. */
export function dayName(key: string, today: string): string {
	const [year, month, day] = key.split("-").map(Number);
	const date = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
	if (key === today) return "Today";
	const [ty, tm, td] = today.split("-").map(Number);
	if (Date.UTC(ty ?? 1970, (tm ?? 1) - 1, (td ?? 1) - 1) === date.getTime()) return "Yesterday";
	return date.toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

/** "Aug 2027" for a "YYYY-MM" month key. */
export { shortMonthName as shortMonth } from "@noodle/domain";
