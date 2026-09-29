import { type Cents, MAX_CENTS, parseDollars } from "./money";

// Snap and speak: a Parent says or types what they spent ("forty on pizza after hockey") and it
// becomes a Quick Add. A model picks out which words say the amount; the amount itself is read
// here, from those words, to the cent. Speech recognition writes numbers as digits or as words,
// so both are read: "$40", "12.50", "forty", "twelve fifty", "forty dollars and ten cents".

const UNITS: Record<string, number> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
};

const TEENS: Record<string, number> = {
	zero: 0,
	ten: 10,
	eleven: 11,
	twelve: 12,
	thirteen: 13,
	fourteen: 14,
	fifteen: 15,
	sixteen: 16,
	seventeen: 17,
	eighteen: 18,
	nineteen: 19,
};

const TENS: Record<string, number> = {
	twenty: 20,
	thirty: 30,
	forty: 40,
	fifty: 50,
	sixty: 60,
	seventy: 70,
	eighty: 80,
	ninety: 90,
};

const DOLLARS = new Set(["dollar", "dollars", "buck", "bucks"]);
const CENTS = new Set(["cent", "cents"]);
/** Said for a zero before a single digit of cents: "twelve oh five". */
const OH = new Set(["oh", "o", "zero"]);

/** Words as said: lowercase, hyphens and a leading "$" apart, commas in numbers dropped. */
function words(said: string): string[] {
	return said
		.toLowerCase()
		.replace(/(\d),(?=\d{3}\b)/g, "$1")
		.replace(/\$/g, " ")
		.replace(/[-–]/g, " ")
		.replace(/[^a-z0-9.\s]/g, " ")
		.split(/\s+/)
		.map((word) => word.replace(/\.$/, ""))
		.filter(Boolean);
}

/**
 * A whole number said in words or digits ("forty", "a hundred and twenty", "fifteen hundred",
 * "2,000"), or null when the words aren't one number as they'd be said: "twelve fifty" is two.
 */
function wholeNumber(tokens: string[]): number | null {
	if (tokens.length === 0) return null;
	if (tokens.length === 1 && /^\d+$/.test(tokens[0] as string)) return Number(tokens[0]);
	let total = 0;
	let current = 0;
	let last: "none" | "unit" | "teen" | "ten" | "hundred" | "thousand" = "none";
	for (const [i, token] of tokens.entries()) {
		if (token === "a" && i === 0) {
			current = 1;
			last = "unit";
		} else if (token in UNITS) {
			if (last === "unit" || last === "teen") return null;
			current += UNITS[token] as number;
			last = "unit";
		} else if (token in TEENS) {
			if (last !== "none" && last !== "hundred" && last !== "thousand") return null;
			current += TEENS[token] as number;
			last = "teen";
		} else if (token in TENS) {
			if (last !== "none" && last !== "hundred" && last !== "thousand") return null;
			current += TENS[token] as number;
			last = "ten";
		} else if (token === "hundred") {
			if (current < 1 || current > 99 || last === "hundred") return null;
			current *= 100;
			last = "hundred";
		} else if (token === "thousand") {
			if (current < 1 || total > 0) return null;
			total = current * 1000;
			current = 0;
			last = "thousand";
		} else if (token === "and") {
			if (last !== "hundred" && last !== "thousand") return null;
		} else {
			return null;
		}
	}
	if (last === "none" || tokens.at(-1) === "and") return null;
	return total + current;
}

/** Cents said on their own: "fifty", "5", or "oh five" (after a whole number of dollars). */
function centsPart(tokens: string[]): number | null {
	if (tokens.length === 2 && OH.has(tokens[0] as string) && (tokens[1] as string) in UNITS) {
		return UNITS[tokens[1] as string] as number;
	}
	const cents = wholeNumber(tokens);
	return cents !== null && cents < 100 ? cents : null;
}

/** Digits after a spoken "point": "five" is 50 cents, "oh five" 5, "two five" 25. */
function afterPoint(tokens: string[]): number | null {
	const digits = tokens.map((token) =>
		OH.has(token)
			? "0"
			: token in UNITS
				? String(UNITS[token])
				: /^\d{1,2}$/.test(token)
					? token
					: null,
	);
	const joined = digits.every((digit) => digit !== null) ? digits.join("") : "";
	return joined.length >= 1 && joined.length <= 2 ? Number(joined.padEnd(2, "0")) : null;
}

