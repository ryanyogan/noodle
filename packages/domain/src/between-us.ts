// Money between the two Parents (ADR-0052). A bank line can look like money sent from one person
// to another; that is only ever a reason to OFFER "It's between us", never to mark anything.

const PERSON_TO_PERSON =
	/\b(zelle|venmo|paypal|cash\s?app|apple cash|(?:transfer|xfer|trnsfr)\s+(?:from|to))\b/i;

/** A name's words worth looking for in a bank's wording: three letters or more. */
const nameWords = (names: readonly string[]) =>
	names.flatMap((name) => name.toLowerCase().split(/[^a-z]+/)).filter((word) => word.length >= 3);

// A paycheck or a refund from the taxman often carries the Parent's own name: never a hint.
const NOT_BETWEEN_US =
	/\b(payroll|paycheck|salary|direct\s?dep(?:osit)?|dir\s?dep|irs|treas|tax\s?ref(?:und)?|ssa|pension)\b/i;

/**
 * The Parent (one of `names`, as given) a bank's wording names as a whole word: "ZELLE TO SAM RINK"
 * names "Sam Rink". Null when it names none, when the word is a shop's ("SAM'S CLUB"), or when the
 * line reads as pay ("ACME PAYROLL SAM RINK").
 */
export function parentNamedIn(
	text: string | null | undefined,
	names: readonly string[] = [],
): string | null {
	if (!text || NOT_BETWEEN_US.test(text)) return null;
	// A possessive is a shop's name, not a person's.
	const words = new Set(
		text
			.toLowerCase()
			.replace(/[a-z]+['’]s\b/g, " ")
			.split(/[^a-z]+/),
	);
	return names.find((name) => nameWords([name]).some((word) => words.has(word))) ?? null;
}

/**
 * The bank's wording reads like money sent person to person (Zelle, Venmo, PayPal, Cash App,
 * Apple Cash, "transfer from/to"), or it names one of `names` (the Parents) as a whole word.
 */
export function looksPersonToPerson(
	text: string | null | undefined,
	names: readonly string[] = [],
): boolean {
	if (!text) return false;
	return PERSON_TO_PERSON.test(text) || parentNamedIn(text, names) !== null;
}
