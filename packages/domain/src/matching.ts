import type { Cents } from "./money";
import { type DayKey, daysBetween } from "./month";
import { normalizeDescription } from "./statements";

// Match: a Quick Add and the imported Transaction that is its bank copy, so the spend counts once.
// Automatic only when it's clear: the same amount, the bank's date from a day before the Quick Add
// to five days after (cards post a few days late; a Quick Add entered the next morning is a day
// late), and no other candidate on either side, or one that the merchant text picks out. Anything
// less clear is left for a Parent (possibleMatches). Amounts must be equal to the cent: a tip added
// after the Quick Add (a restaurant bill) makes the bank's amount differ by an amount nothing can
// know, and matching "close" amounts automatically would pair unrelated spending of similar size;
// a Parent Matches those by hand.

/** A Quick Add or an imported Transaction, as matching sees it. */
export type MatchSide = {
	id: string;
	date: DayKey;
	/** Money spent, positive. */
	amount: Cents;
	/** The Quick Add's note, or the bank's description. */
	text: string | null;
};

/** How many days the bank's date may be before (-) or after the Quick Add's. */
export const MATCH_WINDOW = { from: -1, to: 5 } as const;

/** How far apart a Parent may still want to Match two amounts: a tip of up to 30%. */
const POSSIBLE_AMOUNT_SHARE = 0.3;

/** Words in bank descriptions that say nothing about the merchant. */
const NOISE = new Set([
	"pos",
	"purchase",
	"debit",
	"credit",
	"card",
	"visa",
	"mastercard",
	"checkcard",
	"recurring",
	"payment",
	"online",
	"the",
	"and",
	"inc",
	"llc",
	"com",
	"www",
	"store",
	"ach",
	"tst",
]);

/** The words of a note or description that could name a merchant. */
function merchantWords(text: string | null): string[] {
	return normalizeDescription(text ?? "")
		.split(" ")
		.filter((word) => word.length >= 3 && !/^\d+$/.test(word) && !NOISE.has(word));
}

/**
 * How much of a note names the merchant in a bank description, from 0 (nothing, or no note) to 1
 * (every word): "Starbucks" in "SQ *STARBUCKS #1234" is 1, "whole foods" in "WHOLEFDS MKT" 0.5.
 * Spacing is ignored on the bank's side, which runs words together.
 */
export function merchantSimilarity(note: string | null, description: string | null): number {
	const words = merchantWords(note);
	if (words.length === 0) return 0;
	const bank = normalizeDescription(description ?? "").replaceAll(" ", "");
	return words.filter((word) => bank.includes(word)).length / words.length;
}

/** The bank's date is within the Match window of the Quick Add's. */
export const withinMatchWindow = (quickAdd: DayKey, imported: DayKey) => {
	const days = daysBetween(quickAdd, imported);
	return days >= MATCH_WINDOW.from && days <= MATCH_WINDOW.to;
};

/**
 * Pairs `lefts` with `rights` where each is the other's clear best: `score` gives a candidate pair
 * a score (higher is better) or null when it isn't one, and a candidate is clear when it is the
 * only one, or scores above every other. Anything else is ambiguous and left unpaired, so the
 * result never depends on the order of the inputs.
 */
export function clearPairs<L extends { id: string }, R extends { id: string }>(
	lefts: L[],
	rights: R[],
	score: (left: L, right: R) => number | null,
): [L, R][] {
	const scored: { left: L; right: R; score: number }[] = [];
	for (const left of lefts) {
		for (const right of rights) {
			const value = score(left, right);
			if (value !== null) scored.push({ left, right, score: value });
		}
	}
	const clearBest = <T>(candidates: { of: T; score: number }[]): T | null => {
		const sorted = [...candidates].sort((a, b) => b.score - a.score);
		const [best, next] = sorted;
		return best && (!next || best.score > next.score) ? best.of : null;
	};
	return lefts.flatMap((left) => {
		const right = clearBest(
			scored.filter((pair) => pair.left === left).map((pair) => ({ of: pair.right, ...pair })),
		);
		if (!right) return [];
		const back = clearBest(
			scored.filter((pair) => pair.right === right).map((pair) => ({ of: pair.left, ...pair })),
		);
		return back === left ? [[left, right] as [L, R]] : [];
	});
}

/**
 * The Matches to make automatically between unmatched Quick Adds and imported Transactions:
 * equal amounts within the Match window, one clear candidate each (merchantSimilarity breaks
 * ties). `refused` names pairs a Parent unmatched, which are never Matched again automatically.
 */
export function autoMatches(
	quickAdds: MatchSide[],
	imported: MatchSide[],
	refused: (quickAddId: string, importedId: string) => boolean = () => false,
): { quickAddId: string; importedId: string }[] {
	return clearPairs(quickAdds, imported, (quickAdd, bank) =>
		quickAdd.amount === bank.amount &&
		quickAdd.amount > 0 &&
		withinMatchWindow(quickAdd.date, bank.date) &&
		!refused(quickAdd.id, bank.id)
			? merchantSimilarity(quickAdd.text, bank.text)
			: null,
	).map(([quickAdd, bank]) => ({ quickAddId: quickAdd.id, importedId: bank.id }));
}

/**
 * What a Parent might Match a Quick Add or imported Transaction (`of`) with, best first: those
 * within the Match window whose amount is equal or differs by up to 30% (a tip), equal amounts
 * first, then by merchant text, then by nearest day. `ofIsQuickAdd` says which side `of` is.
 */
export function possibleMatches(
	of: MatchSide,
	others: MatchSide[],
	ofIsQuickAdd: boolean,
	limit = 5,
): MatchSide[] {
	const close = (a: Cents, b: Cents) =>
		Math.abs(a - b) <= Math.round(Math.max(a, b) * POSSIBLE_AMOUNT_SHARE);
	const ranked = others
		.filter((other) => {
			const [quickAdd, bank] = ofIsQuickAdd ? [of, other] : [other, of];
			return (
				other.amount > 0 &&
				close(of.amount, other.amount) &&
				withinMatchWindow(quickAdd.date, bank.date)
			);
		})
		.map((other) => {
			const [quickAdd, bank] = ofIsQuickAdd ? [of, other] : [other, of];
			return {
				other,
				equal: other.amount === of.amount ? 1 : 0,
				similarity: merchantSimilarity(quickAdd.text, bank.text),
				days: Math.abs(daysBetween(of.date, other.date)),
			};
		})
		.sort((a, b) => b.equal - a.equal || b.similarity - a.similarity || a.days - b.days);
	return ranked.slice(0, limit).map(({ other }) => other);
}
