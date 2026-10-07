import { describe, expect, it } from "vitest";
import {
	asksWhichCard,
	cardNamedBy,
	cardPaymentFiled,
	cardPaymentIntro,
	cardPaymentRefused,
	commitmentNameFor,
	paymentAsSpending,
} from "./card-payments";
import { commitmentStart } from "./server/card-payments";

const accounts = [
	{ id: "chk", name: "Checking", kind: "checking" },
	{ id: "visa", name: "Visa", kind: "credit-card" },
	{ id: "apple", name: "Apple Card", kind: "credit-card" },
];

describe("asksWhichCard", () => {
	it("asks for a payment to a card Noodle doesn't follow whose wording names none of its cards", () => {
		const payment = { kind: "not-followed", card: null, accountId: null } as const;
		expect(asksWhichCard(payment, accounts)).toBe(true);
		// With no card in the Household either: the sheet asks whether it counts as spending.
		expect(asksWhichCard(payment, [])).toBe(true);
	});

	it("asks for a payment to a card Noodle follows when the wording doesn't say which", () => {
		expect(asksWhichCard({ kind: "followed", card: null }, accounts)).toBe(true);
		expect(asksWhichCard({ kind: "followed", card: "Amex" }, accounts)).toBe(true);
	});

	it("doesn't ask when the wording names one card in Noodle", () => {
		expect(asksWhichCard({ kind: "followed", card: "Visa" }, accounts)).toBe(false);
		const byHand = { kind: "not-followed", card: "Apple Card", accountId: "apple" } as const;
		expect(asksWhichCard(byHand, accounts)).toBe(false);
		expect(cardNamedBy(byHand, accounts)).toEqual({ id: "apple", name: "Apple Card" });
	});

	it("asks when the card the wording named is no longer an Account", () => {
		const gone = { kind: "not-followed", card: "Old card", accountId: "gone" } as const;
		expect(asksWhichCard(gone, accounts)).toBe(true);
	});

	it("doesn't ask for a line that isn't read as a card's payment, or one a Commitment pays", () => {
		expect(asksWhichCard(null, accounts)).toBe(false);
		expect(
			asksWhichCard(
				{
					kind: "commitment",
					commitmentId: "c",
					commitment: "Loan",
					accountId: "l",
					account: "Loan",
				},
				accounts,
			),
		).toBe(false);
	});
});

describe("what the toast says once a card payment is filed as spending", () => {
	const done = { label: "DISCOVER E-PAYMENT", commitment: "Discover", filed: 1, remembered: true };

	it("says the Commitment was made and the payment filed in it", () => {
		expect(cardPaymentFiled({ ...done, made: true })).toBe(
			"Discover is now a Commitment, and this payment is filed in it. Payments worded like it will be too.",
		);
		expect(cardPaymentFiled({ ...done, made: false, filed: 3 })).toBe(
			"DISCOVER E-PAYMENT filed in Discover, with 2 more worded like it. Payments worded like it will be too.",
		);
	});

	it("says plainly why a payment in a month that has ended stays as it is", () => {
		expect(cardPaymentFiled({ ...done, made: true, filed: 0, endedMonth: "2026-09" })).toBe(
			"Discover is now a Commitment. September has ended, so this payment stays as it is; later payments will be filed in Discover.",
		);
		expect(cardPaymentFiled({ ...done, made: true, filed: 2, endedMonth: "2026-09" })).toBe(
			"Discover is now a Commitment. September has ended, so this payment stays as it is; later payments will be filed in Discover. 2 payments worded like it since then are filed there now.",
		);
		expect(
			cardPaymentFiled({ ...done, made: true, filed: 0, remembered: false, endedMonth: "2026-01" }),
		).toBe("Discover is now a Commitment. January has ended, so this payment stays as it is.");
	});
});

describe("a payment counted as spending", () => {
	it("is its own Commitment: named from the wording, its amount, due on its day", () => {
		const answer = paymentAsSpending(
			{ id: "line", date: "2026-10-04", amountCents: 25_000 },
			"DISCOVER E-PAYMENT 4821",
		);
		expect(answer).toMatchObject({
			transactionId: "line",
			label: "DISCOVER E-PAYMENT 4821",
			commitment: { name: "Discover E-Payment 4821" },
			create: { month: "2026-10", amountCents: 25_000, dueDate: "2026-10-04" },
		});
		expect(answer.commitment.id).not.toBe(answer.ruleId);
		expect(commitmentNameFor("  ")).toBe("Card payment");
	});

	it("starts in the payment's month while that month is open", () => {
		expect(commitmentStart({ month: "2026-10", dueDate: "2026-10-04" }, "2026-10")).toEqual({
			month: "2026-10",
			dueDate: "2026-10-04",
			moved: false,
		});
	});

	it("starts this month, on the same day, when the payment's month has ended", () => {
		expect(commitmentStart({ month: "2026-09", dueDate: "2026-09-04" }, "2026-10")).toEqual({
			month: "2026-10",
			dueDate: "2026-10-04",
			moved: true,
		});
		// A day the running month doesn't have is its last day.
		expect(commitmentStart({ month: "2026-01", dueDate: "2026-01-31" }, "2026-02")).toMatchObject({
			dueDate: "2026-02-28",
		});
	});
});

describe("the words above “It’s a card payment”", () => {
	const transfer = { commitment: null };
	const spending = { commitment: { id: "c", name: "Apple Card" } };

	it("say the payment isn't spending only when that is so for every card", () => {
		expect(cardPaymentIntro([transfer, transfer])).toContain("isn’t spending");
	});

	it("never say it isn't spending above a card whose payment is the spending", () => {
		for (const cards of [[spending], [transfer, spending], []]) {
			expect(cardPaymentIntro(cards)).not.toContain("isn’t spending");
			expect(cardPaymentIntro(cards)).toContain("is the spending");
		}
		expect(cardPaymentIntro(undefined)).toBe("Looks like a card payment.");
	});
});

describe("what the toast says when a card payment couldn't be filed", () => {
	it("says why when the Commitment isn't in the payment's month", () => {
		expect(
			cardPaymentRefused({ label: "APPLECARD", commitment: "Apple Card", notInPlan: "2026-08" }),
		).toBe("Apple Card isn’t in August’s Plan, so APPLECARD can’t be filed in it.");
	});

	it("says only that it couldn't otherwise", () => {
		expect(cardPaymentRefused({ label: "APPLECARD", commitment: "Apple Card" })).toBe(
			"Couldn’t file APPLECARD in Apple Card.",
		);
	});
});

describe("a payment made a Commitment for a card that is an Account here", () => {
	it("pays that Account down, and nothing when the card isn't in Noodle", () => {
		const line = { id: "t", date: "2026-10-03", amountCents: 12_000 };
		expect(paymentAsSpending(line, "DISCOVER", "acct").create.paysDown).toBe("acct");
		expect(paymentAsSpending(line, "DISCOVER", null).create).not.toHaveProperty("paysDown");
	});
});
