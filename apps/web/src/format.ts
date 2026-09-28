/** "September 2026" for a "YYYY-MM" month key. */
export function monthLabel(key: string): string {
	const [year, month] = key.split("-").map(Number);
	return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1)).toLocaleDateString("en-US", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	});
}
