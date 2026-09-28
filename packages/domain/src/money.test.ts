import { describe, expect, it } from "vitest";
import { MAX_CENTS, parseDollars } from "./index";

describe("parseDollars: what a Parent typed, as cents", () => {
	it.each([
		["1240", 124_000],
		["1,240", 124_000],
		["$1,240.50", 124_050],
		["$ 85.5", 8550],
		["12.99", 1299],
		["0.29", 29], // not 28.999… from float math
		[".5", 50],
		["7.", 700],
		["0", 0],
		["  42  ", 4200],
		["10000000", MAX_CENTS],
	])("%j is %i cents", (input, cents) => {
		expect(parseDollars(input)).toBe(cents);
	});

	it.each(["", ".", "abc", "-5", "1.234", "1e3", "12 34", "$", "10000000.01"])(
		"%j is not an amount",
		(input) => {
			expect(parseDollars(input)).toBeNull();
		},
	);
});
