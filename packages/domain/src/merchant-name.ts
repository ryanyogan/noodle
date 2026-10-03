// Merchant names: a statement line's raw text ("COSTCO WHSE #1042 SEATTLE WA") cleaned to the name
// a Parent would say ("Costco"), deterministically. Payment processors' prefixes, bank wording,
// store numbers, phone numbers, card digits, dates and a trailing town and state go; what's left is
// put in title case. Well-known chains are named outright. What it can't settle (`sure: false`)
// goes to the model once per Household (merchant-run.ts, ADR-0027).

/** A cleaned merchant name, and whether the rules settled it alone. */
export type CleanMerchant = { name: string; sure: boolean };

/** Well-known merchants by how their statement lines start, after prefixes are gone. */
const KNOWN: [RegExp, string][] = [
	[/^(?:amazon prime|prime video|amzn prime)\b/, "Amazon Prime"],
	[/^(?:amzn|amazon)\b/, "Amazon"],
	[/^(?:wm supercenter|wal-?mart|walmart)\b/, "Walmart"],
	[/^(?:wholefds|whole foods)\b/, "Whole Foods"],
	[/^trader joe/, "Trader Joe's"],
	[/^costco\b/, "Costco"],
	[/^target\b/, "Target"],
	[/^mcdonald/, "McDonald's"],
	[/^starbucks\b/, "Starbucks"],
	[/^netflix\b/, "Netflix"],
	[/^spotify\b/, "Spotify"],
	[/^planet fitness\b/, "Planet Fitness"],
	[/^uber\s*\*?\s*eats\b/, "Uber Eats"],
	[/^uber\b/, "Uber"],
	[/^lyft\b/, "Lyft"],
	[/^(?:doordash|dd \*?doordash)\b/, "DoorDash"],
	[/^shell\b/, "Shell"],
	[/^chevron\b/, "Chevron"],
	[/^exxon/, "ExxonMobil"],
	[/^cvs\b/, "CVS"],
	[/^walgreens\b/, "Walgreens"],
	[/^kroger\b/, "Kroger"],
	[/^safeway\b/, "Safeway"],
	[/^(?:the )?home depot\b/, "The Home Depot"],
	[/^lowe'?s\b/, "Lowe's"],
	[/^chick-?fil-?a\b/, "Chick-fil-A"],
	[/^(?:apple\.com|apl\s?\*|apple)\b/, "Apple"],
	[/^google\b/, "Google"],
	[/^hulu\b/, "Hulu"],
	[/^disney\s?(?:plus|\+)/, "Disney+"],
	[/^venmo\b/, "Venmo"],
	[/^zelle\b/, "Zelle"],
	[/^7[- ]?eleven\b/, "7-Eleven"],
	[/^in-n-out\b/, "In-N-Out Burger"],
	[/^(?:h-e-b|heb)\b/, "H-E-B"],
	[/^sam'?s ?club\b/, "Sam's Club"],
	[/^best ?buy\b/, "Best Buy"],
	[/^chipotle\b/, "Chipotle"],
	[/^dunkin\b/, "Dunkin'"],
	[/^panera\b/, "Panera Bread"],
	[/^(?:comcast|xfinity)\b/, "Xfinity"],
	[/^verizon\b/, "Verizon"],
	[/^t-?mobile\b/, "T-Mobile"],
	[/^(?:at&t|att\s?\*)/, "AT&T"],
	[/^ikea\b/, "IKEA"],
	[/^paypal\b/, "PayPal"],
];

/** Payment processors' and marketplaces' prefixes: "SQ *BLUE BOTTLE", "TST* CHIPOTLE". */
const PROCESSOR = /^(?:sq|tst|sp|pp|py|ckr|in|bt|eb|paypal|pos|gglpay|google|dd)\s?\*\s*/;

/** Banks' wording before the merchant: "POS PURCHASE", "CHECKCARD 0912", "PURCHASE AUTHORIZED ON 09/12". */
const BANK_WORDING =
	/^(?:(?:pos|debit|dbt|visa|ach|card|crd|checkcard|chk ?card|recurring|preauthorized|pre-?auth|purchase|authorized|payment|pymt|on|web|ppd)\b[\s:]*|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+|x*\d{4}\s+)+/;

const PHONE = /\(?\b\d{3}\)?[-. ]?\d{3}[-. ]\d{4}\b|\b1-8\d\d-\S+/g;

const US_STATES = new Set(
	"al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc".split(
		" ",
	),
);

/** First words of two-word towns, dropped with the town: "SAN FRANCISCO CA". */
const TOWN_LEADS = new Set([
	"san",
	"santa",
	"los",
	"las",
	"new",
	"st",
	"saint",
	"fort",
	"ft",
	"el",
	"palo",
	"salt",
	"west",
	"east",
	"north",
	"south",
]);

/** Words a store number follows, or that end a name as noise: "WHSE 1042", "STORE 88", "LLC". */
const TRAILING = new Set([
	"whse",
	"store",
	"str",
	"ste",
	"no",
	"unit",
	"loc",
	"llc",
	"inc",
	"co",
	"corp",
	"ltd",
	"#",
	"-",
]);

const SMALL = new Set(["of", "and", "the", "at", "on", "in", "for", "a"]);

/** A word put in title case; a short one with no vowel stays upper case ("BBQ", "KFC"). */
function titleWord(word: string, first: boolean): string {
	if (!first && SMALL.has(word)) return word;
	if (word.length <= 4 && !/[aeiouy]/.test(word)) return word.toUpperCase();
	return word
		.split(/([-'])/)
		.map((part, i, parts) =>
			// "joe's", not "Joe'S".
			parts[i - 1] === "'" && part.length <= 2
				? part
				: part.charAt(0).toUpperCase() + part.slice(1),
		)
		.join("");
}

/** Cleans a statement line's raw text to its merchant's name (see the top of this file). */
export function cleanMerchant(raw: string): CleanMerchant {
	let text = raw.toLowerCase().replace(/\s+/g, " ").trim();
	for (let i = 0; i < 3; i++) {
		const before = text;
		text = text.replace(BANK_WORDING, "").replace(PROCESSOR, "").trim();
		if (text === before) break;
	}
	for (const [pattern, name] of KNOWN) if (pattern.test(text)) return { name, sure: true };

	text = text.replace(PHONE, " ").replace(/\s+/g, " ").trim();
	let words = text.split(" ").filter(Boolean);
	// Everything from the first word with a digit or "#" on: store numbers, then the town and state.
	const cut = words.findIndex((word, i) => i > 0 && /[\d#]/.test(word));
	if (cut > 0) words = words.slice(0, cut);
	// A trailing state, its town, and a two-word town's first word.
	// "CO" closes a company's name far more often than it is Colorado: "RIVER GAS CO".
	if (words.length > 2 && words.at(-1) !== "co" && US_STATES.has(words.at(-1) as string)) {
		words.pop();
		if (words.length > 1) words.pop();
		if (words.length > 1 && TOWN_LEADS.has(words.at(-1) as string)) words.pop();
	}
	while (words.length > 1 && TRAILING.has(words.at(-1) as string)) words.pop();
	words = words.map((word) => word.replace(/^[*#-]+|[*#,.-]+$/g, "")).filter(Boolean);

	// A short one-word brand stays upper case, as banks write it: "REI".
	const short = words.length === 1 && /^[a-z]{2,3}$/.test(words[0] as string);
	const name = words
		.map((word, i) => (short ? word.toUpperCase() : titleWord(word, i === 0)))
		.join(" ")
		.slice(0, 40)
		.trim();
	const sure =
		name.length >= 3 &&
		words.length <= 4 &&
		!/[*\d]/.test(name) &&
		// A squeezed or cut-off word: "MRKTPLC", "WHLSL".
		words.every((word) => word.length <= 4 || /[aeiouy]/.test(word));
	return { name: name || raw.trim().slice(0, 40), sure };
}
