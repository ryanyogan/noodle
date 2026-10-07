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

// Wording a bank gives money coming back for something bought, as whole words. Each row was
// checked both ways against real statement lines (money-in.test.ts has the table).
const REFUND = new RegExp(
	`\\b(${[
		"refund(?:ed|s)?", // "AMAZON REFUND", "POS REFUND TARGET", "OVERDRAFT FEE REFUND"
		"return(?:ed|s)?", // "PURCHASE RETURN COSTCO", "DEBIT CARD RETURN", "RETURNED ITEM"
		"revers(?:al|ed)", // "FEE REVERSAL", "PAYMENT REVERSED"
		"credit\\s?adj(?:ustment)?", // "CREDIT ADJ", "CREDIT ADJUSTMENT"
		"merchant\\s?credit", // "MERCHANT CREDIT REI"
		"charge\\s?back", // "CHARGEBACK", "CHARGE BACK"
		"(?:provisional|dispute)\\s?credit", // a disputed purchase's money back
	].join("|")})\\b`,
	"i",
);
// A tax refund is the Household's own money coming home, not money back for a purchase: Income.
const TAX = /\b(tax|taxes|irs|treas(?:ury)?|franchise\s?tax|dept\s?of\s?rev(?:enue)?)\b/i;

/**
 * The bank's wording reads as money back for something bought: "AMAZON REFUND", "PURCHASE
 * RETURN", "FEE REVERSAL", "MERCHANT CREDIT", "CHARGEBACK". Not a tax refund ("IRS TREAS 310 TAX
 * REFUND"), and not "CREDIT" or "CASH BACK" alone, which banks write on pay and rewards too.
 */
export function looksLikeRefund(text: string | null | undefined): boolean {
	return !!text && REFUND.test(text) && !TAX.test(text);
}

/**
 * The kind Review suggests for money in that waits there: a Refund when its wording reads as
 * one, nothing otherwise. Read from the wording each time, so nothing is kept about it.
 */
export function suggestedMoneyInKind(description: string | null | undefined): MoneyInKind | null {
	return looksLikeRefund(description) && !looksLikePayroll(description) ? "refund" : null;
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
 * Cash, "transfer from") waits in Review, and so does wording that reads as a refund or a
 * reversal, with Refund suggested (issue 141); anything else is Income, as it always was.
 */
export function moneyInOnImport(
	description: string | null | undefined,
	rules: readonly MoneyInRule[] = [],
): { kind: MoneyInKind; review: boolean; suggest?: MoneyInKind } {
	const rule = moneyInRuleFor(rules, description);
	if (rule) return { kind: rule.kind, review: false };
	if (looksLikePayroll(description)) return { kind: "income", review: false };
	// Not Income yet, and not a Refund until a Parent says so: the kind kept stays Income's.
	if (looksLikeRefund(description)) return { kind: "income", review: true, suggest: "refund" };
	return { kind: "income", review: looksPersonToPerson(description) };
}
