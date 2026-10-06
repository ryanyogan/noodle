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
	/\b(e-?payments?|e-?pay|payments?|pymts?|pmts?|autopay|auto ?pay)\b|crcardpmt|ccpymt|creditcard/i;
/** Words only a credit card's payment has: "CREDIT CRD", "CARD ENDING IN", "CARDMEMBER SERV". */
const CREDIT_CARD_WORDS =
	/\bcredit ?ca?rd\b|\bcrd\b|crcardpmt|creditcard|ccpymt|\bcardmember\b|\bcard (srvc|serv|services?|online|ending|e-?payment|payment|pymt|pmt|autopay)\b|\bbarclaycard\b|\bapple ?card\b/i;
/** Card issuers whose payment lines name only themselves: "AMEX EPAYMENT", "DISCOVER E-PAYMENT". */
const CARD_ISSUERS =
	/\b(amex|american express|citi|citibank|capital one|discover|barclays|synchrony)\b/i;
/**
 * Banks that issue cards and also keep checking Accounts, lend on cars and hold mortgages: their
 * name alone says nothing, so a line naming one is a card's payment only with BANK_CARD_WORDS.
 */
const BANKS_WITH_CARDS =
	/\b(jpmorgan|chase|wells fargo|wf|bank of america|bk of amer(ica)?|bofa|us ?bank|u\.s\. bank)\b/i;
/** What such a bank's line says when it's the card being paid: the card, its network, or an e-payment. */
const BANK_CARD_WORDS =
	/\b(cards?|cc|visa|mastercard|mc|e-?payments?|e-?pay|ccpymt|online (pmt|pymt|payment))\b/i;
/** A purchase made with a card, a loan or a bill, or money sent to a person: never a card payment. */
const NOT_A_CARD_PAYMENT =
	/\b(mortgage|mtg|loan|lease|auto (finance|fin)|dealer|heloc|home equity|carpay|insurance|rent|debit|checkcard|check card|pos|purchases?|gift ?cards?|zelle|venmo|paypal|cash app)\b/i;
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
	"loan",
	"loans",
	"payment",
	"payments",
]);

/** A line's or a name's words, with an issuer's short names spelled out ("AMEX" is American Express). */
const wordsOf = (text: string) =>
	text
		.toLowerCase()
		.replace(/\bamex\b/g, "american express")
		.replace(/\bcitibank\b/g, "citi")
		.match(/[a-z0-9]+/g) ?? [];

/**
 * Whether a bank line's words say it pays a credit card ("CHASE CREDIT CRD AUTOPAY", "AMEX
 * EPAYMENT", "CITI CARD ONLINE PAYMENT"). A bill paid by autopay ("T-MOBILE AUTOPAY") or a loan's
 * payment isn't one.
 */
export function looksLikeCardPayment(text: string | null | undefined): boolean {
	if (!text || NOT_A_CARD_PAYMENT.test(text) || !PAYMENT_WORDS.test(text)) return false;
	return (
		CREDIT_CARD_WORDS.test(text) ||
		CARD_ISSUERS.test(text) ||
		(BANKS_WITH_CARDS.test(text) && BANK_CARD_WORDS.test(text))
	);
}

// The card's side of a payment, by its words (issue 136).
// Money arriving on a card is a refund, a credit, a reward, or the Household paying the card. Only
// the last is a Transfer, and the card's bank says so in a handful of set phrases ("PAYMENT THANK
// YOU", "AUTOPAY PAYMENT - THANK YOU", "CAPITAL ONE MOBILE PYMT"). A line that reads that way is a
// Transfer whether or not the paying Account's side is in Noodle; anything else stays money back.

/** A payment, as a card's own statement words it. */
const RECEIVED_PAYMENT_WORDS = /\b(e-?payments?|payments?|pymts?|pmts?|autopay|directpay)\b/i;
/** What says the payment is the cardholder's: thanks, how it was made, or where it came from. */
const RECEIVED_HOW =
	/\bthank(s| you)?\b|\b(received|autopay|auto|automatic|online|mobile|internet|electronic|web|ach|e-?payments?|directpay|pymts?|full balance)\b|\bfrom (chk|checking|sav|savings|account|acct)\b/i;
/** A line that is nothing but the word: "Payment", "Credit Card Payment". */
const ONLY_PAYMENT = /^\W*(credit ca?rd )?payments?\W*$/i;
/** Apple Card's wording, which never says payment. */
const TRANSFER_FROM_ACCOUNT =
	/\b(internet|online) transfer from (account|acct|checking|chk|savings)\b/i;
