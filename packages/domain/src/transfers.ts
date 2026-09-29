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
