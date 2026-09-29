import { describe, expect, it } from "vitest";
import { findSpokenAmount, parseSpokenAmount, spokenAmount } from "./index";

describe("parseSpokenAmount", () => {
	it("reads digits as speech recognition writes them", () => {
		expect(parseSpokenAmount("$40")).toBe(4_000);
		expect(parseSpokenAmount("12.50")).toBe(1_250);
		expect(parseSpokenAmount("$1,200.05")).toBe(120_005);
		expect(parseSpokenAmount("40 dollars")).toBe(4_000);
		expect(parseSpokenAmount("40 dollars 50 cents")).toBe(4_050);
		expect(parseSpokenAmount("0.29")).toBe(29);
	});

	it("reads whole numbers said in words", () => {
		expect(parseSpokenAmount("forty")).toBe(4_000);
		expect(parseSpokenAmount("twenty-five")).toBe(2_500);
		expect(parseSpokenAmount("twenty five bucks")).toBe(2_500);
		expect(parseSpokenAmount("a hundred")).toBe(10_000);
		expect(parseSpokenAmount("one hundred and twenty five")).toBe(12_500);
		expect(parseSpokenAmount("fifteen hundred")).toBe(150_000);
		expect(parseSpokenAmount("two thousand five hundred")).toBe(250_000);
	});

	it("reads dollars and cents as prices are said", () => {
		expect(parseSpokenAmount("twelve fifty")).toBe(1_250);
		expect(parseSpokenAmount("twelve oh five")).toBe(1_205);
		expect(parseSpokenAmount("ninety nine ninety nine")).toBe(9_999);
		expect(parseSpokenAmount("a buck twenty")).toBe(120);
		expect(parseSpokenAmount("forty dollars and ten cents")).toBe(4_010);
		expect(parseSpokenAmount("fifty cents")).toBe(50);
		expect(parseSpokenAmount("nine point five")).toBe(950);
		expect(parseSpokenAmount("nine point oh five dollars")).toBe(905);
	});

	it("refuses what isn't one amount spent", () => {
		for (const said of [
			"",
			"pizza",
			"zero",
			"0.00",
			"twelve five",
			"five six",
			"forty cents dollars",
			"hundred hundred",
			"a hundred and",
			"4.255",
			"twenty million",
			"99999999999",
		]) {
			expect(parseSpokenAmount(said), said).toBeNull();
		}
	});
});

describe("spokenAmount", () => {
	it("reads the words the model picked out, when they're in the phrase", () => {
		expect(spokenAmount("forty on pizza after hockey", "forty")).toBe(4_000);
		expect(spokenAmount("one pizza for twelve fifty", "twelve fifty")).toBe(1_250);
		expect(spokenAmount("$40 on pizza", "$40")).toBe(4_000);
	});

	it("reads the phrase itself when the model's words aren't in it or aren't an amount", () => {
		// The model can't make up an amount the Parent didn't say.
		expect(spokenAmount("forty on pizza after hockey", "fifty")).toBe(4_000);
		expect(spokenAmount("forty on pizza after hockey", "4000")).toBe(4_000);
		expect(spokenAmount("forty on pizza after hockey", "pizza")).toBe(4_000);
		expect(spokenAmount("forty on pizza after hockey", null)).toBe(4_000);
		expect(spokenAmount("pizza after hockey", "forty")).toBeNull();
	});
});

describe("findSpokenAmount", () => {
	it("finds the first, longest run of words that says an amount", () => {
		expect(findSpokenAmount("forty on pizza after hockey")).toEqual({
			said: "forty",
			cents: 4_000,
		});
		expect(findSpokenAmount("spent twelve fifty at the rink")).toEqual({
			said: "twelve fifty",
			cents: 1_250,
		});
		expect(findSpokenAmount("a hundred and twenty on groceries")).toEqual({
			said: "a hundred and twenty",
			cents: 12_000,
		});
		expect(findSpokenAmount("groceries")).toBeNull();
	});
});
