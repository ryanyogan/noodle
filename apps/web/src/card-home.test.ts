import { describe, expect, it } from "vitest";
import { keptOf, payingBrief, payingWhole, waitingCardPayments } from "./card-home";

const card = (
	id: string,
	name: string,
	over: Partial<Parameters<typeof keptOf>[0]> = {},
): Parameters<typeof keptOf>[0] => ({
	id,
	name,
	kind: "credit-card",
	bankConnectionId: null,
	purchases: null,
	lastStatementDate: null,
	...over,
});
const today = "2026-10-07";

describe("how paying a card counts", () => {
	it("reads a card kept by hand and one nobody was asked about differently", () => {
		const byHand = keptOf(card("apple", "Apple Card", { purchases: "hand" }), today);
		const unsaid = keptOf(card("store", "Store card"), today);
		expect(payingBrief(byHand)).toBe("You add its purchases");
		expect(payingBrief(unsaid)).toBe("Not said yet how its purchases get in");
	});

	it("says a Transfer for every card whose purchases are in Noodle, and spending only when they aren't", () => {
		expect(payingWhole("bank", "Chase")).toBe(
			"Its purchases come from Chase, so paying it is a Transfer, not spending.",
		);
		expect(payingWhole("statements", null)).toContain("paying it is a Transfer, not spending");
		expect(payingWhole("hand", null)).toContain("paying it is a Transfer, not spending");
		expect(payingWhole("none", null)).toContain("its payment is the spending");
		expect(payingBrief("none")).toBe("Purchases aren’t in Noodle · its payment is the spending");
	});

	it("takes a connected card as its bank's whatever was answered, and statements lately as statements", () => {
		expect(keptOf(card("a", "A", { bankConnectionId: "bank", purchases: "hand" }), today)).toBe(
			"bank",
		);
		expect(keptOf(card("b", "B", { lastStatementDate: "2026-09-20" }), today)).toBe("statements");
		expect(keptOf(card("c", "C", { lastStatementDate: "2026-05-01" }), today)).toBeNull();
	});
});

describe("card payments waiting in Review", () => {
	const accounts = [
		card("chase", "Chase Freedom", { purchases: "statements" }),
		card("apple", "Apple Card", { purchases: "hand" }),
		{ ...card("checking", "Checking"), kind: "checking" },
	];
	const line = (note: string, amountCents = 40_000) => ({
		note,
		merchant: note.toLowerCase(),
		amountCents,
		importedFrom: "Checking",
	});

	it("counts each by the card its wording names, and the ones naming no card here apart", () => {
		const waiting = waitingCardPayments(
			[
				line("CHASE CREDIT CRD AUTOPAY"),
				line("CHASE CREDIT CRD EPAY"),
				line("APPLE CARD PAYMENT"),
				line("DISCOVER E-PAYMENT"),
				line("CORNER SHOP", 3_000),
			],
			accounts,
			["chase"],
			[],
		);
		expect(Object.fromEntries(waiting.byCard)).toEqual({ chase: 2, apple: 1 });
		expect(waiting.elsewhere).toBe(1);
		expect(waiting.total).toBe(4);
	});

	it("counts nothing when nothing waiting reads as a card's payment", () => {
		const waiting = waitingCardPayments([line("CORNER SHOP", 3_000)], accounts, [], []);
		expect(waiting.total).toBe(0);
	});
});
