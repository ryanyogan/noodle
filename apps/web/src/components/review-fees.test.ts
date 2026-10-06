import { describe, expect, it } from "vitest";
import { feesGuess, feesRuleFor, isFeesGuess, NEW_FEES_BUCKET, newFeesBucket } from "./review-fees";

// Review's offer for a fee or interest (issue 137).

const card = (merchant: string, amountCents = 3_500, note = "") => ({
	note,
	merchant,
	merchantName: null,
	amountCents,
});
const groceries = {
	id: "groceries",
	name: "Groceries",
	color: 1,
	allowance: 60_000,
	rolling: false,
};
const fees = { id: "fees", name: "fees and interest", color: 2, allowance: 0, rolling: false };
const plan = (...buckets: (typeof groceries)[]) => ({ buckets });

describe("a fee or interest card's suggestion", () => {
	it("is the Plan's Fees and interest Bucket, whatever its capitals", () => {
		expect(feesGuess(card("OVERDRAFT FEE"), plan(groceries, fees), true)).toEqual({
			bucketId: "fees",
			name: "fees and interest",
			confidence: null,
			method: null,
			reason: "Looks like a fee from your bank or card",
		});
	});

	it("is one to add when the Plan has none, and says so", () => {
		const guess = feesGuess(card("INTEREST CHARGE ON PURCHASES"), plan(groceries), true);
		expect(guess).toMatchObject({
			bucketId: NEW_FEES_BUCKET,
			name: "Fees and interest",
			reason: "Looks like interest you were charged · adds the Bucket to your Plan",
		});
		expect(isFeesGuess(guess)).toBe(true);
	});

	it("reads the bank's own wording in the note before the merchant", () => {
		expect(feesGuess(card("Chase", 1_200, "MONTHLY SERVICE FEE"), plan(fees), true)).not.toBeNull();
	});

	it("is not made for a month that is over with no such Bucket, though one there is still used", () => {
		expect(feesGuess(card("OVERDRAFT FEE"), plan(groceries), false)).toBeNull();
		expect(feesGuess(card("OVERDRAFT FEE"), plan(fees), false)?.bucketId).toBe("fees");
	});

	it("is not made for money in, an ordinary purchase, or before the Plan is read", () => {
		expect(feesGuess(card("OVERDRAFT FEE", -3_500), plan(fees), true)).toBeNull();
		expect(feesGuess(card("COFFEE HOUSE"), plan(fees), true)).toBeNull();
		expect(feesGuess(card("OVERDRAFT FEE"), undefined, true)).toBeNull();
	});

	it("is not made when a Commitment already has the name: no Bucket is put beside it", () => {
		const commitments = [{ name: "Fees and Interest" }];
		expect(feesGuess(card("OVERDRAFT FEE"), { ...plan(groceries), commitments }, true)).toBeNull();
		expect(feesGuess(card("OVERDRAFT FEE"), { ...plan(fees), commitments }, true)).toBeNull();
	});

	it("is never a Parent's Personal Allowance of that name", () => {
		const own = { ...fees, owner: "alex" };
		expect(feesGuess(card("OVERDRAFT FEE"), plan(own), true)?.bucketId).toBe(NEW_FEES_BUCKET);
	});
});

describe("telling the offer from any other suggestion", () => {
	it("knows its own, and no guess from a Rule, a similar merchant or the model", () => {
		expect(isFeesGuess(null)).toBe(false);
		const guess = feesGuess(card("LATE FEE"), plan(fees), true);
		expect(isFeesGuess(guess)).toBe(true);
		expect(isFeesGuess(guess && { ...guess, method: "model" as never })).toBe(false);
		expect(isFeesGuess(guess && { ...guess, reason: "You filed it here before" })).toBe(false);
	});
});

describe("what Confirm makes", () => {
	it("a Bucket that resets monthly with no allowance", () => {
		expect(newFeesBucket("id", 4)).toEqual({
			id: "id",
			name: "Fees and interest",
			color: 4,
			allowance: 0,
			rolling: false,
		});
	});

	it("a Rule for the charge, without what this one was for", () => {
		expect(feesRuleFor({ merchant: "overdraft fee for a item details shell oil" })).toBe(
			"overdraft fee",
		);
	});
});
