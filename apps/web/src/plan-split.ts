import { formatMoney } from "./format";

// The Plan overview's one chart (ticket 102): where take-home pay goes. One whole bar is the pay; its
// parts, in a fixed order, are what the Plan sets aside, and what's left is Free to Spend. The
// maths lives here so the bar, the rows under it and the sentence above it can't disagree.

/** The narrowest a part with money in it is drawn, as a percent of the bar: still visible. */
export const MIN_WIDTH = 2;

export type SplitPart = { key: string; label: string; amount: number };

export type SplitRow = SplitPart & {
	/** Whole percent of the pay, as the row says it. Null when there is no pay to be a share of. */
	share: number | null;
	/** Percent of the bar's length. Only for drawing: never shown as a number. */
	width: number;
};

export type PlanSplit = {
	/** Take-home pay (plus any Extra income sent to Free to Spend). Null when it isn't set. */
	income: number | null;
	planned: number;
	/** Free to Spend: below zero when more is planned than there is pay. */
	left: number;
	overBy: number;
	/** The Plan's parts, in the bar's order. */
	parts: SplitRow[];
	/** Free to Spend, always last. No width and no share when the Plan is over. */
	free: SplitRow;
	/** Over only: how far along the bar the pay reaches, and the stretch past it. */
	reach: { within: number; over: number } | null;
};

const positive = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Whole-number percents that add up to exactly 100 (largest remainder), so the rows never read
 * "99%" or "101%" in total. All zeros when there is nothing to share out.
 */
export function wholeShares(amounts: number[]): number[] {
	const values = amounts.map(positive);
	const total = values.reduce((sum, n) => sum + n, 0);
	if (total <= 0) return values.map(() => 0);
	const exact = values.map((n) => (n / total) * 100);
	const shares = exact.map(Math.floor);
	const spare = 100 - shares.reduce((sum, n) => sum + n, 0);
	const byRemainder = exact
		.map((n, index) => ({ index, rest: n - Math.floor(n) }))
		.sort((a, b) => b.rest - a.rest || a.index - b.index);
	for (const { index } of byRemainder.slice(0, spare)) shares[index] = (shares[index] ?? 0) + 1;
	return shares;
}

/**
 * How long each part is drawn, in percent of the bar, adding up to 100. A part with money in it
 * is never thinner than `min`, so a small one can still be seen; the others give up the room in
 * proportion. A part with nothing in it has no length.
 */
export function barWidths(amounts: number[], min = MIN_WIDTH): number[] {
	const values = amounts.map(positive);
	const total = values.reduce((sum, n) => sum + n, 0);
	if (total <= 0) return values.map(() => 0);
	const raw = values.map((n) => (n / total) * 100);
	const held = new Set<number>();
	for (;;) {
		const room = 100 - min * held.size;
		const rest = raw.reduce((sum, n, index) => (held.has(index) ? sum : sum + n), 0);
		const scale = rest > 0 ? room / rest : 0;
		const small = raw.findIndex((n, index) => n > 0 && !held.has(index) && n * scale < min);
		if (small === -1) return raw.map((n, index) => (held.has(index) ? min : n * scale));
		held.add(small);
	}
}

/**
 * The split of a month's pay. `left` is Free to Spend as the month counts it; without it, it is
 * the pay less the parts.
 */
export function planSplit({
	income,
	parts,
	left: given,
}: {
	income: number | null;
	parts: SplitPart[];
	left?: number;
}): PlanSplit {
	const amounts = parts.map((p) => positive(p.amount));
	const planned = amounts.reduce((sum, n) => sum + n, 0);
	const left = given ?? (income ?? 0) - planned;
	const overBy = left < 0 ? -left : 0;
	const freePart = { key: "free", label: "Free to Spend", amount: left };
	if (income === null) {
		return {
			income,
			planned,
			left,
			overBy,
			parts: parts.map((p) => ({ ...p, share: null, width: 0 })),
			free: { ...freePart, share: null, width: 0 },
			reach: null,
		};
	}
	if (overBy > 0) {
		// The bar is everything planned, which is longer than the pay: shares of the pay then add up
		// to more than 100, which is the point, and Free to Spend has no part of the bar.
		const widths = barWidths(amounts);
		const [within = 0, over = 0] = barWidths([planned - overBy, overBy]);
		return {
			income,
			planned,
			left,
			overBy,
			parts: parts.map((p, index) => ({
				...p,
				share: income > 0 ? Math.round(((amounts[index] ?? 0) / income) * 100) : null,
				width: widths[index] ?? 0,
			})),
			free: { ...freePart, share: null, width: 0 },
			reach: { within, over },
		};
	}
	const all = [...amounts, left];
	const whole = planned + left;
	const shares = wholeShares(all);
	const widths = barWidths(all);
	const last = parts.length;
	return {
		income,
		planned,
		left,
		overBy,
		parts: parts.map((p, index) => ({
			...p,
			share: whole > 0 ? (shares[index] ?? 0) : null,
			width: widths[index] ?? 0,
		})),
		free: { ...freePart, share: whole > 0 ? (shares[last] ?? 0) : null, width: widths[last] ?? 0 },
		reach: null,
	};
}

/** A row's share in words: "27%", "<1%" for a part too small to round to one, "" for none. */
export function shareText(row: Pick<SplitRow, "share" | "amount">): string {
	if (row.share === null) return "";
	return row.share === 0 && row.amount > 0 ? "<1%" : `${row.share}%`;
}

/**
 * The chart's takeaway, in one or two short sentences. `extra` is Extra income sent to Free to
 * Spend this month, which is on top of take-home pay.
 */
export function splitSentence(split: PlanSplit, extra = 0): string {
	const { income, planned, left, overBy } = split;
	if (income === null)
		return "Take-home pay isn’t set for this month, so there is nothing to divide up.";
	const pay =
		extra > 0
			? `the ${formatMoney(income)} you have this month (take-home pay plus ${formatMoney(extra)} Extra income)`
			: `your ${formatMoney(income)} take-home pay`;
	if (overBy > 0) {
		return `${formatMoney(planned)} is planned, ${formatMoney(overBy)} more than ${pay}.`;
	}
	if (planned === 0) return `Nothing is planned yet: all of ${pay} is Free to Spend.`;
	if (left === 0) return `All of ${pay} is planned. Nothing is left as Free to Spend.`;
	return `${formatMoney(planned)} of ${pay} is planned. ${formatMoney(left)} is Free to Spend.`;
}
