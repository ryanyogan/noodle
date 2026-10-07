import { describe, expect, it } from "vitest";
import { asksWhichCard, cardNamedBy } from "./card-payments";

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
