import { describe, expect, it } from "vitest";
import { cardPaymentCardsOf } from "./transfers";

// What "It's a card payment" offers for each of the Household's cards: how the card's purchases get
// into Noodle, by whether a Commitment pays it down.
const card = (
	purchases: "statements" | "hand" | "none" | null,
	bankConnectionId: string | null,
) => ({
	id: "apple",
	name: "Apple Card",
	purchases,
	bankConnectionId,
});
const bill = { id: "bill", name: "Apple Card bill", accountId: "apple" };
const other = { id: "rent", name: "Rent", accountId: null };
const filedIn = { id: "bill", name: "Apple Card bill" };

describe("the cards “It’s a card payment” offers", () => {
	it.each([
		// kept, the card, followed lately, a Commitment pays it down, where its payment is filed
		["bank", card("hand", "conn"), false, true, null],
		["bank", card(null, "conn"), false, false, null],
		["statements", card("statements", null), false, true, null],
		["statements", card("statements", null), false, false, null],
		// Not asked, but a statement's purchases came in lately: by statements.
		["statements", card(null, null), true, true, null],
		["statements", card(null, null), true, false, null],
		["hand", card("hand", null), false, true, filedIn],
		["hand", card("hand", null), false, false, null],
		// Kept by hand whatever a stray statement says.
		["hand", card("hand", null), true, true, filedIn],
		["none", card("none", null), false, true, filedIn],
		["none", card("none", null), false, false, null],
		// Not asked and not followed: a Household from before the question.
		[null, card(null, null), false, true, filedIn],
		[null, card(null, null), false, false, null],
	] as const)(
		"kept %s (%o, followed %s, paid down %s)",
		(kept, account, followed, paidDown, commitment) => {
			expect(
				cardPaymentCardsOf(
					[account],
					followed ? ["apple"] : [],
					paidDown ? [other, bill] : [other],
				),
			).toEqual([{ id: "apple", name: "Apple Card", kept, commitment }]);
		},
	);

	it("gives each card its own Commitment, and none to a card another one pays down", () => {
		const cards = [card("hand", null), { ...card("hand", null), id: "visa", name: "Visa" }];
		expect(cardPaymentCardsOf(cards, [], [bill]).map((each) => each.commitment)).toEqual([
			filedIn,
			null,
		]);
	});
});
