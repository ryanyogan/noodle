function monthDate(key: string): Date {
	const [year, month] = key.split("-").map(Number);
	return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1));
}

/** "September" for a "YYYY-MM" month key. */
export function monthName(key: string): string {
	return monthDate(key).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}
