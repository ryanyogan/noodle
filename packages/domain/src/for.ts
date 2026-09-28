import type { Cents } from "./money";
import type { Spend } from "./month-state";

/**
 * Who spending was For: the IDs of one or several Members, or none at all for the whole
 * Household. Independent of which Bucket it is assigned to.
 */
export type For = string[];

/** Spending with who it was For. */
export type AttributedSpend = Spend & { for: For };

/** An amount spent, in total and by Bucket (keyed by Bucket ID). */
export type SpendTotal = { total: Cents; buckets: Record<string, Cents> };

/**
 * What was spent For each Member (keyed by Member ID) and For the whole Household. Members'
 * totals plus the Household's add up to everything spent: nothing is counted twice.
 */
export type ForTotals = { household: SpendTotal; members: Record<string, SpendTotal> };

export const noForTotals: ForTotals = { household: { total: 0, buckets: {} }, members: {} };

/**
 * `amount` split into `count` shares that add up to it exactly, as even as whole cents allow;
 * the first shares take any leftover cent.
 */
export function shares(amount: Cents, count: number): Cents[] {
	const base = Math.trunc(amount / count);
	const leftover = amount - base * count;
	return Array.from(
		{ length: count },
		(_, i) => base + (i < Math.abs(leftover) ? Math.sign(leftover) : 0),
	);
}

const addTo = (total: SpendTotal, bucketId: string, amount: Cents): SpendTotal => ({
	total: total.total + amount,
	buckets: { ...total.buckets, [bucketId]: (total.buckets[bucketId] ?? 0) + amount },
});

/**
 * What `spending` cost For each Member and For the whole Household, in total and by Bucket,
 * added onto `base` (e.g. earlier months' totals, for the year to date). Spending For several
 * Members is shared evenly between them, and spending For the whole Household counts once, as
 * the Household's, never again under each Member.
 */
export function forTotals(spending: AttributedSpend[], base: ForTotals = noForTotals): ForTotals {
	let household = base.household;
	const members = { ...base.members };
	for (const spend of spending) {
		const memberIds = [...new Set(spend.for)];
		if (memberIds.length === 0) {
			household = addTo(household, spend.bucketId, spend.amount);
			continue;
		}
		const split = shares(spend.amount, memberIds.length);
		memberIds.forEach((memberId, i) => {
			members[memberId] = addTo(
				members[memberId] ?? noForTotals.household,
				spend.bucketId,
				split[i] ?? 0,
			);
		});
	}
	return { household, members };
}
