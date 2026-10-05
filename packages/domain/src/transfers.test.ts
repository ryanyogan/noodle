import { describe, expect, it } from "vitest";
import {
	type DayKey,
	likelyCardPayment,
	likelyOriginals,
	looksLikeCardPayment,
	type RefundSide,
	type TransferSide,
	transferPairs,
} from "./index";
import { cleanMerchant } from "./merchant-name";

const side = (id: string, date: DayKey, amount: number, accountId: string): TransferSide => ({
	id,
	date,
	amount,
	accountId,
});

describe("transferPairs: money leaving one Account and arriving in another", () => {
	it("pairs the same amount in different Accounts a few days apart", () => {
		const payment = side("pay", "2026-09-09", 50_000, "checking");
		const onCard = side("card", "2026-09-11", 50_000, "visa");
		expect(transferPairs([payment], [onCard])).toEqual([{ outId: "pay", inId: "card" }]);
	});

	it("needs the amount to the cent, another Account, and at most four days", () => {
		const payment = side("pay", "2026-09-09", 50_000, "checking");
		expect(transferPairs([payment], [side("a", "2026-09-10", 50_001, "visa")])).toEqual([]);
		expect(transferPairs([payment], [side("b", "2026-09-10", 50_000, "checking")])).toEqual([]);
		expect(transferPairs([payment], [side("c", "2026-09-14", 50_000, "visa")])).toEqual([]);
		expect(transferPairs([payment], [side("d", "2026-09-05", 50_000, "visa")])).toHaveLength(1);
	});

	it("prefers the nearest day, and leaves a tie to a Parent", () => {
		const payment = side("pay", "2026-09-09", 50_000, "checking");
		const near = side("near", "2026-09-10", 50_000, "visa");
		const far = side("far", "2026-09-12", 50_000, "visa");
		expect(transferPairs([payment], [far, near])).toEqual([{ outId: "pay", inId: "near" }]);
		const twin = side("twin", "2026-09-08", 50_000, "savings");
		expect(transferPairs([payment], [near, twin])).toEqual([]);
	});

	it("never pairs what a Parent unmarked", () => {
		const payment = side("pay", "2026-09-09", 50_000, "checking");
		const onCard = side("card", "2026-09-10", 50_000, "visa");
		expect(transferPairs([payment], [onCard], (o, i) => o === "pay" && i === "card")).toEqual([]);
	});
});

describe("likelyOriginals: what money back might be a Refund for", () => {
	const refund: RefundSide = {
		id: "back",
		date: "2026-09-12",
		amount: 2_499,
		text: "REI #11 RETURN",
	};
	const purchase = (id: string, date: DayKey, amount: number, text: string): RefundSide => ({
		id,
		date,
		amount,
		text,
	});

	it("offers purchases of at least as much from the 90 days before, merchant first", () => {
		const offered = likelyOriginals(refund, [
			purchase("coffee", "2026-09-11", 450, "Coffee"),
			purchase("costco", "2026-09-10", 6_210, "COSTCO WHSE"),
			purchase("rei", "2026-08-20", 8_999, "REI #11 PORTLAND"),
			purchase("later", "2026-09-13", 9_000, "REI"),
			purchase("old", "2026-05-01", 9_000, "REI"),
		]);
		expect(offered.map((p) => p.id)).toEqual(["rei", "costco"]);
	});

	it("puts the most recent first when nothing names the merchant", () => {
		const offered = likelyOriginals({ ...refund, text: "CREDIT" }, [
			purchase("older", "2026-08-01", 5_000, "Shoes"),
			purchase("newer", "2026-09-01", 5_000, "Jacket"),
		]);
		expect(offered.map((p) => p.id)).toEqual(["newer", "older"]);
	});
});

