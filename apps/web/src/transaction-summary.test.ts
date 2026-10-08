import { describe, expect, it } from "vitest";
import { summaryAfterChange } from "./transaction-summary";

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

	it("one that waited in Review is one fewer once it is filed, split or deleted (issue 141)", () => {
		const waiting = { ...costco, waits: true };
		expect(summaryAfterChange(summary, waiting, { amountCents: costco.amountCents })).toEqual({
			...summary,
			needsReview: 0,
		});
		expect(summaryAfterChange(summary, waiting, null).needsReview).toBe(0);
		// A new name, or only who it is For, leaves it waiting.
		expect(summaryAfterChange(summary, waiting, { rename: "Costco run" })).toBe(summary);
		expect(summaryAfterChange(summary, waiting, { for: ["m1"] })).toBe(summary);
		// One that didn't wait changes nothing there.
		expect(summaryAfterChange(summary, costco, null).needsReview).toBe(1);
	});

	it("a side of a Transfer was never in Money out", () => {
		const side = { amountCents: 50_000, transfer: { from: "Checking", to: "Visa" } };
		expect(summaryAfterChange(summary, side, null)).toBe(summary);
	});

	it("leaves one partly in the other Parent's Personal Allowance to the server", () => {
		expect(summaryAfterChange(summary, { ...costco, partlyPrivate: true }, null)).toBe(summary);
	});
});
