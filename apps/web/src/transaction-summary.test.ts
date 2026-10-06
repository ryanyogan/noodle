import { describe, expect, it } from "vitest";
import { moneyInShown, monthSummary } from "./transaction-summary";

const line = (
	amount: number,
	kind: Parameters<typeof monthSummary>[0][number]["kind"],
	needsReview = false,
) => ({
	amount,
	kind,
	needsReview,
});

describe("the month's summary", () => {
	it("adds up Income, Refunds and Paid back as money in", () => {
		const lines = [line(500_000, "income"), line(2_499, "refund"), line(30_000, "paid-back")];
		expect(monthSummary(lines, { outCents: 120_000, needsReview: 0 })).toEqual({
			inCents: 532_499,
			outCents: 120_000,
			needsReview: 0,
		});
	});

	it("leaves out a Transfer and Between us: the Household's own money moving", () => {
		const lines = [line(500_000, "income"), line(40_000, "transfer"), line(10_000, "between-us")];
		expect(monthSummary(lines, null).inCents).toBe(500_000);
	});

	it("counts a line that waits in Review as needing review, not as money in", () => {
		const lines = [line(500_000, "income"), line(30_000, "income", true)];
		expect(monthSummary(lines, { outCents: 0, needsReview: 2 })).toEqual({
			inCents: 500_000,
			outCents: 0,
			needsReview: 3,
		});
	});

	it("is all zero for an empty month, and while the list loads", () => {
		expect(monthSummary([], undefined)).toEqual({ inCents: 0, outCents: 0, needsReview: 0 });
	});
});

describe("the money in listed under a filter", () => {
	const lines = [line(500_000, "income"), line(30_000, "income", true), line(40_000, "transfer")];
	it("is all of it with no filter or with Money in", () => {
		expect(moneyInShown(lines, undefined)).toEqual(lines);
		expect(moneyInShown(lines, "in")).toEqual(lines);
	});
	it("is none of it with Money out, and only what waits with Needs review", () => {
		expect(moneyInShown(lines, "out")).toEqual([]);
		expect(moneyInShown(lines, "review")).toEqual([lines[1]]);
	});
});
