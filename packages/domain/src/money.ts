/** An amount of US dollars as a whole number of cents. Money is never a float. */
export type Cents = number;

/** The largest amount the Plan accepts anywhere: $10,000,000. */
export const MAX_CENTS: Cents = 1_000_000_000;

/**
 * Reads an amount a Parent typed ("1,240", "$85.5", "12.99") as cents. Returns null for
 * anything that isn't a plain non-negative dollar amount with at most two decimals, or is
 * above MAX_CENTS. Parsed from the digits, so "0.29" is exactly 29 cents.
 */
export function parseDollars(input: string): Cents | null {
	const cleaned = input
		.trim()
		.replace(/^\$\s*/, "")
		.replaceAll(",", "");
	const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
	if (!match || cleaned === "" || cleaned === ".") return null;
	const dollars = Number(match[1] || "0");
	const cents = Number((match[2] ?? "").padEnd(2, "0"));
	const total = dollars * 100 + cents;
	return total <= MAX_CENTS ? total : null;
}