describe("card payments by their words (#91)", () => {
	it("knows a credit card's payment line from a bill, a purchase or a loan", () => {
		for (const text of [
			"CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224",
			"Payment to Chase card ending in 4321 10/02",
			"AMEX EPAYMENT ACH PMT",
			"CITI CARD ONLINE PAYMENT",
			"CAPITAL ONE CRCARDPMT",
			"DISCOVER E-PAYMENT",
			"BARCLAYCARD US CREDITCARD",
			"WF CREDIT CARD AUTO PAY",
		])
			expect(looksLikeCardPayment(text), text).toBe(true);
		for (const text of [
			"T-MOBILE AUTOPAY",
			"NATL GAS CO AUTOPAY",
			"ONLINE PAYMENT",
			"CHASE MORTGAGE PAYMENT",
			"CAPITAL ONE AUTO FINANCE CARPAY",
			"HONDA FINANCIAL LOAN PAYMENT",
			"DEBIT CARD PURCHASE NETFLIX",
			"POS DEBIT CITI BIKE PAYMENT",
			"ZELLE PAYMENT TO J DOE",
			"TRADER JOE'S #123",
			"",
			null,
		])
			expect(looksLikeCardPayment(text), String(text)).toBe(false);
	});

	it("still knows a card payment by the clean name Noodle gives its line (#95)", () => {
		for (const raw of [
			"AMERICAN EXPRESS ACH PMT",
			"AMEX EPAYMENT ACH PMT",
			"CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224",
			"CHASE CREDIT CRD AUTOPAY",
			"DISCOVER E-PAYMENT",
			"CITI CARD ONLINE PMT",
			"CAPITAL ONE CRCARDPMT",
			"CAPITAL ONE ONLINE PMT",
			"BARCLAYCARD US CREDITCARD",
		]) {
			const { name } = cleanMerchant(raw);
			expect(looksLikeCardPayment(raw), raw).toBe(true);
			expect(looksLikeCardPayment(name), `${raw} named ${name}`).toBe(true);
		}
		expect(cleanMerchant("AMERICAN EXPRESS ACH PMT").name).toBe("American Express payment");
		// A bill on autopay and a loan keep their names and stay what they are.
		for (const raw of ["T-MOBILE AUTOPAY", "ROCKET MORTGAGE PMT"]) {
			expect(looksLikeCardPayment(cleanMerchant(raw).name), raw).toBe(false);
		}
	});

	it("names the Household's card when the line's words fit exactly one", () => {
		const cards = [{ name: "Chase Sapphire" }, { name: "Costco Visa" }];
		const out = (text: string, amountCents = 50_000) => ({ text, amountCents });
		expect(likelyCardPayment(out("CHASE CREDIT CRD AUTOPAY"), cards)).toEqual({
			card: "Chase Sapphire",
		});
		// Only "payment" in its words, but it names a card of the Household's.
		expect(likelyCardPayment(out("VISA ONLINE PAYMENT"), [{ name: "Visa" }])).toEqual({
			card: "Visa",
		});
		// Two cards fit equally: likely, with no card named.
		expect(
			likelyCardPayment(out("CHASE CREDIT CRD AUTOPAY"), [
				{ name: "Chase Sapphire" },
				{ name: "Chase Freedom" },
			]),
		).toEqual({ card: null });
		// A card Noodle doesn't follow.
		expect(likelyCardPayment(out("AMEX EPAYMENT ACH PMT"), cards)).toEqual({ card: null });
		expect(likelyCardPayment(out("AMEX EPAYMENT ACH PMT"))).toEqual({ card: null });
	});

	it("leaves purchases, bills, plain payments and money back alone", () => {
		const cards = [{ name: "Chase Sapphire" }, { name: "Costco Visa" }];
		for (const text of [
			"COSTCO WHSE #1234",
			"T-MOBILE AUTOPAY",
			"ONLINE PAYMENT",
			"CHASE MORTGAGE PAYMENT",
		])
			expect(likelyCardPayment({ text, amountCents: 12_000 }, cards), text).toBeNull();
		// Money back onto the card is its other side, never spending waiting in Review.
		expect(
			likelyCardPayment({ text: "PAYMENT THANK YOU", amountCents: -50_000 }, cards),
		).toBeNull();
		expect(likelyCardPayment({ text: null, amountCents: 100 }, cards)).toBeNull();
	});
});
