// Merchant names: a statement line's raw text ("COSTCO WHSE #1042 SEATTLE WA") cleaned to the name
// a Parent would say ("Costco"), deterministically. Payment processors' prefixes, bank wording,
// store numbers, phone numbers, card digits, dates and a trailing town and state go; what's left is
// put in title case. Well-known chains are named outright. What it can't settle (`sure: false`)
// goes to the model once per Household (merchant-run.ts, ADR-0027).

import { merchantKey } from "./categorize";

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
	[/^ebay\b/, "eBay"],
	[/^etsy\b/, "Etsy"],
	[/^h ?& ?m\b/, "H&M"],
];

/** Payment processors' and marketplaces' prefixes: "SQ *BLUE BOTTLE", "TST* CHIPOTLE". */
const PROCESSOR = /^(?:sq|tst|sp|pp|py|ckr|in|bt|eb|paypal|pos|gglpay|google|dd)\s?\*\s*/;

/** Banks' wording before the merchant: "POS PURCHASE", "CHECKCARD 0912", "PURCHASE AUTHORIZED ON 09/12". */
const BANK_WORDING =
	/^(?:(?:pos|debit|dbt|visa|ach|card|crd|checkcard|chk ?card|recurring|preauthorized|pre-?auth|purchase|authorized|payment|pymt|on|web|ppd)\b[\s:]*|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+|x*\d{4}\s+)+/;

/**
 * What follows the merchant on an ACH line: "WEB ID: 2005032111", "PPD ID: …", "DES:PAYMENTS
 * ID:… INDN:…" (Bank of America), "TRACE#: …". Everything from there on is reference numbers.
 */
const ACH_TAIL =
	/\s+(?:(?:web|ppd|ccd|tel|arc|pop|co|orig)\s+id|des|id|indn|ref|trace|conf|confirmation|transaction)\s?[:#].*$/;

/** Chase's long ACH layout: "ORIG CO NAME:VERIZON WIRELESS ORIG ID:… DESC DATE:… SEC:WEB …". */
const ORIG_CO_NAME = /^orig co name:\s*(.+?)\s+(?:orig id|desc date|co entry descr|sec)\s?:/;

/** How banks end a line that pays a card or a bill: "ACH PMT", "AUTOPAY", "E-PAYMENT". */
const PAYMENT_WORDS = new Set([
	"pmt",
	"pmts",
	"pymt",
	"payment",
	"payments",
	"autopay",
	"epay",
	"epayment",
	"e-payment",
	"billpay",
	"crcardpmt",
]);

/** Bank wording that ends a line with no meaning of its own: how the money moved. */
const ACH_WORDS = new Set(["ach", "ppd", "ccd", "web"]);

/**
 * Words that only go when a payment word followed them: "ONLINE PMT", "BILL PAYMENT". Not "AUTO":
 * in "ALLY AUTO PAYMENT" it is the lender's name.
 */
const BEFORE_PAYMENT = new Set(["online", "bill", "e", "elec", "electronic", "mobile"]);

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
	"supercenter",
	"supercentre",
	"superstore",
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
	return settle(raw, 40);
}

