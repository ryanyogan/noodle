import { clearPairs, merchantSimilarity } from "./matching";
import type { Cents } from "./money";
import { type DayKey, daysBetween } from "./month";

// Transfers and Refunds.
// A Transfer is money moving between two of the Household's own Accounts: it leaves one (a
// payment out of checking, money out of savings) and arrives in another (money back onto the
// card, a deposit into checking) a few days apart, for the same amount. Neither side counts as
// spending or income. Pairs are found automatically only when it's clear (clearPairs): the same
// amount to the cent, different Accounts, at most four days apart, the nearest pair winning;
// anything less clear is left for a Parent to mark.
// A Refund is money back for an earlier purchase: linked to it, it takes the purchase's
// assignment, so it restores that Bucket (or Commitment, or Goal) in the month it lands.

/** One side of a possible Transfer: money leaving an Account, or arriving in one. */
export type TransferSide = {
	id: string;
	date: DayKey;
	/** The money that moved, positive, on either side. */
	amount: Cents;
	accountId: string;
};

/** How many days apart the two sides of a Transfer may be. */
export const TRANSFER_WINDOW_DAYS = 4;

/**
 * The Transfers to mark automatically between money leaving Accounts (`outs`) and money arriving
 * in them (`ins`): equal amounts in different Accounts within the window, one clear candidate
 * each, the nearest in days. `refused` names pairs a Parent unmarked, never paired again.
 */
export function transferPairs(
	outs: TransferSide[],
	ins: TransferSide[],
	refused: (outId: string, inId: string) => boolean = () => false,
): { outId: string; inId: string }[] {
	return clearPairs(outs, ins, (out, into) => {
		const days = Math.abs(daysBetween(out.date, into.date));
		return out.amount === into.amount &&
			out.amount > 0 &&
			out.accountId !== into.accountId &&
			days <= TRANSFER_WINDOW_DAYS &&
			!refused(out.id, into.id)
			? -days
			: null;
	}).map(([out, into]) => ({ outId: out.id, inId: into.id }));
}

/** Money back, or a purchase it might be a Refund for, as refund linking sees it. */
export type RefundSide = {
	id: string;
	date: DayKey;
	/** Positive: the money back, or the purchase's amount. */
	amount: Cents;
	/** The note or the bank's description. */
	text: string | null;
};

/** How long after a purchase its Refund may land. */
export const REFUND_WINDOW_DAYS = 90;

/**
 * The purchases `refund` might be money back for, most likely first: at least as much, from the
 * 90 days up to its day; those whose text the refund's names first, then the most recent.
 */
export function likelyOriginals(
	refund: RefundSide,
	purchases: RefundSide[],
	limit = 5,
): RefundSide[] {
	return purchases
		.map((purchase) => ({
			purchase,
			days: daysBetween(purchase.date, refund.date),
			similarity: merchantSimilarity(purchase.text, refund.text),
		}))
		.filter(
			({ purchase, days }) =>
				purchase.amount >= refund.amount && days >= 0 && days <= REFUND_WINDOW_DAYS,
		)
		.sort((a, b) => b.similarity - a.similarity || a.days - b.days)
		.slice(0, limit)
		.map(({ purchase }) => purchase);
}

// Card payments, by their words (#91).
// Paying the credit card is a Transfer: what was bought on the card was filed when it was bought,
// so the payment in a Bucket would count it twice. When both sides are imported the pair is found
// by amount and date (transferPairs). When only the checking side is here (the card isn't in
// Noodle, or its side hasn't come in yet), the line's own words are the only evidence. They're
// enough to suggest a Transfer and to keep the line from being filed on its own, never enough to
// mark it without a Parent.

/** Words for paying something: "PAYMENT", "PYMT", "EPAYMENT", "AUTOPAY", "CRCARDPMT". */
const PAYMENT_WORDS =
	/\b(e-?payments?|e-?pay|payments?|pymts?|pmts?|autopay|auto ?pay)\b|crcardpmt|creditcard/i;
/** Words only a credit card's payment has: "CREDIT CRD", "CARD ENDING IN", "CARDMEMBER SERV". */
const CREDIT_CARD_WORDS =
	/\bcredit ?ca?rd\b|\bcrd\b|crcardpmt|creditcard|\bcardmember\b|\bcard (srvc|services?|online|ending|e-?payment|payment|pymt|pmt|autopay)\b|\bbarclaycard\b|\bapple ?card\b/i;
/** Card issuers whose payment lines name only themselves: "AMEX EPAYMENT", "DISCOVER E-PAYMENT". */
const CARD_ISSUERS =
	/\b(amex|american express|citi|citibank|capital one|discover|barclays|synchrony)\b/i;
/** A purchase made with a card, a loan or a bill, or money sent to a person: never a card payment. */
const NOT_A_CARD_PAYMENT =
	/\b(mortgage|mtg|loan|lease|auto finance|carpay|insurance|rent|debit|checkcard|check card|pos|purchases?|gift ?cards?|zelle|venmo|paypal|cash app)\b/i;
/** Words in an Account's name that don't tell one card from another. */
const PLAIN_ACCOUNT_WORDS = new Set([
	"card",
	"cards",
	"credit",
	"bank",
	"account",
	"rewards",
	"cash",
	"the",
	"and",
	"checking",
	"savings",
]);

const wordsOf = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * Whether a bank line's words say it pays a credit card ("CHASE CREDIT CRD AUTOPAY", "AMEX
 * EPAYMENT", "CITI CARD ONLINE PAYMENT"). A bill paid by autopay ("T-MOBILE AUTOPAY") or a loan's
 * payment isn't one.
 */
export function looksLikeCardPayment(text: string | null | undefined): boolean {
	if (!text || NOT_A_CARD_PAYMENT.test(text) || !PAYMENT_WORDS.test(text)) return false;
	return CREDIT_CARD_WORDS.test(text) || CARD_ISSUERS.test(text);
}

/**
 * Money out that is likely a payment to a credit card, and the card when the line's words name
 * exactly one of the Household's (`cards`, by their names): null when it isn't likely. A line that
 * only says "ONLINE PAYMENT" counts when it names one of those cards ("VISA ONLINE PAYMENT").
 */
export function likelyCardPayment(
	line: { text: string | null | undefined; amountCents: Cents },
	cards: { name: string }[] = [],
): { card: string | null } | null {
	const text = line.text ?? "";
	if (line.amountCents <= 0 || NOT_A_CARD_PAYMENT.test(text) || !PAYMENT_WORDS.test(text)) {
		return null;
	}
	const said = new Set(wordsOf(text));
	const scored = cards
		.map((card) => ({
			name: card.name,
			score: wordsOf(card.name).filter(
				(word) => word.length >= 3 && !PLAIN_ACCOUNT_WORDS.has(word) && said.has(word),
			).length,
		}))
		.filter((card) => card.score > 0)
		.sort((a, b) => b.score - a.score);
	const [best, next] = scored;
	const named = best && (!next || next.score < best.score) ? best.name : null;
	if (named) return { card: named };
	// Two of the Household's cards fit equally, or none does: likely only by its own words.
	return scored.length > 0 || looksLikeCardPayment(text) ? { card: null } : null;
}