/** Dollars and cents, together, as cents, or null. */
function toCents(dollars: number | null, cents: number | null): Cents | null {
	if (dollars === null || cents === null) return null;
	const total = dollars * 100 + cents;
	return total > 0 && total <= MAX_CENTS ? total : null;
}

/**
 * An amount spent as a Parent said it, in cents: digits ("$40", "12.50", "40 dollars") or words
 * ("forty", "a hundred and twenty", "twelve fifty", "a buck twenty", "forty dollars and ten
 * cents", "fifty cents", "nine point five"). Null for anything else, or nothing spent. Read from
 * the words and digits, never through a float.
 */
export function parseSpokenAmount(said: string): Cents | null {
	const tokens = words(said);
	if (tokens.length === 0) return null;
	// Digits with cents: "12.50", "$12.50", "12.50 dollars".
	const [first, ...rest] = tokens;
	if (/^\d*\.\d+$/.test(first as string) && rest.every((token) => DOLLARS.has(token))) {
		const cents = parseDollars(first as string);
		return cents !== null && cents > 0 ? cents : null;
	}
	const dollarsAt = tokens.findIndex((token) => DOLLARS.has(token));
	const centsAt = tokens.findIndex((token) => CENTS.has(token));
	const pointAt = tokens.indexOf("point");
	if (pointAt > 0) {
		const unit = tokens.slice(pointAt + 1).filter((token) => !DOLLARS.has(token));
		return toCents(wholeNumber(tokens.slice(0, pointAt)), afterPoint(unit));
	}
	if (dollarsAt >= 0) {
		// "forty dollars", "forty dollars and ten cents", "a buck twenty".
		if (centsAt >= 0 && centsAt !== tokens.length - 1) return null;
		let after = tokens.slice(dollarsAt + 1, centsAt >= 0 ? centsAt : undefined);
		if (after[0] === "and") after = after.slice(1);
		const before = tokens.slice(0, dollarsAt);
		const dollars = before.length === 1 && before[0] === "a" ? 1 : wholeNumber(before);
		return toCents(dollars, after.length === 0 ? 0 : centsPart(after));
	}
	if (centsAt >= 0) {
		return centsAt === tokens.length - 1 ? toCents(0, centsPart(tokens.slice(0, centsAt))) : null;
	}
	const whole = wholeNumber(tokens);
	if (whole !== null) return toCents(whole, 0);
	// Dollars then cents, as prices are said: "twelve fifty", "ninety nine ninety nine".
	for (let split = 1; split < tokens.length; split++) {
		const dollars = wholeNumber(tokens.slice(0, split));
		const cents = centsPart(tokens.slice(split));
		if (dollars !== null && cents !== null && (cents >= 10 || tokens.length - split === 2)) {
			return toCents(dollars, cents);
		}
	}
	return null;
}

/**
 * The amount a phrase says was spent: the words a model picked out as the amount (`said`), when
 * they are in the phrase and read as one; else the first run of words in the phrase that does.
 * The model only points at words; the amount is always read here.
 */
export function spokenAmount(phrase: string, said: string | null): Cents | null {
	const tokens = words(phrase);
	const picked = said ? words(said) : [];
	const within =
		picked.length > 0 && tokens.some((_, i) => picked.every((word, j) => tokens[i + j] === word));
	if (within) {
		const cents = parseSpokenAmount(picked.join(" "));
		if (cents !== null) return cents;
	}
	return findSpokenAmount(phrase)?.cents ?? null;
}

/** The first, longest run of words in a phrase that says an amount, and what it comes to. */
export function findSpokenAmount(phrase: string): { said: string; cents: Cents } | null {
	const tokens = words(phrase);
	for (let start = 0; start < tokens.length; start++) {
		for (let end = Math.min(tokens.length, start + 8); end > start; end--) {
			const said = tokens.slice(start, end).join(" ");
			// A run can't start or end on a joining word: "and forty" is "forty".
			if (/^(and|a)$/.test(tokens[end - 1] as string) || tokens[start] === "and") continue;
			const cents = parseSpokenAmount(said);
			if (cents !== null) return { said, cents };
		}
	}
	return null;
}
