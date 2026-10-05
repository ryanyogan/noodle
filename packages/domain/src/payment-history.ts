import type { Cents } from "./money";
import { addMonths, type DayKey, type MonthKey, monthOfDay } from "./month";
import { type PayingCommitment, type PaymentAccount, paymentCase } from "./transfers";

// What a Commitment that pays down a card or loan might be set at (ADR-0050): the payments made to
// that card or loan over the last three full months, found by the same reading of a bank's wording
// as Review's payment cards (paymentCase), so the two never disagree about whose payment a line is.

/** How many full months of payments the suggested amount is drawn from. */
export const PAYMENT_HISTORY_MONTHS = 3;

/** Money out as its bank worded it, and the name of the Account it left. */
export type PaymentLine = {
	text: string | null;
	amountCents: Cents;
	date: DayKey;
	from?: string | null;
};

/**
 * The lines that are payments to `accountId`: those Review would offer to file in a Commitment
 * paying it down, were there one. The Household's other paying Commitments keep their own lines.
 */
export function paymentsTo<Line extends PaymentLine>(
	accountId: string,
	lines: readonly Line[],
	accounts: PaymentAccount[],
	commitments: readonly PayingCommitment[],
): Line[] {
	const asIf: PayingCommitment = {
		id: "",
		name: "",
		accountId,
		amountCents: 0,
		carriedBalance: true,
	};
	const paying = [...commitments.filter((commitment) => commitment.accountId !== accountId), asIf];
	return lines.filter((line) => {
		const found = paymentCase(line, accounts, paying);
		return found?.kind === "commitment" && found.accountId === accountId;
	});
}

export type PaymentSuggestion = {
	/** What a month's payments come to. */
	amountCents: Cents;
	/** How many payments it is drawn from. */
	payments: number;
	/** Over how many months. */
	months: number;
	/** Every month came to exactly this, so it isn't an "about". */
	exact: boolean;
};

const roundTo = (amount: number, step: number) => Math.round(amount / step) * step;

/**
 * A monthly amount from the payments of the three full months before `month`: what they came to
 * a month, counted from the first of those months with a payment (a card paid for two months isn't
 * averaged over three). Null with too little to go on: payments in fewer than two of the months.
 * Months that all came to the same total give that total to the cent; otherwise it's rounded to
 * the nearest $10 (the nearest dollar under $100).
 */
export function suggestPayment(
	lines: readonly { amountCents: Cents; date: DayKey }[],
	month: MonthKey,
): PaymentSuggestion | null {
	const first = addMonths(month, -PAYMENT_HISTORY_MONTHS);
	const byMonth = new Map<MonthKey, Cents>();
	let payments = 0;
	for (const line of lines) {
		const paid = monthOfDay(line.date);
		if (line.amountCents <= 0 || paid < first || paid >= month) continue;
		byMonth.set(paid, (byMonth.get(paid) ?? 0) + line.amountCents);
		payments++;
	}
	if (byMonth.size < 2) return null;
	const earliest = [...byMonth.keys()].sort()[0] ?? first;
	let months = 0;
	for (let at = earliest; at < month; at = addMonths(at, 1)) months++;
	const totals = [...byMonth.values()];
	const total = totals.reduce((sum, amount) => sum + amount, 0);
	const exact = byMonth.size === months && totals.every((amount) => amount === totals[0]);
	const average = total / months;
	const amountCents = exact ? (totals[0] ?? 0) : roundTo(average, average >= 100_00 ? 10_00 : 1_00);
	if (amountCents <= 0) return null;
	return { amountCents, payments, months, exact };
}
