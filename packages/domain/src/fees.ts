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

/** Words that are a bank's fee whatever stands beside them. */
const ALWAYS_A_FEE =
	/\b(overdraft|nsf|insufficient\s+funds|surcharge|(?:service|svc|late|returned\s+(?:item|payment|check))\s+ch(?:ar)?ge?s?|late\s+(?:payment\s+)?(?:fees?|penalty)|(?:foreign|intl|international|fgn)\s+(?:transaction|trans|txn)|currency\s+conversion)\b/i;

/** "FEE" as a word of its own: "COFFEE" and "FEENEY'S" have none. */
const FEE = /\bfees?\b/i;

/**
 * A fee somebody other than the bank charges (a school, a city, a club, a shop): spending of its
 * own kind, with a Bucket of its own.
 */
const SOMEONE_ELSES_FEE =
	/\b(tuition|school|elementary|univ(?:ersity)?|college|activity|lab|exam|registration|enrollment|admission|application|dmv|licen[cs]e|permit|passport|precheck|court|filing|parking|toll|entry|entrance|hoa|delivery|shipping|booking|baggage|bag|resort|cleaning|pet|adoption|convenience)\b/i;

/** Money back for a fee, or a correction to one: not a fee. */
const TAKEN_BACK = /\b(refund(?:ed)?|reversal|reversed|rebate|waiver|adjustment|credit)\b/i;

/**
 * Whether a bank line's words say it is a fee or interest the bank or card charged ("MONTHLY
 * SERVICE FEE", "OVERDRAFT FEE", "INTEREST CHARGE ON PURCHASES", "NON-CHASE ATM FEE-WITH", "LATE
 * FEE", "FOREIGN TRANSACTION FEE"). Words are matched whole, so "COFFEE" and "LATE NIGHT DINER"
 * aren't; cash from an ATM isn't its fee; a fee a school or a city charges isn't the bank's; a
 * card payment and a fee's refund aren't either.
 */
export function looksLikeFeeOrInterest(text: string | null | undefined): boolean {
	if (!text || TAKEN_BACK.test(text) || looksLikeCardPayment(text)) return false;
	if (INTEREST.test(text) || ALWAYS_A_FEE.test(text)) return true;
	return FEE.test(text) && !SOMEONE_ELSES_FEE.test(text);
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
 * Interest earned: money in whose wording says a bank paid interest. It is Income, and whose pay
 * it is: the Household's (CONTEXT.md, Income).
 *
 * SEAM for issue 133 ("whose pay"): money in is Income today without this being asked, so nothing
 * calls it yet. When money in gets its kind (ADR-0057) and Income its "whose pay", the code that
 * decides them for a new money-in line should ask this first: a non-null answer is Income without
 * asking, with whose pay set to the Household.
 */
export function interestEarned(line: {
	text: string | null | undefined;
	amountCents: Cents;
}): { kind: "income"; whosePay: "household" } | null {
	if (line.amountCents >= 0 || !looksLikeInterestEarned(line.text)) return null;
	return { kind: "income", whosePay: "household" };
}