/** Money back that isn't a payment, and a payment that came back: never the card's side of one. */
const NOT_A_PAYMENT_RECEIVED =
	/\b(refunds?|returns?|returned|reversals?|reversed|rewards?|cash ?back|redemptions?|disputes?|disputed|adjustments?|fees?|interest|bonus|protection|provisional|credits?(?! ca?rd))\b/i;

/**
 * Whether a line arriving on a card reads as the Household paying that card ("PAYMENT THANK YOU",
 * "ONLINE PAYMENT - THANK YOU", "Payment Received"). A refund, a statement credit, a reward or
 * cashback doesn't, and neither does a merchant whose name only has the word in it.
 */
export function readsAsPaymentReceived(text: string | null | undefined): boolean {
	if (!text || NOT_A_PAYMENT_RECEIVED.test(text)) return false;
	if (TRANSFER_FROM_ACCOUNT.test(text) || ONLY_PAYMENT.test(text)) return true;
	return RECEIVED_PAYMENT_WORDS.test(text) && RECEIVED_HOW.test(text);
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

// Review's one decision tree for money out that reads as a payment to a card or loan (ADR-0050).
// Decided when Review is read, from the bank's own wording, the Household's cards and loans and
// the Commitments that pay them down; nothing is stored.
//   commitment:   a Commitment pays down the card or loan the line fits: file it there.
//   followed:     the line names a card Noodle follows: a Transfer, since what was bought on it
//                 is already in the Buckets.
//   not-followed: a card payment to a card Noodle can't see into, with no Commitment for it: the
//                 payment is the spending, so plan it as a Commitment, or connect the card.

/** A credit card or loan of the Household's, as the tree reads it. */
export type PaymentAccount = {
	id: string;
	name: string;
	kind: "credit-card" | "loan";
	/** Noodle sees what's bought on it: connected, or with purchases imported lately. */
	followed: boolean;
};

/** A Commitment that pays down a card or loan. */
export type PayingCommitment = {
	id: string;
	name: string;
	accountId: string;
	amountCents: Cents;
	/** A set payment on a balance being carried: what lets it pay down a card Noodle follows. */
	carriedBalance: boolean;
};

export type PaymentCase =
	| {
			kind: "commitment";
			commitmentId: string;
			commitment: string;
			accountId: string;
			account: string;
	  }
	| { kind: "followed"; card: string | null }
	| { kind: "not-followed"; card: string | null; accountId: string | null };

/** Money sent to a person, a purchase, or a bill that is never a card's or a loan's payment. */
const NOT_A_PAYMENT =
	/\b(insurance|rent|debit|checkcard|check card|pos|purchases?|gift ?cards?|zelle|venmo|paypal|cash app)\b/i;
/** Words a loan's payment line has: "MORTGAGE", "STUDENT LN", "TOYOTA FINANCIAL", "LOAN SERVICING". */
const LOAN_WORDS =
	/\b(mortgage|mtg|loans?|ln|lease|financial|finance|financing|servicing|lending|lender)\b/i;
/** Words only a loan's line has: enough, alone, to take it for the one loan a Commitment pays down. */
const SURE_LOAN_WORDS = /\b(mortgage|mtg|loans?|ln|lease|servicing|lending|lender)\b/i;
/** Words in a loan's name that many loans share: they fit a line only when it reads as a loan's. */
const SHARED_LOAN_WORDS = new Set(["car", "auto", "home", "house", "student", "mortgage"]);
/** Issuers a payment line may name: one the line names and the Account's name doesn't isn't it. */
const ISSUER_NAMES = [
	"american express",
	"citi",
	"capital one",
	"discover",
	"barclays",
	"barclaycard",
	"synchrony",
	"chase",
	"wells fargo",
	"bank of america",
	"apple",
	"us bank",
	"usaa",
	"navy federal",
];

const issuersIn = (text: string) => {
	const padded = ` ${wordsOf(text).join(" ")} `;
	return ISSUER_NAMES.filter((issuer) => padded.includes(` ${issuer} `));
};

/** How many of an Account's telling words the line has. */
function wordsFit(account: PaymentAccount, said: Set<string>, loanLine: boolean): number {
	return wordsOf(account.name).filter(
		(word) =>
			word.length >= 3 &&
			!PLAIN_ACCOUNT_WORDS.has(word) &&
			said.has(word) &&
			(loanLine || !SHARED_LOAN_WORDS.has(word)),
	).length;
}

/**
 * Which case of the tree a line waiting in Review is: null when it doesn't read as a payment to a
 * card or loan, so it's an ordinary card. `text` is the bank's own wording, `from` the name of the
 * Account it left (an Account never pays itself). A Commitment is chosen only when its card or
 * loan is the one clear fit: the Account whose name the line has the most words of, or, when the
 * line fits none of the Household's, the only card (for a card payment) or loan (for a loan's
 * line) a Commitment pays down, unless the line names another issuer. The amount never has to
 * match: it only breaks a tie between two Accounts, or two Commitments on one Account.
 */
export function paymentCase(
	line: { text: string | null | undefined; amountCents: Cents; from?: string | null },
	accounts: PaymentAccount[],
	commitments: PayingCommitment[],
): PaymentCase | null {
	const text = line.text ?? "";
	if (line.amountCents <= 0 || NOT_A_PAYMENT.test(text)) return null;
	const loanLine = LOAN_WORDS.test(text);
	const cardLine = looksLikeCardPayment(text);
	if (!PAYMENT_WORDS.test(text) && !loanLine) return null;
	const others = accounts.filter((account) => account.name !== line.from);
	const byId = new Map(others.map((account) => [account.id, account]));
	// A card Noodle follows is paid down by a Commitment only for a balance being carried.
	const paying = commitments.filter((commitment) => {
		const account = byId.get(commitment.accountId);
		return account && (!account.followed || commitment.carriedBalance);
	});
	const paidDown = (account: PaymentAccount) =>
		paying.filter((commitment) => commitment.accountId === account.id);
	const exact = (account: PaymentAccount) =>
		paidDown(account).filter((commitment) => commitment.amountCents === line.amountCents);

	const said = new Set(wordsOf(text));
	const scored = others
		.map((account) => ({ account, score: wordsFit(account, said, loanLine) }))
		.filter(({ score }) => score > 0)
		.sort((a, b) => b.score - a.score);
	const best = scored.filter(({ score }) => score === scored[0]?.score).map((s) => s.account);
	let account: PaymentAccount | null = best.length === 1 ? (best[0] ?? null) : null;
	if (best.length > 1) {
		// Two fit equally ("Chase Sapphire", "Chase Freedom"): only an exact amount tells them apart.
		const byAmount = best.filter((candidate) => exact(candidate).length > 0);
		if (byAmount.length === 1) account = byAmount[0] ?? null;
	}
	if (scored.length === 0 && (cardLine || SURE_LOAN_WORDS.test(text))) {
		// It names none of the Household's: the only card or loan a Commitment pays down is it.
		const kind = cardLine ? "credit-card" : "loan";
		const linked = others.filter(
			(candidate) => candidate.kind === kind && paidDown(candidate).length > 0,
		);
		const [only] = linked;
		const named = issuersIn(text);
		const theirs = only ? new Set(issuersIn(only.name)) : new Set<string>();
		// A name that says no issuer ("Gold card") can be any issuer's card.
		const sameIssuer = theirs.size === 0 || named.every((issuer) => theirs.has(issuer));
		if (only && linked.length === 1 && sameIssuer) {
			account = only;
		}
	}
	if (account) {
		const linked = paidDown(account);
		const [byAmount] = exact(account);
		const commitment = byAmount ?? linked[0];
		if (commitment) {
			return {
				kind: "commitment",
				commitmentId: commitment.id,
				commitment: commitment.name,
				accountId: account.id,
				account: account.name,
			};
		}
	}

	// No Commitment for it: only a credit card's payment is anything but an ordinary line.
	const cards = others.filter((candidate) => candidate.kind === "credit-card");
	const likely = likelyCardPayment({ text, amountCents: line.amountCents }, cards);
	if (!likely) return null;
	if (likely.card) {
		const card = cards.find((candidate) => candidate.name === likely.card);
		return card?.followed
			? { kind: "followed", card: card.name }
			: { kind: "not-followed", card: likely.card, accountId: card?.id ?? null };
	}
	// Several of the Household's cards fit and Noodle follows them all: a Transfer, whichever it is.
	const fitting = best.filter((candidate) => candidate.kind === "credit-card");
	return fitting.length > 1 && fitting.every((candidate) => candidate.followed)
		? { kind: "followed", card: null }
		: { kind: "not-followed", card: null, accountId: null };
}
