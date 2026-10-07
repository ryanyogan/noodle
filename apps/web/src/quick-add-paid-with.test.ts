import { describe, expect, it } from "vitest";
import { handKeptCards, paidWithStart } from "./quick-add";

// "Paid with" on Quick Add (issue 136): offered only for cards kept by hand, and it starts on what
// the link asked for, else what this device chose last time.

const account = (id: string, over: object = {}) => ({
	id,
	name: id,
	kind: "credit-card",
	purchases: "hand" as string | null,
	bankConnectionId: null as string | null,
	...over,
});

describe("the cards a Quick Add can be paid with", () => {
	it("are credit cards said to be kept by hand that no bank reaches", () => {
		const accounts = [
			account("apple"),
			account("statements", { purchases: "statements" }),
			account("unasked", { purchases: null }),
			account("connected", { bankConnectionId: "bank" }),
			account("checking", { kind: "checking" }),
		];
		expect(handKeptCards(accounts).map((a) => a.id)).toEqual(["apple"]);
	});
});

describe("what Paid with starts on", () => {
	const cards = [{ id: "apple" }, { id: "store" }];
	it("is Something else until a card has been chosen on this device", () => {
		expect(paidWithStart(cards, null)).toBeNull();
	});
	it("is the card chosen last time", () => {
		expect(paidWithStart(cards, "store")).toBe("store");
	});
	it("is the card the balance check asked for, over the one remembered", () => {
		expect(paidWithStart(cards, "store", "apple")).toBe("apple");
	});
	it("forgets a card that's no longer kept by hand, and ignores an Account that isn't one", () => {
		expect(paidWithStart(cards, "gone")).toBeNull();
		expect(paidWithStart(cards, "store", "checking")).toBe("store");
		expect(paidWithStart([], "apple", "apple")).toBeNull();
	});
});
