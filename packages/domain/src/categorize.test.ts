import { describe, expect, it } from "vitest";
import {
	AUTO_FILE_CONFIDENCE,
	decideCategorization,
	merchantKey,
	ruleFor,
	SIMILAR_MERCHANT_SCORE,
} from "./index";

describe("merchantKey: a statement line reduced to its merchant", () => {
	it.each([
		["COSTCO WHSE #0123 SEATTLE WA", "costco whse seattle"],
		["Costco Whse 0456", "costco whse"],
		["SHELL OIL 57442113 HOUSTON TX", "shell oil houston"],
		["NETFLIX.COM", "netflix"],
		["SQ *BLUE BOTTLE COFFEE", "blue bottle coffee"],
		["TST* CHIPOTLE 1234", "chipotle"],
		["POS DEBIT PURCHASE TARGET T-1234 09/12", "target"],
		["AMZN Mktp US*2K4AB1", "amzn mktp us"],
	])("%s → %s", (description, key) => {
		expect(merchantKey(description)).toBe(key);
	});

	it("is never empty for a line that is only numbers", () => {
		expect(merchantKey("12345")).toBe("12345");
	});
});

describe("ruleFor: the Rule matching a merchant", () => {
	const rules = [
		{ pattern: "costco", bucketId: "groceries" },
		{ pattern: "costco gas", bucketId: "gas" },
		{ pattern: "shell", bucketId: "gas" },
	];

	it("matches whole words, longest pattern first", () => {
		expect(ruleFor(rules, "costco whse seattle")?.bucketId).toBe("groceries");
		expect(ruleFor(rules, "costco gas kirkland")?.bucketId).toBe("gas");
		expect(ruleFor(rules, "seashells by the shore")).toBeUndefined();
	});
});

describe("decideCategorization: Rules, then similar merchants, then the model", () => {
	const rule = { pattern: "costco", bucketId: "groceries" };

	it("files by a Rule over anything learned or modelled", () => {
		expect(
			decideCategorization({
				rule,
				similar: { bucketId: "fun", score: 0.99 },
				model: { bucketId: "gas", confidence: 0.99 },
			}),
		).toEqual({ outcome: "filed", method: "rule", bucketId: "groceries", confidence: 1 });
	});

	it("files by a similar merchant over the model, only when alike enough", () => {
		const model = { bucketId: "gas", confidence: 0.95 };
		expect(
			decideCategorization({ similar: { bucketId: "fun", score: SIMILAR_MERCHANT_SCORE }, model }),
		).toMatchObject({ outcome: "filed", method: "similar", bucketId: "fun" });
		expect(
			decideCategorization({
				similar: { bucketId: "fun", score: SIMILAR_MERCHANT_SCORE - 0.01 },
				model,
			}),
		).toMatchObject({ outcome: "filed", method: "model", bucketId: "gas" });
	});

	it("leaves an unsure guess for Review, keeping the guess", () => {
		expect(
			decideCategorization({ model: { bucketId: "gas", confidence: AUTO_FILE_CONFIDENCE - 0.1 } }),
		).toEqual({ outcome: "review", bucketId: "gas", confidence: AUTO_FILE_CONFIDENCE - 0.1 });
		expect(decideCategorization({ model: { bucketId: null, confidence: 0.9 } })).toEqual({
			outcome: "review",
			bucketId: null,
			confidence: null,
		});
		expect(decideCategorization({})).toEqual({
			outcome: "review",
			bucketId: null,
			confidence: null,
		});
	});
});
