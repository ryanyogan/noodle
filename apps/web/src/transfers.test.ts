import { describe, expect, it } from "vitest";
import { transferMonthEnded } from "./transfers";

describe("what's said when a purchase can't be marked as a Transfer", () => {
	it("says its money back counted in a month that has ended, and that it keeps counting", () => {
		expect(transferMonthEnded("PURE HOCKEY")).toBe(
			"Money back on PURE HOCKEY counted in a month that has ended, so it keeps counting where it is and can’t be marked as a Transfer.",
		);
	});
});
