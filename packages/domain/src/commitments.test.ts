import { describe, expect, it } from "vitest";
import { aboutAmount, aboutCameIn, type DayKey } from "./index";

const charge = (date: string, amount: number) => ({ date: date as DayKey, amount });
const asOf = "2026-10-06" as DayKey;

describe("an about amount", () => {
	it("is nothing before the first charge", () => {
		expect(aboutAmount([], asOf)).toBeNull();
		expect(aboutAmount([charge("2026-10-20", 16_000)], asOf)).toBeNull();
	});

	it("is the average of the last three charges until there is a year of them", () => {
		const charges = [
			charge("2026-06-12", 30_000),
			charge("2026-07-12", 12_000),
			charge("2026-08-12", 15_000),
			charge("2026-09-12", 21_000),
		];
		expect(aboutAmount(charges, asOf)).toEqual({
			average: 16_000,
			low: 12_000,
			high: 21_000,
			count: 3,
		});
		expect(aboutAmount(charges.slice(0, 2), asOf)).toEqual({
			average: 21_000,
			low: 12_000,
			high: 30_000,
			count: 2,
		});
	});

	it("is the average of the last year's charges once there is a year of them", () => {
		// Twelve monthly charges, Nov 2025 to Oct 2026, and one older than a year that is left out.
		const year = Array.from({ length: 12 }, (_, i) => {
			const month = i < 2 ? `2025-${11 + i}` : `2026-${String(i - 1).padStart(2, "0")}`;
			return charge(`${month}-05`, 12_000 + i * 1_000);
		});
		const about = aboutAmount([charge("2025-09-05", 90_000), ...year], asOf);
		expect(about).toEqual({ average: 17_500, low: 12_000, high: 23_000, count: 12 });
	});

	it("rounds the average to the cent", () => {
		expect(aboutAmount([charge("2026-09-01", 100), charge("2026-10-01", 101)], asOf)?.average).toBe(
			101,
		);
	});
});

describe("how an about Commitment's month came in", () => {
	const state = { about: true, charges: 1, dueDates: ["2026-10-12" as DayKey], difference: 3_500 };

	it("is over or under once every charge due is in", () => {
		expect(aboutCameIn(state)).toBe(3_500);
		expect(aboutCameIn({ ...state, difference: -2_000 })).toBe(-2_000);
	});

	it("is nothing for the same each time, while one is still due, or when it matches", () => {
		expect(aboutCameIn({ ...state, about: false })).toBeNull();
		expect(aboutCameIn({ ...state, charges: 0, difference: 0 })).toBeNull();
		expect(
			aboutCameIn({ ...state, dueDates: ["2026-10-02", "2026-10-16"] as DayKey[] }),
		).toBeNull();
		expect(aboutCameIn({ ...state, difference: 0 })).toBeNull();
	});
});

describe("an about amount and Paid back (issue 132)", () => {
	it("leaves out money Paid back: it isn't a charge", () => {
		const charges = [
			charge("2026-07-12", 12_000),
			charge("2026-08-12", 15_000),
			charge("2026-09-12", 21_000),
			{ ...charge("2026-09-20", -6_000), paidBack: true as const },
		];
		expect(aboutAmount(charges, asOf)).toEqual({
			average: 16_000,
			low: 12_000,
			high: 21_000,
			count: 3,
		});
	});
});
