import { describe, expect, it } from "vitest";
import { type AttributedSpend, type DayKey, forTotals, shares } from "./index";

const spend = (bucketId: string, amount: number, date: DayKey, ...forIds: string[]) =>
	({ bucketId, amount, date, for: forIds }) satisfies AttributedSpend;

describe("shares: an amount split evenly to the cent", () => {
	it.each([
		[900, 3, [300, 300, 300]],
		[1_000, 3, [334, 333, 333]],
		[1, 2, [1, 0]],
		[-5, 2, [-3, -2]],
		[7, 1, [7]],
	] as const)("%i¢ in %i shares", (amount, count, expected) => {
		const split = shares(amount, count);
		expect(split).toEqual(expected);
		expect(split.reduce((a, b) => a + b, 0)).toBe(amount);
	});
});

describe("forTotals: what each Member cost, and the whole Household", () => {
	it("totals each Member's spending, by Bucket", () => {
		const totals = forTotals([
			spend("hockey", 6_499, "2026-09-12", "leo"),
			spend("hockey", 12_000, "2026-09-02", "leo"),
			spend("fun", 4_100, "2026-09-10", "maya"),
			spend("fun", 1_500, "2026-09-11", "leo"),
		]);
		expect(totals.members).toEqual({
			leo: { total: 19_999, buckets: { hockey: 18_499, fun: 1_500 } },
			maya: { total: 4_100, buckets: { fun: 4_100 } },
		});
		expect(totals.household).toEqual({ total: 0, buckets: {} });
	});

	it("counts whole-Household spending once, as the Household's, not under each Member", () => {
		const totals = forTotals([
			spend("groceries", 18_642, "2026-09-13"),
			spend("fun", 4_100, "2026-09-10", "maya"),
		]);
		expect(totals.household).toEqual({ total: 18_642, buckets: { groceries: 18_642 } });
		expect(totals.members).toEqual({ maya: { total: 4_100, buckets: { fun: 4_100 } } });
	});

	it("shares spending For several Members evenly, so nothing is counted twice", () => {
		const spending = [
			spend("fun", 1_000, "2026-09-10", "maya", "leo", "alex"),
			spend("groceries", 5_000, "2026-09-11"),
		];
		const totals = forTotals(spending);
		expect(totals.members.maya?.total).toBe(334);
		expect(totals.members.leo?.total).toBe(333);
		expect(totals.members.alex?.total).toBe(333);
		const everyone =
			totals.household.total +
			Object.values(totals.members).reduce((sum, member) => sum + member.total, 0);
		expect(everyone).toBe(6_000);
	});

	it("counts a Member named twice on one Transaction once", () => {
		const totals = forTotals([spend("fun", 1_000, "2026-09-10", "maya", "maya")]);
		expect(totals.members.maya?.total).toBe(1_000);
	});

	it("adds onto earlier totals for the year to date, without changing them", () => {
		const earlier = forTotals([
			spend("hockey", 20_000, "2026-08-04", "leo"),
			spend("groceries", 3_000, "2026-08-05"),
		]);
		const month = [
			spend("hockey", 5_000, "2026-09-01", "leo"),
			spend("fun", 700, "2026-09-02", "leo"),
		];
		const yearToDate = forTotals(month, earlier);
		expect(yearToDate.members.leo).toEqual({
			total: 25_700,
			buckets: { hockey: 25_000, fun: 700 },
		});
		expect(yearToDate.household.total).toBe(3_000);
		expect(earlier.members.leo?.total).toBe(20_000);
		expect(forTotals(month).members.leo?.total).toBe(5_700);
	});
});
