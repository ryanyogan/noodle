import { describe, expect, it } from "vitest";
import {
	canApply,
	type MatchSide,
	parseReceiptAmount,
	proposeSplits,
	type ReceiptLine,
	receiptDate,
	receiptDifference,
	receiptLine,
	receiptTransaction,
	shareOut,
} from "./index";

const item = (
	amount: number,
	bucketId: string | null,
	confidence = 0.95,
	forIds: string[] = [],
): ReceiptLine => ({
	text: "item",
	kind: "item",
	amount,
	bucketId,
	confidence,
	for: forIds,
});
const discount = (amount: number): ReceiptLine => ({
	text: "discount",
	kind: "discount",
	amount: -amount,
	bucketId: null,
	confidence: 0,
	for: [],
});
const tax = (amount: number): ReceiptLine => ({
	text: "tax",
	kind: "tax",
	amount,
	bucketId: null,
	confidence: 0,
	for: [],
});

describe("parseReceiptAmount", () => {
	it("reads amounts as receipts print them, money off as negative", () => {
		expect(parseReceiptAmount("$12.99")).toBe(1_299);
		expect(parseReceiptAmount("1,299.00")).toBe(129_900);
		expect(parseReceiptAmount("0.29")).toBe(29);
		expect(parseReceiptAmount("-4.00")).toBe(-400);
		expect(parseReceiptAmount("4.00-")).toBe(-400);
		expect(parseReceiptAmount("-$4.00")).toBe(-400);
		expect(parseReceiptAmount("($4.00)")).toBe(-400);
		expect(parseReceiptAmount(" 7 ")).toBe(700);
	});

	it("refuses what isn't an amount", () => {
		for (const text of ["", "free", "4.005", "$", "12.99 Y", "--4"]) {
			expect(parseReceiptAmount(text)).toBeNull();
		}
	});
});

describe("receiptLine", () => {
	it("makes a discount money off however it's printed, and keeps a Bucket only on items", () => {
		const read = { text: "  INSTANT  SAVINGS ", confidence: 1.4, for: [] };
		expect(receiptLine({ ...read, kind: "discount", amount: "4.00", bucketId: "b" })).toMatchObject(
			{ text: "INSTANT SAVINGS", amount: -400, bucketId: null, confidence: 0 },
		);
		expect(
			receiptLine({ ...read, kind: "item", amount: "4.00", bucketId: "b", for: ["z", "a", "z"] }),
		).toMatchObject({ amount: 400, bucketId: "b", confidence: 1, for: ["a", "z"] });
	});

	it("drops a line with no amount or nothing on it", () => {
		const read = { text: "BAG", kind: "item" as const, bucketId: null, confidence: 0, for: [] };
		expect(receiptLine({ ...read, amount: "0.00" })).toBeNull();
		expect(receiptLine({ ...read, amount: "N/A" })).toBeNull();
	});
});

describe("shareOut", () => {
	it("shares an amount in proportion, adding up exactly", () => {
		expect(shareOut(100, [1, 1, 1])).toEqual([34, 33, 33]);
		expect(shareOut(530, [10_000, 2_000])).toEqual([442, 88]);
		expect(shareOut(-100, [1, 2])).toEqual([-33, -67]);
		expect(shareOut(0, [5, 5])).toEqual([0, 0]);
	});

	it("never loses a cent on large amounts", () => {
		const shares = shareOut(999_999_999, [999_999_998, 1, 999_999_997]);
		expect(shares.reduce((a, b) => a + b, 0)).toBe(999_999_999);
	});
});

