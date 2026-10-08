// How a typed search finds a choice in a list (issue 154): one function, used by every list with a
// search box (ChoiceList, so Combobox and the app's Bucket picker), so they can't find differently.

/** Lower case, no accents, punctuation as spaces: "Café — Eating-out!" is "cafe eating out". */
export function foldSearch(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[’'`]/g, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/** How well a search fits a name: the lower, the better. */
export const MATCH = { name: 0, word: 1, inside: 2, slip: 3 } as const;

/** A word of this many letters or more forgives one slip of the finger. */
const SLIP_WORD = 5;
/** And only once this much of it is typed: fewer letters fit too many words by chance. */
const SLIP_TYPED = 4;

/** One letter wrong, missing, extra, or two swapped (or nothing wrong at all). */
function withinOneSlip(a: string, b: string): boolean {
	if (Math.abs(a.length - b.length) > 1) return false;
	let at = 0;
	while (at < a.length && at < b.length && a[at] === b[at]) at++;
	const restA = a.slice(at);
	const restB = b.slice(at);
	if (restA === "" || restB === "") return true;
	return (
		restA.slice(1) === restB.slice(1) ||
		restA.slice(1) === restB ||
		restA === restB.slice(1) ||
		(restA.length > 1 &&
			restB.length > 1 &&
			restA[0] === restB[1] &&
			restA[1] === restB[0] &&
			restA.slice(2) === restB.slice(2))
	);
}

/** The typed word is the beginning of `word` but for one slip: "grocr" begins "groceries". */
function beginsWithSlip(word: string, typed: string): boolean {
	if (word.length < SLIP_WORD || typed.length < SLIP_TYPED) return false;
	// The first letter is the one a finger gets right, and keeping it keeps chance matches out.
	if (word[0] !== typed[0]) return false;
	return [typed.length - 1, typed.length, typed.length + 1].some(
		(length) => length <= word.length && withinOneSlip(word.slice(0, length), typed),
	);
}

function fitOne(name: string, typed: string, typedWords: string[]): number | null {
	if (name.startsWith(typed)) return MATCH.name;
	const words = name.split(" ");
	let worst: number = MATCH.word;
	for (const part of typedWords) {
		const fit = words.some((word) => word.startsWith(part))
			? MATCH.word
			: name.includes(part)
				? MATCH.inside
				: words.some((word) => beginsWithSlip(word, part))
					? MATCH.slip
					: null;
		if (fit === null) return null;
		worst = Math.max(worst, fit);
	}
	return worst;
}

/**
 * How well what's typed fits a choice, or null when it doesn't. `names` is the choice's name and
 * any other words it answers to (a Personal Allowance's Parent); the best of them counts.
 *
 * - `MATCH.name`: the name begins with what's typed ("eat" → "Eating out").
 * - `MATCH.word`: each typed word begins one of its words ("out" → "Eating out").
 * - `MATCH.inside`: each typed word is somewhere in it ("ting" → "Eating out").
 * - `MATCH.slip`: as `word`, forgiving one wrong, missing, extra or swapped letter in a word of
 *   five letters or more ("grocries" → "Groceries").
 *
 * Case, accents and punctuation never count. Nothing typed fits everything, as `MATCH.name`.
 */
export function searchFit(names: readonly string[], typed: string): number | null {
	const query = foldSearch(typed);
	if (query === "") return MATCH.name;
	const typedWords = query.split(" ");
	let best: number | null = null;
	for (const name of names) {
		const fit = fitOne(foldSearch(name), query, typedWords);
		if (fit !== null && (best === null || fit < best)) best = fit;
	}
	return best;
}

/**
 * The items a search finds, best fit first; items that fit equally well keep their order. Nothing
 * typed returns them all as they are.
 */
export function searchChoices<T>(
	items: readonly T[],
	typed: string,
	namesOf: (item: T) => readonly string[],
): T[] {
	if (foldSearch(typed) === "") return [...items];
	return items
		.map((item) => ({ item, fit: searchFit(namesOf(item), typed) }))
		.filter((found): found is { item: T; fit: number } => found.fit !== null)
		.sort((a, b) => a.fit - b.fit)
		.map((found) => found.item);
}
