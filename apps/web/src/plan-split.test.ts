import { describe, expect, test } from "vitest";
import {
	barWidths,
	freeToSpendAfter,
	MIN_WIDTH,
	planSplit,
	shareText,
	splitSentence,
	wholeShares,
	withDraftAllowances,
} from "./plan-split";

const sum = (list: number[]) => list.reduce((total, n) => total + n, 0);

const parts = (commitments: number, buckets: number, goals = 0) => [
	{ key: "commitments", label: "Commitments", amount: commitments },
	{ key: "buckets", label: "Buckets", amount: buckets },
	{ key: "goal-funding", label: "Goal funding", amount: goals },
];

describe("shares of take-home pay", () => {
	test("add up to exactly 100, whatever the rounding", () => {
		expect(wholeShares([1, 1, 1])).toEqual([34, 33, 33]);
		expect(sum(wholeShares([333_333, 333_333, 333_334]))).toBe(100);
		expect(sum(wholeShares([123_456, 7, 987_654, 55_555, 1]))).toBe(100);
	});

	test("are all zero when there is nothing to share out", () => {
		expect(wholeShares([0, 0])).toEqual([0, 0]);
		expect(wholeShares([-500, 0])).toEqual([0, 0]);
	});
});

describe("how long each part of the bar is drawn", () => {
	test("in proportion, adding up to the whole bar", () => {
		expect(barWidths([50, 25, 25])).toEqual([50, 25, 25]);
		expect(sum(barWidths([240_000, 160_000, 25_000, 475_000]))).toBeCloseTo(100);
	});

	test("a tiny part is still wide enough to see, and the others give up the room", () => {
		const widths = barWidths([899_000, 500, 500]);
		expect(widths[1]).toBe(MIN_WIDTH);
		expect(widths[2]).toBe(MIN_WIDTH);
		expect(widths[0]).toBeCloseTo(100 - 2 * MIN_WIDTH);
		expect(sum(widths)).toBeCloseTo(100);
	});

	test("a part with nothing in it has no length", () => {
		expect(barWidths([0, 100, 0])).toEqual([0, 100, 0]);
		expect(barWidths([0, 0])).toEqual([0, 0]);
	});
});

describe("where take-home pay goes", () => {
	test("the Plan's parts, then Free to Spend, as parts of one whole", () => {
		const split = planSplit({ income: 900_000, parts: parts(240_000, 355_000, 25_000) });
		expect(split.planned).toBe(620_000);
		expect(split.left).toBe(280_000);
		expect(split.overBy).toBe(0);
		expect(split.reach).toBeNull();
		expect(split.parts.map((p) => p.share)).toEqual([27, 39, 3]);
		expect(split.free.share).toBe(31);
		expect(sum([...split.parts, split.free].map((p) => p.share ?? 0))).toBe(100);
		expect(sum([...split.parts, split.free].map((p) => p.width))).toBeCloseTo(100);
		expect(splitSentence(split)).toBe(
			"$6,200 of your $9,000 take-home pay is planned. $2,800 is Free to Spend.",
		);
	});

	test("a tiny part is drawn wider than it is, but its row doesn't say so", () => {
		const split = planSplit({ income: 900_000, parts: parts(500, 0) });
		const [commitments] = split.parts;
		expect(commitments?.width).toBe(MIN_WIDTH);
		expect(commitments?.share).toBe(0);
		expect(commitments && shareText(commitments)).toBe("<1%");
		expect(shareText(split.free)).toBe("100%");
		// A part with nothing in it says 0%, not "<1%".
		expect(split.parts[1] && shareText(split.parts[1])).toBe("0%");
	});

	test("more planned than take-home pay: the bar is what's planned, and the pay stops short", () => {
		const split = planSplit({ income: 900_000, parts: parts(40_000, 880_000) });
		expect(split.left).toBe(-20_000);
		expect(split.overBy).toBe(20_000);
		expect(split.free.width).toBe(0);
		expect(split.free.share).toBeNull();
		expect(shareText(split.free)).toBe("");
		expect(sum(split.parts.map((p) => p.width))).toBeCloseTo(100);
		// Shares stay shares of the pay, so they add up to more than 100.
		expect(split.parts.map((p) => p.share)).toEqual([4, 98, 0]);
		expect(split.reach?.within).toBeCloseTo((900_000 / 920_000) * 100);
		expect(split.reach?.over).toBeCloseTo((20_000 / 920_000) * 100);
		expect(splitSentence(split)).toBe(
			"$9,200 is planned, $200 more than your $9,000 take-home pay.",
		);
	});

	test("take-home pay of zero: nothing to draw, and no shares", () => {
		const nothing = planSplit({ income: 0, parts: parts(0, 0) });
		expect([...nothing.parts, nothing.free].map((p) => p.width)).toEqual([0, 0, 0, 0]);
		expect([...nothing.parts, nothing.free].map((p) => p.share)).toEqual([null, null, null, null]);
		const over = planSplit({ income: 0, parts: parts(0, 50_000) });
		expect(over.overBy).toBe(50_000);
		expect(over.parts.map((p) => p.share)).toEqual([null, null, null]);
		expect(over.reach).toEqual({ within: 0, over: 100 });
	});

	test("take-home pay not set: amounts only", () => {
		const split = planSplit({ income: null, parts: parts(100_000, 0) });
		expect(split.parts.map((p) => [p.share, p.width])).toEqual([
			[null, 0],
			[null, 0],
			[null, 0],
		]);
		expect(splitSentence(split)).toContain("isn’t set");
	});

	test("Free to Spend is the month's own figure when it is given", () => {
		// $500 of Extra income went to Free to Spend: the whole is the pay plus that.
		const split = planSplit({ income: 950_000, parts: parts(240_000, 360_000), left: 350_000 });
		expect(split.free.amount).toBe(350_000);
		expect(sum([...split.parts, split.free].map((p) => p.share ?? 0))).toBe(100);
		expect(splitSentence(split, 50_000)).toBe(
			"$6,000 of the $9,500 you have this month (take-home pay plus $500 Extra income) is planned. $3,500 is Free to Spend.",
		);
	});

	test("the sentence when nothing, or everything, is planned", () => {
		expect(splitSentence(planSplit({ income: 900_000, parts: parts(0, 0) }))).toBe(
			"Nothing is planned yet: all of your $9,000 take-home pay is Free to Spend.",
		);
		expect(splitSentence(planSplit({ income: 900_000, parts: parts(400_000, 500_000) }))).toBe(
			"All of your $9,000 take-home pay is planned. Nothing is left as Free to Spend.",
		);
	});
});

