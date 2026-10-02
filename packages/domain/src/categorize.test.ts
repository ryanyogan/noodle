import { describe, expect, it } from "vitest";
import {
	AUTO_FILE_CONFIDENCE,
	decideCategorization,
	merchantKey,
	ruleFor,
	SIMILAR_GUESS_SCORE,
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

	it("prefers a Parent's private Rule over the Household's for the same pattern", () => {
		const both = [
			{ pattern: "amazon", bucketId: "shopping" },
			{ pattern: "amazon", bucketId: "alex-pa", private: true },
		];
		expect(ruleFor(both, "amazon mktp")?.bucketId).toBe("alex-pa");
		expect(ruleFor([...both].reverse(), "amazon mktp")?.bucketId).toBe("alex-pa");
		// A longer pattern still wins.
		expect(
			ruleFor([...both, { pattern: "amazon mktp", bucketId: "home" }], "amazon mktp")?.bucketId,
		).toBe("home");
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
		).toEqual({ outcome: "filed", method: "rule", bucketId: "groceries", confidence: 1, for: [] });
	});

	it("files by a Rule For whoever it says", () => {
		expect(
			decideCategorization({ rule: { pattern: "lego", bucketId: "fun", for: ["maya", "theo"] } }),
		).toMatchObject({ outcome: "filed", method: "rule", bucketId: "fun", for: ["maya", "theo"] });
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
			decideCategorization({
				model: { bucketId: "gas", confidence: AUTO_FILE_CONFIDENCE - 0.1, why: "a gas station" },
			}),
		).toEqual({
			outcome: "review",
			method: "model",
			bucketId: "gas",
			confidence: AUTO_FILE_CONFIDENCE - 0.1,
			reason: "a gas station",
		});
		const none = {
			outcome: "review",
			method: "none",
			bucketId: null,
			confidence: null,
			reason: null,
		};
		expect(decideCategorization({ model: { bucketId: null, confidence: 0.9 } })).toEqual(none);
		expect(decideCategorization({})).toEqual(none);
	});

	it("keeps a merchant alike but not alike enough to file as a guess, above a floor", () => {
		const similar = { bucketId: "fun", score: SIMILAR_GUESS_SCORE, merchant: "netflix" };
		expect(decideCategorization({ similar })).toEqual({
			outcome: "review",
			method: "similar",
			bucketId: "fun",
			confidence: SIMILAR_GUESS_SCORE,
			reason: "netflix",
		});
		expect(
			decideCategorization({ similar: { ...similar, score: SIMILAR_GUESS_SCORE - 0.01 } }),
		).toMatchObject({ method: "none", bucketId: null });
		// The model's own guess about this merchant comes before another merchant's Bucket.
		expect(
			decideCategorization({ similar, model: { bucketId: "gas", confidence: 0.5 } }),
		).toMatchObject({ outcome: "review", method: "model", bucketId: "gas" });
		// It's never filed by a guess, however the two agree.
		expect(
			decideCategorization({ similar, model: { bucketId: "fun", confidence: 0.79 } }),
		).toMatchObject({ outcome: "review" });
	});
});
