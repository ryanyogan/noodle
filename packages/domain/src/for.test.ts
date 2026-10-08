import { describe, expect, it } from "vitest";
import {
	type AttributedSpend,
	type DayKey,
	EVERYONE,
	forTotals,
	forWhom,
	LIKELY_FOR_LOOKS_AT,
	likelyFor,
	shareFor,
	shares,
	spendingFor,
} from "./index";

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

describe("spendingFor: the spending behind one person's figure", () => {
	const spending = [
		spend("health", 10_001, "2026-09-03", "maya", "leo", "alex"),
		spend("health", 4_000, "2026-09-04", "maya"),
		spend("health", -1_001, "2026-09-05", "leo", "maya"),
		spend("food", 18_642, "2026-09-06"),
		spend("food", 2_500, "2026-09-07", "alex", "alex"),
	];

	it("gives each person their share, adding up to forTotals' figures to the cent", () => {
		const totals = forTotals(spending);
		for (const who of ["maya", "leo", "alex", "sam", EVERYONE]) {
			const figure = who === EVERYONE ? totals.household : totals.members[who];
			const behind = spendingFor(spending, who);
			expect(behind.reduce((sum, s) => sum + s.amount, 0)).toBe(figure?.total ?? 0);
			for (const bucketId of ["health", "food"])
				expect(
					behind.filter((s) => s.bucketId === bucketId).reduce((sum, s) => sum + s.amount, 0),
				).toBe(figure?.buckets[bucketId] ?? 0);
		}
	});

	it("shares an odd cent the way forTotals does, and nothing with those it wasn't For", () => {
		const shared = spend("health", 10_001, "2026-09-03", "maya", "leo", "alex");
		expect(["maya", "leo", "alex"].map((who) => shareFor(shared, who))).toEqual([3334, 3334, 3333]);
		expect(shareFor(shared, "sam")).toBe(0);
		expect(shareFor(shared, EVERYONE)).toBe(0);
	});

	it("keeps the whole Household's apart from the people", () => {
		expect(spendingFor(spending, EVERYONE)).toEqual([spend("food", 18_642, "2026-09-06")]);
		expect(forWhom(spending)).toEqual(["maya", "leo", "alex", EVERYONE]);
		expect(forWhom(spending.filter((s) => s.for.length > 0))).not.toContain(EVERYONE);
	});
});

describe("likelyFor: who a merchant's next Transaction is likely For", () => {
	it("is who the merchant's earlier ones were all For, once there are two", () => {
		expect(likelyFor([["maya"], ["maya"]])).toEqual(["maya"]);
		expect(likelyFor([["maya"], ["maya"], ["maya"]])).toEqual(["maya"]);
	});

	it("is nobody after one alone, or none", () => {
		expect(likelyFor([["maya"]])).toBeNull();
		expect(likelyFor([])).toBeNull();
	});

	it("is nobody when they differ, one For Everyone among them included", () => {
		expect(likelyFor([["maya"], ["leo"]])).toBeNull();
		expect(likelyFor([["maya"], ["maya"], []])).toBeNull();
		expect(likelyFor([["maya"], ["maya", "leo"]])).toBeNull();
	});

	it("is never Everyone: that is what a Transaction is anyway", () => {
		expect(likelyFor([[], [], []])).toBeNull();
	});

	it("names several people when every one was For the same several, in any order", () => {
		expect(
			likelyFor([
				["maya", "leo"],
				["leo", "maya"],
			]),
		).toEqual(["leo", "maya"]);
		expect(likelyFor([["maya", "maya"], ["maya"]])).toEqual(["maya"]);
	});

	it("goes by the latest ones only, so a new habit takes over", () => {
		const latest = Array.from({ length: LIKELY_FOR_LOOKS_AT }, () => ["leo"]);
		expect(likelyFor([...latest, ["maya"], []])).toEqual(["leo"]);
		expect(likelyFor([["maya"], ...latest])).toBeNull();
	});

	it("leaves out a Member who has left, and keeps the rest", () => {
		const earlier = [
			["maya", "leo"],
			["maya", "leo"],
		];
		expect(likelyFor(earlier, ["maya", "alex"])).toEqual(["maya"]);
		expect(likelyFor(earlier, ["alex"])).toBeNull();
		expect(likelyFor(earlier, ["maya", "leo"])).toEqual(["leo", "maya"]);
	});
});
