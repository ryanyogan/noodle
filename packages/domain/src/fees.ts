import { looksPersonToPerson } from "./between-us";
import type { Cents } from "./money";
import { looksLikeCardPayment } from "./transfers";

// Fees and interest (issue 137, spec 130 item 6): what a bank or a card charges for itself. It is
// spending, filed in a Bucket named "Fees and interest"; no kind of Transaction of its own. A
// line's wording is only ever a reason to OFFER that Bucket in Review: a Parent confirms, and the
// Rule made then files the rest. Interest a bank pays (money in) is Income, the Household's.

/** The Bucket's name, as Noodle adds it to the Plan. */
export const FEES_AND_INTEREST = "Fees and interest";

/** Interest a card or a loan charges. */
const INTEREST = /\b(interest|finance\s+ch(?:ar)?ge?s?)\b/i;

/**
 * Plainly the bank's own, whoever else the line names: an overdraft, a finance charge, a foreign
 * transaction, a cash machine's or a wire's fee, the month's maintenance or service fee.
 */
const BANKS_OWN =
	/\b(overdraft|nsf|insufficient\s+funds|finance\s+ch(?:ar)?ge?s?|(?:foreign|intl|international|fgn)\s+(?:transaction|trans|txn)|currency\s+conversion|(?:monthly|mthly)\s+(?:maintenance|maint|service|svc|account|acct)\s+(?:fees?|ch(?:ar)?ge?s?))\b|\b(?:atm|wire)\b.*\b(?:fees?|surcharge|ch(?:ar)?ge?s?)\b/i;

/** Card issuers and the card's own words: all that may stand before a card's "ANNUAL FEE". */
const CARD_NAMES =
	"amex|american express|citi|citibank|capital one|discover|barclays|barclaycard|synchrony|chase|wells fargo|bank of america|us bank|credit one(?: bank)?|credit ca?rd|card|cardmember|account|acct";
/** A card's annual fee: "ANNUAL FEE", "ANNUAL MEMBERSHIP FEE", "AMEX ANNUAL MEMBERSHIP FEE". */
const CARDS_ANNUAL_FEE = new RegExp(
	`^\\W*(?:(?:${CARD_NAMES})\\W+)*annual\\s+(?:membership\\s+)?fees?\\b`,
	"i",
);

/** A service fee or charge, which a bank and a merchant both have. */
const SERVICE = /\b(?:service|svc)\s+(?:fees?|ch(?:ar)?ge?s?)\b/i;
/** The words a bank puts before its service charge; anything else before it is a merchant's name. */
const BEFORE_A_BANKS_SERVICE_CHARGE =
	/^(?:account|acct|analysis|maintenance|maint|atm|non|withdrawal|checking|chk|savings|sav|bank|banking|wf|chase|the|total|low|balance|minimum|paper|statement)$/i;

/** A service fee with nothing but a bank's own words before it ("ACCOUNT ANALYSIS SVC CHARGE"). */
function banksServiceCharge(text: string): boolean {
	const at = text.search(SERVICE);
	if (at < 0) return false;
	const before = text.slice(0, at).match(/[a-z0-9]+/gi) ?? [];
	return before.every((word) => /\d/.test(word) || BEFORE_A_BANKS_SERVICE_CHARGE.test(word));
}

/** "FEE" as a word of its own: "COFFEE" and "FEENEY'S" have none. */
const FEE = /\bfees?\b/i;

/** A fee for paying late, or for a payment that came back: it names a payment and isn't one. */
const LATE =
	/\b(?:late|past\s+due|returned\s+(?:item|payment|check))\s+(?:payment\s+)?(?:fees?|penalty|ch(?:ar)?ge?s?)\b/i;

/** Fee words with no "FEE" in them. */
const OTHER_FEE_WORDS = /\b(surcharge|maintenance\s+ch(?:ar)?ge?s?)\b/i;

/**
 * A fee somebody other than the bank charges (a school, a city, a club, a shop): spending of its
 * own kind, with a Bucket of its own. It wins over every fee word but the bank's own.
 */
const SOMEONE_ELSES_FEE =
	/\b(tuition|school|elementary|univ(?:ersity)?|college|activity|lab|exam|registration|enrollment|admission|application|dmv|licen[cs]e|permit|passport|precheck|court|filing|parking|toll|entry|entrance|hoa|delivery|shipping|booking|baggage|bag|resort|cleaning|pet|adoption|convenience|gym|fitness|club|membership|dues|lunch|library|daycare|childcare|camp|league|city|county|town|township|village|municipal|water|sewer|electric|utility|utilities|cable|rent|rental|apartment|storage|tickets?|airlines?|hotel|vet|clinic|dental|medical)\b/i;

/**
 * Money back for a fee, or a correction to one: not a fee. "Credit" is one only where it says the
 * fee was given back ("FEE CREDIT", "INTEREST CREDIT", "COURTESY CREDIT"), never as the product's
 * name ("CREDIT CARD ANNUAL FEE", "CREDIT LINE INTEREST").
 */
