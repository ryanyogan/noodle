import type { DayKey } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import { aboutText, carryNote } from "./commitments";

describe("an about Commitment's amount in words", () => {
	it("says the average and how far the charges range, in whole dollars", () => {
		expect(aboutText({ average: 16_012, low: 12_049, high: 20_951, count: 12 }, 14_000)).toBe(
			"About $160 · $120–$210",
		);
	});

	it("says just the amount with one amount so far, and the planned one before any charge", () => {
		expect(aboutText({ average: 16_000, low: 16_000, high: 16_000, count: 1 }, 14_000)).toBe(
			"About $160",
		);
		expect(aboutText(null, 14_000)).toBe("About $140");
	});
});

describe("where an about Commitment's over or under goes", () => {
	const power = {
		name: "Power",
		about: true,
		charges: 1,
		dueDates: ["2026-10-12" as DayKey],
		difference: 3_500,
	};

	it("comes out of what carries to the next month when over", () => {
		expect(carryNote(power, "2026-10")).toBe(
			"Power came in $35 over · comes out of what carries to November",
		);
	});

	it("adds to it when under, and names January after December", () => {
		expect(carryNote({ ...power, difference: -2_050 }, "2026-12")).toBe(
			"Power came in $20.50 under · adds to what carries to January",
		);
	});

	it("says nothing for a Commitment that's the same each time, or one not charged yet", () => {
		expect(carryNote({ ...power, about: false }, "2026-10")).toBeNull();
		expect(carryNote({ ...power, charges: 0, difference: 0 }, "2026-10")).toBeNull();
	});
});
