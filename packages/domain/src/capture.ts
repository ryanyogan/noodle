import { type Cents, parseDollars } from "./money";

// Tap to capture: the iPhone Shortcut sends a Wallet payment's merchant and amount the moment a
// Parent pays, and it becomes that Parent's Quick Add. This reads the amount the Shortcut sends.

/**
 * The amount a Wallet payment reports, in cents: a number of dollars, or text as Shortcuts
 * formats it ("$4.25", "4.25 USD", "$1,234.50"). Null for anything else, nothing spent, or a
 * refund (a negative amount), which a Parent records themselves.
 */
export function parseCapturedAmount(input: unknown): Cents | null {
	let dollars: string;
	if (typeof input === "number") {
		if (!Number.isFinite(input)) return null;
		dollars = input.toFixed(2);
	} else if (typeof input === "string") {
		// Currency symbols and codes around the number carry nothing for a US Household.
		dollars = input.trim().replace(/^[^\d.-]+|[^\d.]+$/g, "");
	} else {
		return null;
	}
	const cents = parseDollars(dollars);
	return cents !== null && cents > 0 ? cents : null;
}
