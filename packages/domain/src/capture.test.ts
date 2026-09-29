import { describe, expect, it } from "vitest";
import { parseCapturedAmount } from "./index";

describe("parseCapturedAmount", () => {
	it("reads the amount as Shortcuts formats it", () => {
		expect(parseCapturedAmount("$4.25")).toBe(425);
		expect(parseCapturedAmount("4.25 USD")).toBe(425);
		expect(parseCapturedAmount("US$1,234.50")).toBe(123_450);
		expect(parseCapturedAmount(" 12 ")).toBe(1_200);
		expect(parseCapturedAmount(18.4)).toBe(1_840);
	});

	it("refuses nothing spent, a refund, and anything that isn't an amount", () => {
		for (const input of ["$0.00", 0, "-$4.25", -4.25, "", "four dollars", "4.255", null, {}]) {
			expect(parseCapturedAmount(input)).toBeNull();
		}
	});
});
