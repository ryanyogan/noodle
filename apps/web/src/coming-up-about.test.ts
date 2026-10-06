import { describe, expect, it } from "vitest";
import { dueAmount } from "./components/coming-up";

describe("a Coming up row's amount", () => {
	it("is the amount to the cent for a bill that is the same each time", () => {
		expect(dueAmount({ amount: 230_050 }, null)).toBe("$2,300.50");
	});
	it("is About the average of its charges for a bill that varies", () => {
		const about = { average: 16_049, low: 12_000, high: 21_000, count: 3 };
		expect(dueAmount({ amount: 14_000, about: true }, about)).toBe("About $160");
	});
	it("is About what the Plan sets aside before its first charge", () => {
		expect(dueAmount({ amount: 14_000, about: true }, null)).toBe("About $140");
	});
});
