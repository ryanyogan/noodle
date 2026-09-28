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
