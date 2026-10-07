import { describe, expect, it } from "vitest";
import { commitmentsPaid } from "./commitments";
import { bucketSpentText, owedBackOnCommitmentText, paidBackIntoText } from "./owed-back";

describe("a Commitment with Owed back", () => {
	it("reads how far over it is and who owes that back", () => {
		expect(owedBackOnCommitmentText(60_000, { left: 60_000, who: ["Casey"] })).toBe(
			"$600 over · $600 owed back by Casey",
		);
	});

	it("names everyone who owes, and leaves 'over' out when it isn't", () => {
		expect(owedBackOnCommitmentText(0, { left: 12_500, who: ["Casey", "Sam"] })).toBe(
			"$125 owed back by Casey and Sam",
		);
		expect(owedBackOnCommitmentText(-500, { left: 2_500, who: ["Casey"] })).toBe(
			"$25 owed back by Casey",
		);
	});

	it("says nothing once nothing is owed back", () => {
		expect(owedBackOnCommitmentText(60_000, null)).toBeNull();
		expect(owedBackOnCommitmentText(60_000, { left: 0, who: [] })).toBeNull();
	});
});

describe("money Paid back this month", () => {
	it("says how much came back into a Commitment and from whom", () => {
		expect(paidBackIntoText({ amount: 60_000, who: ["Casey"] })).toBe("$600 Paid back by Casey");
		expect(paidBackIntoText({ amount: 62_500, who: ["Casey", "Sam"] })).toBe(
			"$625 Paid back by Casey and Sam",
		);
		expect(paidBackIntoText({ amount: 4_500, who: [] })).toBe("$45 Paid back");
		expect(paidBackIntoText(undefined)).toBeNull();
	});

	it("says a Bucket's month below zero as money Paid back, not as negative spending", () => {
		expect(bucketSpentText({ spent: -4_500, paidBack: 4_500 })).toBe("$45 Paid back");
		expect(bucketSpentText({ spent: -2_000, paidBack: 4_500 })).toBe(
			"$20 more Paid back than spent",
		);
		expect(bucketSpentText({ spent: 1_000, paidBack: 4_500 })).toBe("$10 spent");
		expect(bucketSpentText({ spent: 12_000 })).toBe("$120 spent");
		// A Refund linked to its purchase is "refunded": "Paid back" is what was Owed back.
		expect(bucketSpentText({ spent: -2_000, paidBack: 2_000, refunded: 2_000 })).toBe(
			"$20 refunded",
		);
		expect(bucketSpentText({ spent: -1_500, paidBack: 2_000, refunded: 2_000 })).toBe(
			"$15 more refunded than spent",
		);
		expect(bucketSpentText({ spent: -6_500, paidBack: 6_500, refunded: 2_000 })).toBe(
			"$20 refunded and $45 Paid back",
		);
		expect(bucketSpentText({ spent: -1_000, paidBack: 6_500, refunded: 2_000 })).toBe(
			"$10 more refunded and Paid back than spent",
		);
		expect(bucketSpentText({ spent: 1_000, paidBack: 2_000, refunded: 2_000 })).toBe("$10 spent");
		expect(paidBackIntoText({ amount: 2_000, who: [], refunded: 2_000 })).toBe("$20 refunded");
		expect(paidBackIntoText({ amount: 62_000, who: ["Casey"], refunded: 2_000 })).toBe(
			"$600 Paid back by Casey and $20 refunded",
		);
		// A Refund alone can bring a month below zero too: that stays as it was.
		expect(bucketSpentText({ spent: -3_000 })).toBe("−$30 spent");
		expect(bucketSpentText({ spent: -7_500, paidBack: 4_500 })).toBe("−$75 spent");
	});
});

describe("what the month's Bills have been paid", () => {
	const bill = (over: object) =>
		({
			actual: 0,
			expected: 60_000,
			difference: 0,
			charges: 0,
			dueDates: ["2026-10-05"],
			...over,
		}) as never;

	it("leaves money Paid back out of what was paid, and says it beside it", () => {
		expect(
			commitmentsPaid([
				bill({
					actual: -60_000,
					difference: -60_000,
					paidBack: { amount: 60_000, who: ["Casey"] },
				}),
				bill({ actual: 10_000, expected: 10_000, charges: 1 }),
			]),
		).toBe("$100 of $700 paid · $600 Paid back");
		expect(commitmentsPaid([bill({ actual: 60_000, charges: 1 })])).toBe("$600 of $600 paid");
		expect(commitmentsPaid([])).toBeNull();
	});
});
