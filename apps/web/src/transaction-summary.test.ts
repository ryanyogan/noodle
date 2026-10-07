import { describe, expect, it } from "vitest";
import { moneyInShown, monthSummary, summaryAfterChange } from "./transaction-summary";

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

describe("the list's figures at once after a change (issue 134)", () => {
	const summary = { outCents: 15_049, needsReview: 1 };
	const costco = { amountCents: 8_550, transfer: null };

	it("Money out takes an edited amount straight away", () => {
		expect(summaryAfterChange(summary, costco, { amountCents: 9_000 })).toEqual({
			outCents: 15_499,
			needsReview: 1,
		});
	});

	it("loses a deleted Transaction's amount", () => {
		expect(summaryAfterChange(summary, costco, null).outCents).toBe(6_499);
	});

	it("gives back what money back took off when it is deleted", () => {
		expect(
			summaryAfterChange(summary, { amountCents: -2_000, transfer: null }, null).outCents,
		).toBe(17_049);
	});

	it("a new name, or a refile at the same amount, moves nothing", () => {
		expect(summaryAfterChange(summary, costco, { rename: "Costco run" })).toBe(summary);
		expect(summaryAfterChange(summary, costco, { amountCents: 8_550 }).outCents).toBe(15_049);
	});

	it("a side of a Transfer was never in Money out", () => {
		const side = { amountCents: 50_000, transfer: { from: "Checking", to: "Visa" } };
		expect(summaryAfterChange(summary, side, null)).toBe(summary);
	});

	it("leaves one partly in the other Parent's Personal Allowance to the server", () => {
		expect(summaryAfterChange(summary, { ...costco, partlyPrivate: true }, null)).toBe(summary);
	});
});
