// A new Bucket made from a Bucket picker's search (#90): when the Create row shows, what the name
// must be, and the allowance suggested for it.

/** The longest a Bucket's name can be, as the Plan's forms and the server hold it. */
export const BUCKET_NAME_MAX = 40;

/** A typed name as it's kept: no space at either end, and one space between words. */
export const tidyName = (typed: string) => typed.trim().replace(/\s+/g, " ");

const fold = (text: string) => tidyName(text).toLocaleLowerCase("en-US");

/** True when two names are the same to a Parent: "gas " is "Gas". */
export const sameName = (a: string, b: string) => fold(a) === fold(b);

/** Whether a picker's choice stays in the list for what's typed: every typed word is in its name. */
export function matchesSearch(name: string, typed: string): boolean {
	const text = fold(name);
	return fold(typed)
		.split(" ")
		.every((word) => text.includes(word));
}

/**
 * The name the picker's last row offers to create, "Create Bucket “Vet”", or null for no row.
 * It shows when something is typed and nothing the picker lists has exactly that name (whatever
 * its capitals or the spaces around it), so also under choices that only partly match. A name too
 * long for a Bucket gets no row.
 */
export function nameToCreate(typed: string, names: readonly string[]): string | null {
	const name = tidyName(typed);
	if (name === "" || name.length > BUCKET_NAME_MAX) return null;
	return names.some((taken) => sameName(taken, name)) ? null : name;
}

/** What's wrong with a new Bucket's name, in words for the form, or null when it can be used. */
export function nameProblem(typed: string, names: readonly string[]): string | null {
	const name = tidyName(typed);
	if (name === "") return "Give the Bucket a name.";
	if (name.length > BUCKET_NAME_MAX) return `Keep the name to ${BUCKET_NAME_MAX} letters or fewer.`;
	const taken = names.find((other) => sameName(other, name));
	return taken ? `Your Plan already has “${taken}”. Pick another name.` : null;
}

/**
 * The allowance suggested for a Bucket made to file one Transaction: its amount rounded up to the
 * next $5 ($19.99 → $20, $40 → $40, $123.45 → $125), so the Bucket isn't over the moment it's
 * filed. Null (the field starts empty) when the Transaction has no amount to go by.
 */
export function suggestedAllowanceCents(amountCents: number): number | null {
	const spent = Math.abs(amountCents);
	if (spent === 0) return null;
	return Math.ceil(spent / 500) * 500;
}
