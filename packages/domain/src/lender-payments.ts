import type { Cents } from "./money";

// A payment to a lender the Household has a loan with (issue 153, phase c).
// An instalment plan's payment arrives as an ordinary charge, often a purchase on a credit card
// ("ZIPLINE.COM PAYMENTS"), and reads as spending at the lender. It is a payment on a loan when
// the line names a loan a Commitment pays down (ADR-0050): by the loan Account's name or its
// Commitment's, never by a list of lenders. Several instalment plans at one lender are several
// loans whose names all fit the line, so the amount says which: the one whose payment it is, to
// the cent, else the nearest. When the amount can't tell them apart, Review asks.

/** A loan a Commitment in the Plan pays down, as a payment line is read against it. */
export type LoanPaidDown = {
	/** The loan Account. */
	accountId: string;
	name: string;
	/** The Commitment that pays it down, and its name. */
	commitmentId: string;
	commitment: string;
	/** The loan's payment (`accounts.payment_cents`), else what its Commitment plans. */
	paymentCents: Cents;
};

/** Words a bank puts around a lender's name, and words any loan's name may have. */
const PLAIN_WORDS = new Set(
	`payment payments pymt pymts pmt pmts pay paid autopay epay epayment bill billpay online web ach
	recurring debit credit card purchase pos com www net inc llc co corp ltd the and of for to from
	loan loans ln lending lender finance financial financing servicing service services svc svcs
	installment installments instalment instalments plan thank you
	car auto home house student mortgage personal`.split(/\s+/),
);

/** The words of a line or a name that say whose it is: no numbers, and none of the plain ones. */
const tellingWords = (text: string | null | undefined) =>
	(text?.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
		(word) => word.length >= 2 && !/\d/.test(word) && !PLAIN_WORDS.has(word),
	);

/** How a line has to fit a loan's name. */
export type LoanFit =
	/** Every telling word of the bank's wording, or of the merchant's name, is in the loan's name. */
	| "names"
	/** They share a telling word: enough once a Parent's Rule has said the line is a loan's payment. */
	| "mentions";

/**
 * The loans a line names, in the order given. `text` is the bank's own wording and `merchant` the
 * name the line was given; either may fit. To name a loan the line must say nothing else: "ZIPLINE
 * PAYMENTS" names "Zipline sofa", and "SOFA WAREHOUSE" doesn't, though both have one of its words.
 */
export function loansNamed<L extends LoanPaidDown>(
	line: { text?: string | null; merchant?: string | null },
	loans: L[],
	fit: LoanFit = "names",
): L[] {
	const said = [tellingWords(line.text), tellingWords(line.merchant)].filter(
		(words) => words.length > 0,
	);
	if (said.length === 0) return [];
	return loans.filter((loan) => {
		const theirs = new Set([...tellingWords(loan.name), ...tellingWords(loan.commitment)]);
		return said.some((words) =>
			fit === "names"
				? words.every((word) => theirs.has(word))
				: words.some((word) => theirs.has(word)),
		);
	});
}

/** Which of several loans a payment is on, and how that was told. */
export type LoanByAmount<L extends LoanPaidDown = LoanPaidDown> =
	/** `only`: there was one. `exact`: its payment, to the cent. `closest`: nearer than any other. */
	| { loan: L; by: "only" | "exact" | "closest" }
	/** The amount doesn't say: two with the same payment, or two as near. */
	| { loan: null };

/** The loan among `loans` an amount is a payment on: the exact payment wins, else the nearest. */
export function loanByAmount<L extends LoanPaidDown>(
	amountCents: Cents,
	loans: L[],
): LoanByAmount<L> {
	const [only, second] = loans;
	if (!only) return { loan: null };
	if (!second) return { loan: only, by: "only" };
	const exact = loans.filter((loan) => loan.paymentCents === amountCents);
	if (exact.length > 0) {
		return exact.length === 1 && exact[0] ? { loan: exact[0], by: "exact" } : { loan: null };
	}
	const away = (loan: L) => Math.abs(loan.paymentCents - amountCents);
	const [nearest, next] = [...loans].sort((a, b) => away(a) - away(b));
	return nearest && next && away(nearest) < away(next)
		? { loan: nearest, by: "closest" }
		: { loan: null };
}

/** What Review makes of money out that names a loan. */
export type LenderPayment<L extends LoanPaidDown = LoanPaidDown> =
	/** A payment on `loan`: suggested for its Commitment. `among` is every loan the line names. */
	| { kind: "loan"; loan: L; by: "only" | "exact" | "closest"; among: L[] }
	/** A payment on one of `among`, and the amount doesn't say which: Review asks. */
	| { kind: "which"; among: L[] };

/**
 * Money out that reads as a payment to a lender the Household has a loan with: null when the
 * line names none of `loans` (the loans a Commitment in the line's month pays down).
 */
export function lenderPayment<L extends LoanPaidDown>(
	line: { text?: string | null; merchant?: string | null; amountCents: Cents },
	loans: L[],
): LenderPayment<L> | null {
	if (line.amountCents <= 0) return null;
	const among = loansNamed(line, loans);
	const chosen = loanByAmount(line.amountCents, among);
	if (among.length === 0) return null;
	return "by" in chosen
		? { kind: "loan", loan: chosen.loan, by: chosen.by, among }
		: { kind: "which", among };
}

/**
 * Where a Rule that files into a loan's Commitment sends one line. A Rule matches the lender's
 * wording, and with several loans at one lender every payment would follow it into one loan, so
 * the amount is matched again each time a line arrives:
 *   null:          apply the Rule as stated (its Commitment pays down no loan, or the line
 *                  mentions no other loan).
 *   commitmentId:  the Commitment of the loan whose payment this is, to the cent.
 *   "ask":         no loan's payment is this amount, or two are: it waits in Review, which asks.
 */
export function ruledLoanPayment(
	commitmentId: string,
	line: { text?: string | null; merchant?: string | null; amountCents: Cents },
	loans: LoanPaidDown[],
): { commitmentId: string } | "ask" | null {
	const stated = loans.find((loan) => loan.commitmentId === commitmentId);
	if (!stated) return null;
	const among = loansNamed(line, loans, "mentions");
	if (among.length < 2 || !among.includes(stated)) return null;
	const chosen = loanByAmount(line.amountCents, among);
	return "by" in chosen && chosen.by === "exact"
		? { commitmentId: chosen.loan.commitmentId }
		: "ask";
}

/**
 * The loans a Rule into `commitmentId` chooses between by amount, read from the wording the Rule
 * is stated for as `ruledLoanPayment` reads a line: the Rule's own loan and every other that
 * wording mentions. None when the Rule files as stated. What the Rules list says of it.
 */
export function loansRuledByAmount<L extends LoanPaidDown>(
	commitmentId: string,
	pattern: string,
	loans: L[],
): L[] {
	const stated = loans.find((loan) => loan.commitmentId === commitmentId);
	if (!stated) return [];
	const among = loansNamed({ text: pattern }, loans, "mentions");
	return among.length >= 2 && among.includes(stated) ? among : [];
}
