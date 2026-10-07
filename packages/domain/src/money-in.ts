import { looksPersonToPerson } from "./between-us";
import { merchantKey } from "./categorize";

// Money in has a kind (ADR-0057): Income, a Refund, Paid back, a Transfer or Between us. Only
// Income counts toward the Take-home pay and Extra income. A Parent can change which.

export const MONEY_IN_KINDS = ["income", "refund", "paid-back", "transfer", "between-us"] as const;
export type MoneyInKind = (typeof MONEY_IN_KINDS)[number];

/** The kinds kept on the money-in line itself; a Transfer or Between us is a row in `transfers`. */
export const STORED_MONEY_IN_KINDS = ["refund", "paid-back"] as const;
export type StoredMoneyInKind = (typeof STORED_MONEY_IN_KINDS)[number];

/** How the app says each kind (CONTEXT.md). */
export const MONEY_IN_KIND_LABELS: Record<MoneyInKind, string> = {
	income: "Income",
	refund: "Refund",
	"paid-back": "Paid back",
	transfer: "Transfer",
	"between-us": "Between us",
};

/**
 * What kind a money-in line is, from what is kept about it: a Transfer it is the arriving side of
 * comes first (Between us when a Parent gave that reason), then the kind kept on the line, and
 * Income when neither says otherwise.
 */
export function moneyInKindOf(line: {
	stored: string | null | undefined;
	transfer: { reason: string | null | undefined } | null | undefined;
}): MoneyInKind {
	if (line.transfer) return line.transfer.reason === "between-us" ? "between-us" : "transfer";
	if (line.stored === "refund" || line.stored === "paid-back") return line.stored;
	return "income";
}

const PAYROLL =
	/\b(payroll|paycheck|pay\s?check|salary|wages?|direct\s?dep(?:osit)?|dir\s?dep|net\s?pay|adp|paychex)\b/i;

/** The bank's wording reads as pay: "ACME CORP PAYROLL", "DIRECT DEP", "ADP". */
export function looksLikePayroll(text: string | null | undefined): boolean {
	return !!text && PAYROLL.test(text);
}

// Wording a bank gives money coming back for something bought, or a fee it gives back, as whole
// words. Each row was checked both ways against real statement lines (money-in.test.ts has the
// table). "REF" counts only as "REF OF …": "REF #1234" is a reference number. "CREDIT" and "CASH
// BACK" alone are not here: banks write them on pay and rewards too.
const REFUND = new RegExp(
	`\\b(${[
		"refund(?:ed|s)?", // "AMAZON REFUND", "POS REFUND TARGET", "OVERDRAFT FEE REFUND"
		"rfnd|rfd|refnd", // "DELTA AIR LINES RFND", "UBER TRIP RFD"
		"ref\\s+of", // "REF OF OVERPAYMENT COMCAST"
		"revers(?:al|ed)", // "OVERDRAFT FEE REVERSAL", "PAYMENT REVERSED"
		"credit\\s?adj(?:ustment)?", // "CREDIT ADJ", "CREDIT ADJUSTMENT"
		"merchant\\s?credit", // "MERCHANT CREDIT REI"
		"charge\\s?back", // "CHARGEBACK", "CHARGE BACK"
		"(?:provisional|dispute)\\s?credit", // a disputed purchase's money back
	].join("|")})\\b`,
	"i",
);

// A payment that failed and came back ("ACH RETURN", "RETURNED ITEM", "RETURN CHECK", "PAYMENT
// RETURNED"): the Household's own money, so neither a Refund for a purchase nor Income.
const RETURNED_PAYMENT =
	/\b(?:returned|ach\s+(?:returns?|rtn|ret)|(?:nsf|item|check|chk|payment|pmt|bill\s?pay|draft)\s+returns?|returns?\s+(?:item|check|chk|payment|pmt|ach|draft))\b/i;

const RETURN = /\breturns?\b/gi;
/**
 * "RETURN" with a store beside it ("AMAZON RETURN", "PURCHASE RETURN COSTCO", "REI #11 RETURN").
 * Not "RETURN OF PREMIUM" (an insurer's payout), and not the word alone, which says too little.
 */
function looksLikeStoreReturn(text: string): boolean {
	RETURN.lastIndex = 0;
	if (!RETURN.test(text) || /\breturns?\s+of\b/i.test(text)) return false;
	return /[a-z]{2,}/i.test(text.replace(RETURN, " "));
}

// A tax refund is the Household's own money coming home, not money back for a purchase: Income.
// Recognised by the revenue agency as much as by the word, which many states leave out ("GA DOR
// REFUND", "STATE OF COLO REFUND", "NYS DTF PIT", "CA FTB"), and glued too ("CASTTAXRFD",
// "TAXREFUND"). Sales tax a store gives back is the store's refund ("SALES TAX REFUND TARGET").
const TAX =
	/(?<!\bsales\s?)tax\s?(?:ref|rfn?d)|\b(?:(?<!\bsales\s)tax(?:es|ation)?|irs|treas(?:ury)?|ftb|dor|dtf|comptroller|sbtpg|revenue|(?:dept|department)\s+(?:of\s+)?rev|(?:state|st|comm|commonwealth)\s+of\s+[a-z]+)\b/i;

