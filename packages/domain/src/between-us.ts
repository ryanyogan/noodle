// Money between the two Parents (ADR-0052). A bank line can look like money sent from one person
// to another; that is only ever a reason to OFFER "It's between us", never to mark anything.

const PERSON_TO_PERSON =
	/\b(zelle|venmo|paypal|cash\s?app|apple cash|(?:transfer|xfer|trnsfr)\s+(?:from|to))\b/i;

/** A name's words worth looking for in a bank's wording: three letters or more. */
const nameWords = (names: readonly string[]) =>
	names.flatMap((name) => name.toLowerCase().split(/[^a-z]+/)).filter((word) => word.length >= 3);

/**
 * The bank's wording reads like money sent person to person (Zelle, Venmo, PayPal, Cash App,
 * Apple Cash, "transfer from/to"), or it names one of `names` (the Parents) as a whole word.
 */
export function looksPersonToPerson(
	text: string | null | undefined,
	names: readonly string[] = [],
): boolean {
	if (!text) return false;
	if (PERSON_TO_PERSON.test(text)) return true;
	const words = new Set(text.toLowerCase().split(/[^a-z]+/));
	return nameWords(names).some((word) => words.has(word));
}