describe("allowances being typed in a Bucket's sheet", () => {
	const month = {
		baseline: 600000,
		freeToSpend: 440000,
		buckets: [
			{ id: "groceries", name: "Groceries", allowance: 120000 },
			{ id: "hockey", name: "Hockey", allowance: 40000 },
		],
	};

	test("puts the typed allowance in place of the saved one and takes the difference from Free to Spend", () => {
		const typed = withDraftAllowances(month, { hockey: 50000 });
		expect(typed.buckets.map((b) => b.allowance)).toEqual([120000, 50000]);
		expect(typed.freeToSpend).toBe(430000);
		// Everything else is the month's own, and the month itself is not changed.
		expect(typed.baseline).toBe(600000);
		expect(typed.buckets[0]).toBe(month.buckets[0]);
		expect(month.buckets[1]?.allowance).toBe(40000);
		expect(month.freeToSpend).toBe(440000);
	});

	test("gives money back when an allowance is lowered, and goes below zero when too much is typed", () => {
		expect(withDraftAllowances(month, { groceries: 0 }).freeToSpend).toBe(560000);
		expect(withDraftAllowances(month, { groceries: 600000 }).freeToSpend).toBe(-40000);
		expect(withDraftAllowances(month, { groceries: 100000, hockey: 70000 }).freeToSpend).toBe(
			430000,
		);
	});

	test("is the very same month with nothing typed, the saved amount typed, or a Bucket it doesn't have", () => {
		expect(withDraftAllowances(month, {})).toBe(month);
		expect(withDraftAllowances(month, { hockey: 40000 })).toBe(month);
		expect(withDraftAllowances(month, { gone: 99900 })).toBe(month);
		expect(withDraftAllowances(month, { hockey: Number.NaN })).toBe(month);
	});

	test("keeps the split's parts and Free to Spend adding up to the pay", () => {
		const typed = withDraftAllowances(month, { hockey: 90000 });
		const buckets = typed.buckets.reduce((sum, b) => sum + b.allowance, 0);
		const split = planSplit({
			income: typed.baseline,
			parts: [{ key: "buckets", label: "Buckets", amount: buckets }],
			left: typed.freeToSpend,
		});
		expect(split.planned + split.left).toBe(600000);
		expect(split.parts[0]?.amount).toBe(210000);
		expect(split.free.amount).toBe(390000);
	});

	test("says in the sheet what Free to Spend will be, only once the amount differs", () => {
		expect(freeToSpendAfter(440000, 40000, 50000)).toBe(430000);
		expect(freeToSpendAfter(440000, 40000, 0)).toBe(480000);
		expect(freeToSpendAfter(440000, 40000, 500000)).toBe(-20000);
		expect(freeToSpendAfter(440000, 40000, 40000)).toBeNull();
		expect(freeToSpendAfter(440000, 40000, null)).toBeNull();
	});
});