/** How wording that isn't payroll or person to person reads: a refund, a payment back, or neither. */
function comingBack(text: string | null | undefined): "refund" | "returned" | null {
	if (!text || looksPersonToPerson(text)) return null;
	// A refund said outright wins over the rest: "RETURNED ITEM FEE REVERSAL" gives a fee back.
	if (REFUND.test(text)) return TAX.test(text) ? null : "refund";
	if (RETURNED_PAYMENT.test(text)) return "returned";
	return looksLikeStoreReturn(text) && !TAX.test(text) ? "refund" : null;
}

/**
 * The bank's wording reads as money back for something bought, or a fee given back: "AMAZON
 * REFUND", "TARGET RETURN 0423", "FEE REVERSAL", "MERCHANT CREDIT", "CHARGEBACK", "UBER RFD". Not
 * a tax refund ("IRS TREAS 310 TAX REF", "GA DOR REFUND"), not a payment that came back ("ACH
 * RETURN"), not money from a person whatever its memo says, and not "CREDIT" or "CASH BACK" alone.
 * When the wording says too little, it isn't one: real Income is not pulled into Review.
 */
export function looksLikeRefund(text: string | null | undefined): boolean {
	return comingBack(text) === "refund";
}

/**
 * The bank's wording reads as a payment that failed and came back: "ACH RETURN", "RETURNED ITEM",
 * "RETURN CHECK". It waits in Review with no kind suggested: it is not a Refund for a purchase,
 * and it is not Income.
 */
export function looksLikeReturnedPayment(text: string | null | undefined): boolean {
	return comingBack(text) === "returned";
}

// What a person writes in a memo when they are paying for something the Household bought.
const PAYING_BACK =
	/\b(?:refund(?:ed|s|ing)?|rfnd|pa(?:y|ys|ying|id)\s?(?:(?:you|u|me)\s)?back|repa(?:y|id|yment|ying)|owe[ds]?|reimburs[a-z]*|iou)\b/i;

/**
 * The kind Review suggests for money in that waits there, read from the wording each time, so
 * nothing is kept about it. Money from a person gets Paid back when its memo says so ("refund for
 * tickets", "paying you back", "what I owe you") and never Refund: there is no purchase at a
 * merchant to link. Other wording that reads as a refund gets Refund. Nothing otherwise.
 */
export function suggestedMoneyInKind(description: string | null | undefined): MoneyInKind | null {
	if (!description || looksLikePayroll(description)) return null;
	if (looksPersonToPerson(description)) return PAYING_BACK.test(description) ? "paid-back" : null;
	return looksLikeRefund(description) ? "refund" : null;
}

/** A Rule for money in: wording (a merchantKey, matched as whole words) that is always a kind. */
export type MoneyInRule = {
	pattern: string;
	kind: MoneyInKind;
	/** Set on a remembered pair of Accounts: it speaks only for money into this Account. */
	intoAccountId?: string | null;
};

/**
 * The Rule for a money-in line's wording: the longest pattern found in it as whole words. Where
 * a wording has both a plain Rule and a remembered pair of Accounts, the pair speaks: it is about
 * this very Account. The caller passes only the pairs into the line's own Account.
 */
export function moneyInRuleFor<R extends MoneyInRule>(
	rules: readonly R[],
	description: string | null | undefined,
): R | undefined {
	if (!description) return undefined;
	const padded = ` ${merchantKey(description)} `;
	return rules
		.filter((rule) => rule.pattern.trim() && padded.includes(` ${rule.pattern.trim()} `))
		.sort(
			(a, b) =>
				b.pattern.trim().length - a.pattern.trim().length ||
				Number(Boolean(b.intoAccountId)) - Number(Boolean(a.intoAccountId)),
		)[0];
}

/**
 * What an Import does with money in (ADR-0057): a Rule's kind without asking; Income without
 * asking for payroll wording; person-to-person wording (Zelle, Venmo, PayPal, Cash App, Apple
 * Cash, "transfer from") waits in Review, with Paid back suggested when its memo says so; wording
 * that reads as a store's refund or a reversal waits there with Refund suggested, and a payment
 * that came back ("ACH RETURN") with nothing suggested (issue 141); anything else is Income, as
 * it always was, a tax refund included.
 */
export function moneyInOnImport(
	description: string | null | undefined,
	rules: readonly MoneyInRule[] = [],
): { kind: MoneyInKind; review: boolean; suggest?: MoneyInKind } {
	const rule = moneyInRuleFor(rules, description);
	if (rule) return { kind: rule.kind, review: false };
	if (looksLikePayroll(description)) return { kind: "income", review: false };
	// Not Income yet, and not the suggested kind until a Parent says so: the kind kept stays Income's.
	const suggest = suggestedMoneyInKind(description);
	if (suggest) return { kind: "income", review: true, suggest };
	return {
		kind: "income",
		review: looksPersonToPerson(description) || looksLikeReturnedPayment(description),
	};
}
