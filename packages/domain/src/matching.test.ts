import { describe, expect, it } from "vitest";
import {
	autoMatches,
	clearPairs,
	type DayKey,
	type MatchSide,
	merchantSimilarity,
	possibleMatches,
} from "./index";

const side = (id: string, date: DayKey, amount: number, text: string | null = null): MatchSide => ({
	id,
	date,
	amount,
	text,
});

describe("merchantSimilarity: how much of a note names the merchant in a bank description", () => {
	it("finds the note's words in the description, ignoring case, spacing and noise", () => {
		expect(merchantSimilarity("Starbucks", "SQ *STARBUCKS #1234")).toBe(1);
		expect(merchantSimilarity("whole foods", "WHOLEFDS MKT 10234")).toBe(0.5);
		expect(merchantSimilarity("Target run", "TARGET 00012345 AUSTIN TX")).toBe(0.5);
		expect(merchantSimilarity("Costco", "POS PURCHASE COSTCO WHSE")).toBe(1);
	});

	it("is 0 with no note, or a note naming nothing in it", () => {
		expect(merchantSimilarity(null, "STARBUCKS")).toBe(0);
		expect(merchantSimilarity("coffee", "STARBUCKS")).toBe(0);
		expect(merchantSimilarity("the card", "STARBUCKS")).toBe(0);
	});
});

describe("clearPairs: pairs where each side is the other's clear best", () => {
	const score = (a: { id: string }, b: { id: string }) => (a.id[0] === b.id[0] ? 1 : null);

	it("pairs single candidates and leaves ties unpaired", () => {
		const lefts = [{ id: "a1" }, { id: "b1" }];
		const rights = [{ id: "a2" }, { id: "b2" }, { id: "b3" }];
		expect(clearPairs(lefts, rights, score)).toEqual([[{ id: "a1" }, { id: "a2" }]]);
	});
});

describe("autoMatches: Quick Adds paired with their imported bank copies", () => {
	it("Matches an equal amount within the window", () => {
		const quickAdd = side("q", "2026-09-10", 1250, "coffee");
		const bank = side("i", "2026-09-12", 1250, "SQ *BLUE BOTTLE");
		expect(autoMatches([quickAdd], [bank])).toEqual([{ quickAddId: "q", importedId: "i" }]);
	});

	it("allows the bank a day early and five days late, not more", () => {
		const q = side("q", "2026-09-10", 500);
		expect(autoMatches([q], [side("i", "2026-09-09", 500)])).toHaveLength(1);
		expect(autoMatches([q], [side("i", "2026-09-15", 500)])).toHaveLength(1);
		expect(autoMatches([q], [side("i", "2026-09-08", 500)])).toEqual([]);
		expect(autoMatches([q], [side("i", "2026-09-16", 500)])).toEqual([]);
	});

	it("never Matches different amounts, even by a cent", () => {
		const bank = side("i", "2026-09-10", 4001);
		expect(autoMatches([side("q", "2026-09-10", 4000)], [bank])).toEqual([]);
	});

	it("leaves two equally good candidates for a Parent", () => {
		const bank = [
			side("i1", "2026-09-10", 500, "PARKING"),
			side("i2", "2026-09-11", 500, "PARKING"),
		];
		expect(autoMatches([side("q", "2026-09-10", 500, "coffee")], bank)).toEqual([]);
		// And the same from the other side: two Quick Adds, one bank copy.
		const quickAdds = [side("q1", "2026-09-10", 500), side("q2", "2026-09-10", 500)];
		expect(autoMatches(quickAdds, [side("i", "2026-09-11", 500)])).toEqual([]);
	});

	it("lets the merchant text break a tie", () => {
		const quickAdds = [
			side("q1", "2026-09-10", 500, "Starbucks"),
			side("q2", "2026-09-10", 500, "parking"),
		];
		const bank = [
			side("i1", "2026-09-11", 500, "STARBUCKS 123"),
			side("i2", "2026-09-11", 500, "CITY PARKING"),
		];
		expect(autoMatches(quickAdds, bank)).toEqual([
			{ quickAddId: "q1", importedId: "i1" },
			{ quickAddId: "q2", importedId: "i2" },
		]);
	});

	it("never re-Matches a pair a Parent unmatched", () => {
		const refused = (q: string, i: string) => q === "q" && i === "i";
		const bank = side("i", "2026-09-10", 500);
		expect(autoMatches([side("q", "2026-09-10", 500)], [bank], refused)).toEqual([]);
	});
});

describe("possibleMatches: what a Parent might Match by hand", () => {
	it("offers amounts up to a 30% tip apart within the window, equal amounts first", () => {
		const q = side("q", "2026-09-10", 4000, "Dinner at Nopa");
		const bank = [
			side("tip", "2026-09-11", 4800, "NOPA SF"),
			side("same", "2026-09-12", 4000, "SHELL OIL"),
			side("far", "2026-09-11", 6000, "NOPA SF"),
			side("late", "2026-09-20", 4000, "NOPA SF"),
		];
		expect(possibleMatches(q, bank, true).map((s) => s.id)).toEqual(["same", "tip"]);
	});

	it("offers a different amount only at the same merchant, and at most three", () => {
		// The Costco Quick Add from the desktop review: similar-sized spending elsewhere isn't it.
		const q = side("q", "2026-09-29", 5653, "Costco");
		const bank = [
			side("heb", "2026-09-29", 6231, "H-E-B #512 AUSTIN TX"),
			side("books", "2026-09-30", 4087, "BOOKPEOPLE AUSTIN"),
			side("shell", "2026-09-29", 4410, "SHELL OIL 5744"),
			side("kroger", "2026-09-30", 6412, "KROGER #221"),
			side("costco", "2026-10-01", 6120, "COSTCO WHSE #1042"),
		];
		expect(possibleMatches(q, bank, true).map((s) => s.id)).toEqual(["costco"]);
		// With no note, only an equal amount can be it.
		expect(possibleMatches({ ...q, text: null }, bank, true)).toEqual([]);
		const equal = ["a", "b", "c", "d"].map((id, i) =>
			side(id, `2026-09-${29 + (i % 2)}` as DayKey, 5653, "PARKING"),
		);
		expect(possibleMatches(q, equal, true)).toHaveLength(3);
	});

	it("works from the imported side too", () => {
		const bank = side("i", "2026-09-12", 4800, "NOPA SF");
		const quickAdds = [
			side("q1", "2026-09-10", 4000, "nopa"),
			side("q2", "2026-09-06", 4000, "nopa"),
		];
		expect(possibleMatches(bank, quickAdds, false).map((s) => s.id)).toEqual(["q1"]);
	});
});
