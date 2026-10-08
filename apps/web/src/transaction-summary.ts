// The month at a glance on the Transactions page (issue 134): what came in, what went out and how
// much waits for a Parent. Each figure is also a filter (`show` in the address).

/** What the Transactions page is narrowed to by its summary: money in, money out, or what waits. */
export const TRANSACTION_SHOWS = ["in", "out", "review"] as const;
export type TransactionShow = (typeof TRANSACTION_SHOWS)[number];

/**
 * The list's figures at once after a change to one of its Transactions, before the server's own
 * come back: Money out loses what the Transaction was and gains what it is now (nothing, deleted).
 * A new name moves no money; a side of a Transfer was never in Money out; one partly in the other
 * Parent's Personal Allowance isn't this Parent's to change. One that waited in Review and was
 * filed, split or deleted is one fewer in Needs review.
 */
export function summaryAfterChange<T extends { outCents: number; needsReview?: number }>(
	summary: T,
	was: { amountCents: number; transfer: unknown; partlyPrivate?: boolean; waits?: boolean },
	next: { amountCents: number } | { rename: string } | { for: string[] } | { date: string } | null,
): T {
	if (was.transfer !== null || was.partlyPrivate) return summary;
	// A new name, or only who it is For: no money moves, and one that waits in Review still does.
	if (next && ("rename" in next || "for" in next || "date" in next)) return summary;
	const outCents = summary.outCents - was.amountCents + (next?.amountCents ?? 0);
	// Filed, split or deleted from the list: it waits in Review no longer (issue 141).
	return was.waits && summary.needsReview !== undefined
		? { ...summary, outCents, needsReview: Math.max(0, summary.needsReview - 1) }
		: { ...summary, outCents };
}
