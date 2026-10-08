import type { MoneyInKind } from "@noodle/domain";

// The month at a glance on the Transactions page (issue 134): what came in, what went out and how
// much waits for a Parent. Each figure is also a filter (`show` in the address).

/** What the Transactions page is narrowed to by its summary: money in, money out, or what waits. */
export const TRANSACTION_SHOWS = ["in", "out", "review"] as const;
export type TransactionShow = (typeof TRANSACTION_SHOWS)[number];

type Line = { amount: number; kind: MoneyInKind; needsReview: boolean };

/** Money moving inside the Household's own pool: it arrives in an Account, but nothing came in. */
const movesWithin = (line: Pick<Line, "kind">) =>
	line.kind === "transfer" || line.kind === "between-us";

/**
 * The month's three figures. Money in is Income, Refunds and Paid back: a Transfer and Between us
 * are the Household's own money moving, and a line that waits in Review counts nowhere until a
 * Parent says what it is (it is counted in Needs review instead). Money out and the spending that
 * waits come with the list (`list`, null while it loads).
 */
export function monthSummary(
	moneyIn: Line[],
	list: { outCents: number; needsReview: number } | null | undefined,
): { inCents: number; outCents: number; needsReview: number } {
	let inCents = 0;
	let waiting = 0;
	for (const line of moneyIn) {
		if (movesWithin(line)) continue;
		if (line.needsReview) waiting += 1;
		else inCents += line.amount;
	}
	return {
		inCents,
		outCents: list?.outCents ?? 0,
		needsReview: (list?.needsReview ?? 0) + waiting,
	};
}

/**
 * How much of the month's Money in is Income: what This Month calls "received" and sets against
 * Take-home pay. The rest of Money in is Refunds and Paid back, which are never Income.
 */
export const monthIncome = (moneyIn: Line[]): number =>
	moneyIn.reduce(
		(sum, line) => (line.kind === "income" && !line.needsReview ? sum + line.amount : sum),
		0,
	);

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
