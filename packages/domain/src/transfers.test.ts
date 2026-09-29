import { describe, expect, it } from "vitest";
import {
	type DayKey,
	likelyOriginals,
	type RefundSide,
	type TransferSide,
	transferPairs,
} from "./index";

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
