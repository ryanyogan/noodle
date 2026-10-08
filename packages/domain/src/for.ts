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

/** Who a figure is For when it is the whole Household's, where a Member's ID would name a Member. */
export const EVERYONE = "everyone";

/**
 * The part of `spend` that counts For `who` (a Member's ID, or EVERYONE), exactly as forTotals
 * counts it: all of it For the whole Household or one Member, an even share when it is For
 * several, and nothing when it isn't theirs.
 */
export function shareFor(spend: Pick<AttributedSpend, "amount" | "for">, who: string): Cents {
	const memberIds = [...new Set(spend.for)];
	if (who === EVERYONE) return memberIds.length === 0 ? spend.amount : 0;
	const at = memberIds.indexOf(who);
	return at < 0 ? 0 : (shares(spend.amount, memberIds.length)[at] ?? 0);
}

/**
 * The spending behind one of forTotals' figures: what was For `who` (a Member's ID, or
 * EVERYONE), each with `who`'s share as its amount, so they add up to the figure to the cent.
 */
export function spendingFor<S extends AttributedSpend>(spending: S[], who: string): S[] {
	return spending
		.filter((spend) => (who === EVERYONE ? spend.for.length === 0 : spend.for.includes(who)))
		.map((spend) => ({ ...spend, amount: shareFor(spend, who) }));
}

/**
 * Who `spending` was For, as spendingFor takes them: each Member named, then EVERYONE if any of
 * it was the whole Household's.
 */
export function forWhom(spending: Pick<AttributedSpend, "for">[]): string[] {
	const members = new Set(spending.flatMap((spend) => spend.for));
	return [...members, ...(spending.some((spend) => spend.for.length === 0) ? [EVERYONE] : [])];
}

/** How many of a merchant's latest filed Transactions likelyFor goes by. */
export const LIKELY_FOR_LOOKS_AT = 6;

/** How few of them say who a merchant's spending is For: one alone is not a habit. */
export const LIKELY_FOR_AT_LEAST = 2;

/**
 * Who a merchant's next Transaction is likely For (issue 155), going by who its earlier ones were
 * For (`earlier`, the latest first): the latest LIKELY_FOR_LOOKS_AT of them, when there are at
 * least LIKELY_FOR_AT_LEAST and every one was For exactly the same Member or Members. Null when
 * they differ, are too few, or were For Everyone, which a Transaction is anyway. Members no longer
 * in the Household (`current` is who still is) are left out of the answer: the rest stay, and with
 * nobody left it is null.
 */
export function likelyFor(earlier: For[], current?: Iterable<string>): For | null {
	const latest = earlier.slice(0, LIKELY_FOR_LOOKS_AT).map((value) => [...new Set(value)].sort());
	const [first] = latest;
	if (!first || latest.length < LIKELY_FOR_AT_LEAST || first.length === 0) return null;
	if (latest.some((value) => value.join() !== first.join())) return null;
	const still = current ? new Set(current) : null;
	const likely = still ? first.filter((memberId) => still.has(memberId)) : first;
	return likely.length > 0 ? likely : null;
}
