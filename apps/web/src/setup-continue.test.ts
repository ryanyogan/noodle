import { describe, expect, it } from "vitest";
import { continueSetupShown } from "./setup";

describe("continueSetupShown (#72)", () => {
	it("asks while the wizard isn't finished, whatever the Plan has", () => {
		expect(continueSetupShown({ finished: false, answers: {} })).toBe(true);
		expect(continueSetupShown({ finished: false, answers: { takeHomePayCents: 500_000 } })).toBe(
			true,
		);
	});

	it("stops once Done is reached", () => {
		expect(continueSetupShown({ finished: true, answers: {} })).toBe(false);
	});

	it("stops once a Parent dismisses it", () => {
		expect(continueSetupShown({ finished: false, answers: { dismissed: true } })).toBe(false);
	});
});