describe("proposeSplits", () => {
	it("groups items by Bucket, keeps each discount with its item, and shares tax", () => {
		// Groceries $30 (after a $4 discount on a $34 item) and Hockey $10; $4 tax shared 3:1.
		const lines = [item(3_400, "groceries"), discount(400), item(1_000, "hockey"), tax(400)];
		expect(receiptDifference(4_400, lines)).toBe(0);
		expect(proposeSplits(4_400, lines)).toEqual({
			kind: "parts",
			parts: [
				{ bucketId: "groceries", for: [], amount: 3_300 },
				{ bucketId: "hockey", for: [], amount: 1_100 },
			],
			confident: true,
		});
	});

	it("keeps items For different Members apart, even in one Bucket", () => {
		const lines = [item(1_000, "kids", 0.9, ["ava"]), item(1_000, "kids", 0.9, ["ben"])];
		const proposal = proposeSplits(2_000, lines);
		expect(proposal.kind === "parts" && proposal.parts.map((part) => part.for)).toEqual([
			["ava"],
			["ben"],
		]);
	});

	it("proposes nothing when the lines don't add up to the total", () => {
		expect(proposeSplits(5_000, [item(3_000, "groceries"), tax(100)])).toEqual({
			kind: "unreconciled",
			difference: 1_900,
		});
		expect(proposeSplits(100, [tax(100)])).toMatchObject({ kind: "unreconciled" });
	});

	it("isn't confident when the model wasn't sure, or an item has no Bucket", () => {
		const unsure = proposeSplits(2_000, [item(1_000, "groceries"), item(1_000, "fun", 0.6)]);
		expect(unsure).toMatchObject({ kind: "parts", confident: false });
		const unknown = proposeSplits(2_000, [item(1_000, "groceries"), item(1_000, null, 0)]);
		expect(unknown).toMatchObject({ kind: "parts", confident: false });
		expect(unknown.kind === "parts" && canApply(unknown.parts)).toBe(false);
		expect(unsure.kind === "parts" && canApply(unsure.parts)).toBe(true);
	});

	it("shares a discount printed before any item, and drops an item that's fully discounted", () => {
		const lines = [discount(100), item(1_000, "a"), item(500, "b"), discount(500), tax(0)];
		expect(proposeSplits(900, lines)).toEqual({
			kind: "parts",
			parts: [{ bucketId: "a", for: [], amount: 900 }],
			confident: true,
		});
	});

	it("isn't confident when money off leaves a part at nothing or less", () => {
		const lines = [item(100, "a"), discount(300), item(1_000, "b")];
		expect(proposeSplits(800, lines)).toMatchObject({ kind: "parts", confident: false });
	});

	it("puts a single Bucket's Receipt in one part", () => {
		const proposal = proposeSplits(1_531, [item(700, "g"), item(731, "g"), tax(100)]);
		expect(proposal).toEqual({
			kind: "parts",
			parts: [{ bucketId: "g", for: [], amount: 1_531 }],
			confident: true,
		});
	});
});

describe("receiptDate", () => {
	it("takes the Receipt's own date when it's a real, recent day", () => {
		expect(receiptDate("2026-09-20", "2026-09-29")).toBe("2026-09-20");
		expect(receiptDate(" 2026-09-29 ", "2026-09-29")).toBe("2026-09-29");
	});

	it("falls back to the day it arrived for a date that's missing, future, old, or not a day", () => {
		for (const said of [null, "", "2026-09-30", "2026-02-30", "2025-01-01", "Sep 20"]) {
			expect(receiptDate(said, "2026-09-29")).toBe("2026-09-29");
		}
	});
});

describe("receiptTransaction", () => {
	const side = (id: string, date: string, amount: number, text: string | null): MatchSide => ({
		id,
		date: date as MatchSide["date"],
		amount,
		text,
	});
	const receipt = { date: "2026-09-20" as const, amount: 12_530, merchant: "Costco" };

	it("finds the one Transaction of the same amount within the Match window", () => {
		expect(
			receiptTransaction(receipt, [
				side("bank", "2026-09-22", 12_530, "COSTCO WHSE #123"),
				side("other", "2026-09-22", 12_531, "COSTCO WHSE #123"),
				side("late", "2026-09-28", 12_530, "COSTCO WHSE #123"),
			]),
		).toBe("bank");
	});

	it("lets the merchant pick between two, and gives up when nothing tells them apart", () => {
		const target = side("target", "2026-09-21", 12_530, "TARGET 00012");
		const costco = side("costco", "2026-09-21", 12_530, "COSTCO WHSE");
		expect(receiptTransaction(receipt, [target, costco])).toBe("costco");
		const again = side("again", "2026-09-22", 12_530, "COSTCO WHSE");
		expect(receiptTransaction(receipt, [costco, again])).toBeNull();
		expect(receiptTransaction(receipt, [])).toBeNull();
	});
});