/** The rules behind cleanMerchant and displayMerchant, cutting the name at `max` characters. */
function settle(raw: string, max: number): CleanMerchant {
	let text = raw.toLowerCase().replace(/\s+/g, " ").trim();
	text = (ORIG_CO_NAME.exec(text)?.[1] ?? text).replace(ACH_TAIL, "").trim();
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
	// "AMERICAN EXPRESS ACH PMT" is a payment to American Express: said so, in plain words.
	// Only the bank's own capitals: a name already written for people ("Auto Loan Payment") stays.
	const shouted = !/[a-z]/.test(raw);
	// "AUTOPAY" stays a word of its own: it's how a card's own payment is told from a bill's
	// (isMoneyMovement).
	let payment = "";
	while (shouted && words.length > 1) {
		const last = words.at(-1) as string;
		if (PAYMENT_WORDS.has(last)) payment = last === "autopay" ? "autopay" : payment || "payment";
		else if (!(ACH_WORDS.has(last) || (payment && BEFORE_PAYMENT.has(last)))) break;
		words.pop();
	}
	while (words.length > 1 && TRAILING.has(words.at(-1) as string)) words.pop();
	words = words
		.map((word) => word.replace(/^[*#-]+|[*#,.-]+$/g, ""))
		.filter(Boolean)
		.map((word) => (word === "crd" ? "card" : word));

	// A short one-word brand stays upper case, as banks write it: "REI".
	const short = words.length === 1 && /^[a-z]{2,3}$/.test(words[0] as string);
	const tail = payment ? ` ${payment}` : "";
	const name = (
		words
			.map((word, i) => (short && !payment ? word.toUpperCase() : titleWord(word, i === 0)))
			.join(" ")
			.slice(0, max - tail.length)
			.trim() + tail
	).trim();
	const sure =
		name.length >= 3 &&
		words.length <= 4 &&
		!/[*\d]/.test(name) &&
		// A squeezed or cut-off word: "MRKTPLC", "WHLSL".
		words.every((word) => word.length <= 4 || /[aeiouy]/.test(word));
	return { name: name || raw.trim().slice(0, max), sure };
}

/**
 * The name a merchant is shown by when nothing better is kept (no clean name yet, ADR-0027): the
 * statement line cleaned by the same rules, uncut ("COSTCO WHSE #1042 SEATTLE WA" shows as
 * "Costco"). A Parent's own words (mixed case, with no processor "*" or store "#") show as typed.
 * Never empty: it falls back to the text itself. Display only; what's stored is unchanged (#51).
 */
export function displayMerchant(raw: string): string {
	const text = raw.replace(/\s+/g, " ").trim();
	if (!text) return raw;
	if (/[a-z]/.test(text) && !/[*#]/.test(text)) return text;
	return settle(text, 80).name || text;
}

/** How Reports group a merchant: by the name it's shown by, ignoring case ("" for no note). */
export const merchantGroup = (raw: string): string =>
	raw.trim() ? displayMerchant(raw).toLowerCase() : "";

/** Payment rails: every line is a different person or shop, so the rail is never one merchant. */
const RAILS = new Set(["Zelle", "Venmo", "PayPal"]);

/**
 * Which merchant a statement line is from, by the bank's wording alone: the key of its cleaned
 * name ("american express payment" whatever reference number the line carries). It never changes
 * when a Parent renames the Transaction, so the name they gave is remembered by it, the other
 * lines from the same merchant are found by it, and Rules still match by it (ADR-0043). A line
 * through Zelle, Venmo or PayPal keeps its whole wording: they are not one merchant.
 */
export function bankMerchantKey(raw: string): string {
	const cleaned = cleanMerchant(raw).name;
	return merchantKey(RAILS.has(cleaned) ? raw : cleaned);
}

/**
 * Every key a Rule may match a line by, best first: its name's (a Parent's, or background AI's),
 * the bank's wording's, and the bank's merchant's. A Rule made before a rename still matches.
 */
export function ruleKeys(line: { merchant?: string | null; note?: string | null }): string[] {
	const note = line.note?.trim() ?? "";
	const named = (line.merchant ?? "").trim() || note;
	const keys = [
		named ? merchantKey(named) : "",
		note ? merchantKey(note) : "",
		note ? bankMerchantKey(note) : "",
	];
	return [...new Set(keys.filter(Boolean))];
}

/** Words a model's answer may share with any line: sharing one says nothing about the merchant. */
const GENERIC = new Set(
	"payment payments autopay pmt ach web id pos purchase debit credit card online the and of store inc llc co".split(
		" ",
	),
);

const nameTokens = (text: string) =>
	text
		.toLowerCase()
		.split(/[^a-z0-9&']+/)
		.filter((token) => token.length >= 2 && !GENERIC.has(token));

/** "mrktplc" in "marketplace": the same first letter, and its letters in order. */
function abbreviates(short: string, long: string): boolean {
	if (short.length < 3 || short[0] !== long[0]) return false;
	let at = 0;
	for (const letter of long) if (letter === short[at]) at++;
	return at === short.length;
}

/**
 * Whether a model's name for a raw statement line can be kept: short, made of words (not a code
 * or a number), free of the bank's reference wording, and sharing a word with the line itself, or
 * spelling out one of its squeezed words ("MRKTPLC" as "Marketplace"). Anything else is the model
 * making a merchant up, and the cleaner's own name is used instead.
 */
export function plausibleMerchantName(raw: string, name: string): boolean {
	const text = name.replace(/\s+/g, " ").trim();
	if (text.length < 2 || text.length > 40) return false;
	const letters = text.replace(/[^a-z]/gi, "").length;
	const digits = text.replace(/\D/g, "").length;
	if (letters < 2 || digits > letters) return false;
	if (/[#*]|\bweb id\b|\bid:|\bach\b/i.test(text)) return false;
	const from = [...nameTokens(raw), ...nameTokens(cleanMerchant(raw).name)];
	return nameTokens(text).some((word) =>
		from.some(
			(token) =>
				token === word || (token.length >= 3 && word.startsWith(token)) || abbreviates(token, word),
		),
	);
}

/** Who a merchant's name came from, strongest first (ADR-0043). */
export type MerchantNameBy = "parent" | "ai" | "cleaner" | "raw";

/**
 * The name a raw statement line goes by: the one a Parent gave its merchant, else the one
 * background AI settled (when it can be kept), else the cleaner's, else the bank's own wording.
 */
export function merchantNameFor(
	raw: string,
	known: { parent?: string | null; ai?: string | null },
): { name: string; by: MerchantNameBy } {
	const parent = known.parent?.trim();
	if (parent) return { name: parent, by: "parent" };
	const ai = known.ai?.replace(/\s+/g, " ").trim();
	if (ai && plausibleMerchantName(raw, ai)) return { name: ai, by: "ai" };
	const cleaned = cleanMerchant(raw).name.trim();
	if (cleaned && cleaned !== raw.trim()) return { name: cleaned, by: "cleaner" };
	return { name: raw.trim(), by: "raw" };
}
