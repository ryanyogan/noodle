/** A calendar month of the Plan, as "YYYY-MM". */
export type MonthKey = `${number}-${number}`;

/** The month an instant falls in for a Household in the given IANA time zone. */
export function monthKeyAt(instant: Date, timeZone: string): MonthKey {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
	}).formatToParts(instant);
	const year = parts.find((p) => p.type === "year")?.value;
	const month = parts.find((p) => p.type === "month")?.value;
	return `${year}-${month}` as MonthKey;
}