const TAKEN_BACK =
	/\b(refund(?:ed)?|reversal|reversed|rebate|waiver|adjustment)\b|\b(?:fees?|interest|ch(?:ar)?ge?s?|courtesy|statement|goodwill)\s+credit\b|\bcredit\s*$/i;

/**
 * Whether a bank line's words say it is a fee or interest the bank or card charged ("MONTHLY
 * SERVICE FEE", "OVERDRAFT FEE", "INTEREST CHARGE ON PURCHASES", "NON-CHASE ATM FEE-WITH", "LATE
 * FEE", "FOREIGN TRANSACTION FEE"). Words are matched whole, so "COFFEE" and "LATE NIGHT DINER"
 * aren't; cash from an ATM isn't its fee; a card payment and a fee's refund aren't either.
 *
 * In this order: money taken back is never a fee; what is plainly the bank's own always is; a fee
 * a school, a city, a gym or a shop charges isn't the bank's ("SCHOOL LUNCH LATE FEE", "CITY WATER
 * SERVICE CHARGE"); a late-payment fee is a fee though it names a payment; a card payment isn't.
 */
export function looksLikeFeeOrInterest(text: string | null | undefined): boolean {
	if (!text || TAKEN_BACK.test(text)) return false;
	if (BANKS_OWN.test(text) || CARDS_ANNUAL_FEE.test(text) || banksServiceCharge(text)) return true;
	if (SOMEONE_ELSES_FEE.test(text) || SERVICE.test(text)) return false;
	if (LATE.test(text)) return true;
	if (looksLikeCardPayment(text)) return false;
	return INTEREST.test(text) || FEE.test(text) || OTHER_FEE_WORDS.test(text);
}

/** Review's offer of the "Fees and interest" Bucket: which of the two the line reads as. */
export type FeesOffer = { what: "fee" | "interest" };

/** Money out that reads as a fee or interest, offered the "Fees and interest" Bucket; else null. */
export function feesOffer(line: {
	text: string | null | undefined;
	amountCents: Cents;
}): FeesOffer | null {
	if (line.amountCents <= 0 || !looksLikeFeeOrInterest(line.text)) return null;
	return { what: INTEREST.test(line.text ?? "") ? "interest" : "fee" };
}

/**
 * The Household's "Fees and interest" Bucket among a Plan's, by name whatever its capitals. Never
 * a Personal Allowance.
 */
export function feesBucketIn<B extends { name: string; owner?: string | null }>(
	buckets: readonly B[],
): B | undefined {
	const name = FEES_AND_INTEREST.toLowerCase();
	return buckets.find((bucket) => !bucket.owner && bucket.name.trim().toLowerCase() === name);
}

/** The words a fee's or interest's wording turns on; what follows them is that one charge's detail. */
const TELLING = /^(fees?|charged?|charges|chg|interest|overdraft|surcharge|nsf|penalty)$/;
/** Telling words that say enough alone. */
const ENOUGH_ALONE = /^(overdraft|surcharge|nsf)$/;

/**
 * The pattern of the Rule made when a Parent confirms a fee or interest, from its merchant (a
 * merchantKey): its words up to the last one that says what it is, so the Rule files the rest of
 * that charge whatever each is for ("overdraft fee for a item details shell oil" gives "overdraft
 * fee"). The whole merchant when that would be one plain word ("fee"), which says too little.
 */
export function feesRulePattern(merchant: string): string {
	const words = merchant.trim().split(/\s+/);
	const last = words.map((word) => TELLING.test(word)).lastIndexOf(true);
	const kept = words.slice(0, last + 1);
	const enough = kept.length > 1 || ENOUGH_ALONE.test(kept[0] ?? "");
	return enough ? kept.join(" ") : merchant.trim();
}

const INTEREST_EARNED =
	/\b(?:interest|int)\s+(?:paid|payment|pymt|earned|credit|deposit)\b|\b(?:apy|annual\s+percentage\s+yield)\s+earned\b|\binterest\b/i;

/**
 * Whether a bank line's words say it is interest the bank paid ("INTEREST PAID", "INT PAID THIS
 * PERIOD", "APY EARNED"). Money back for interest a card charged isn't.
 */
export function looksLikeInterestEarned(text: string | null | undefined): boolean {
	if (!text || TAKEN_BACK.test(text.replace(/\binterest\s+credit\b/i, " "))) return false;
	return INTEREST_EARNED.test(text) && !/\bcharged?\b/i.test(text);
}

/**
 * Interest earned: money in whose wording says a bank paid interest. It is Income without asking,
 * and whose pay it is: the Household's (CONTEXT.md, Income). An Import asks this of each new
 * money-in line no Rule speaks for, before anything else decides its kind (ADR-0057).
 *
 * Not when the wording is person to person ("ZELLE FROM … LOAN INTEREST"): that is somebody
 * paying the Household, which waits in Review like any other money from a person (issue 131).
 */
export function interestEarned(line: {
	text: string | null | undefined;
	amountCents: Cents;
}): { kind: "income"; whosePay: "household" } | null {
	if (line.amountCents >= 0 || !looksLikeInterestEarned(line.text)) return null;
	if (looksPersonToPerson(line.text)) return null;
	return { kind: "income", whosePay: "household" };
}
