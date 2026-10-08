import type { Cents } from "./money";
import type { DayKey, MonthKey } from "./month";

// What was paid to each card or loan in a month (issue 150): the payments marked as a Transfer
// naming it, plus the payments filed in a Commitment that pays it down. The same two lists its
// own page shows under Payments, so the figure on Accounts and the rows on the page agree.

type Paid = { id: string; accountId: string; amount: Cents; date: DayKey };

/**
 * Each card's or loan's payments dated in `month`, added up by its Account's id; one nothing was
 * paid to that month isn't in the map. A payment in both lists counts once.
 */
export function paidToCards(
	records: { payments: readonly Paid[]; sent?: readonly Paid[] | undefined },
	month: MonthKey,
): Map<string, Cents> {
	const filed = new Set(records.payments.map((payment) => `${payment.accountId}:${payment.id}`));
	const paid = new Map<string, Cents>();
	const add = (payment: Paid) => {
		if (payment.date.slice(0, 7) !== month) return;
		paid.set(payment.accountId, (paid.get(payment.accountId) ?? 0) + payment.amount);
	};
	for (const payment of records.payments) add(payment);
	for (const payment of records.sent ?? []) {
		if (!filed.has(`${payment.accountId}:${payment.id}`)) add(payment);
	}
	return paid;
}
