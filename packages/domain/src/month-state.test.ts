import { describe, expect, it } from "vitest";
import { type DayKey, type MonthKey, monthState, type Plan, type Spend } from "./index";

const planOf = (month: MonthKey, allowances: Record<string, number>, baseline = 500_000): Plan => ({
	month,
	baseline,
	buckets: Object.entries(allowances).map(([id, allowance], i) => ({
		id,
		name: id,
		color: i + 1,
		allowance,
	})),
});

const spend = (bucketId: string, amount: number, date: DayKey): Spend => ({
	bucketId,
	amount,
	date,
});

describe("monthState: each Bucket's allowance, spent, and left", () => {
	const plan = planOf("2026-09", { groceries: 120_000, hockey: 40_000 });

	it("subtracts the month's spending from each allowance", () => {
		const state = monthState({
			plan,
			asOf: "2026-09-15",
			spending: [
				spend("groceries", 9_388, "2026-09-09"),
				spend("groceries", 5_217, "2026-09-11"),
				spend("hockey", 6_499, "2026-09-12"),
			],
		});
		expect(
			state.buckets.map(({ id, allowance, spent, left }) => ({ id, allowance, spent, left })),
		).toEqual([
			{ id: "groceries", allowance: 120_000, spent: 14_605, left: 105_395 },
			{ id: "hockey", allowance: 40_000, spent: 6_499, left: 33_501 },
		]);
		expect(state.leftInBuckets).toBe(138_896);
	});

	it("ignores spending in other months and against Buckets not in the Plan", () => {
		const state = monthState({
			plan,
			asOf: "2026-09-15",
			spending: [
				spend("groceries", 1_000, "2026-08-31"),
				spend("groceries", 2_000, "2026-10-01"),
				spend("archived", 3_000, "2026-09-10"),
				spend("groceries", 500, "2026-09-01"),
				spend("groceries", 700, "2026-09-30"),
			],
		});
		expect(state.buckets[0]?.spent).toBe(1_200);
		expect(state.buckets.map((b) => b.id)).toEqual(["groceries", "hockey"]);
	});

	it("goes negative when overspent, without counting that against what's left elsewhere", () => {
		const state = monthState({
			plan,
			asOf: "2026-09-20",
			spending: [spend("hockey", 45_000, "2026-09-03")],
		});
		expect(state.buckets[1]).toMatchObject({ left: -5_000, status: "over" });
		expect(state.leftInBuckets).toBe(120_000);
	});
});

describe("monthState: Free to Spend", () => {
	it("is the Baseline less every allowance, whatever has been spent", () => {
		const state = monthState({
			plan: planOf("2026-09", { groceries: 120_000, hockey: 40_000 }, 500_000),
			asOf: "2026-09-15",
			spending: [spend("groceries", 50_000, "2026-09-02")],
		});
		expect(state.planned).toBe(160_000);
		expect(state.freeToSpend).toBe(340_000);
	});

	it("goes negative, not zero, when allowances exceed the Baseline", () => {
		const state = monthState({
			plan: planOf("2026-09", { groceries: 300_000, hockey: 250_000 }, 500_000),
			asOf: "2026-09-15",
			spending: [],
		});
		expect(state.freeToSpend).toBe(-50_000);
	});
});

describe("monthState: Pace", () => {
	const paceOf = (month: MonthKey, allowance: number, asOf: DayKey) => {
		const state = monthState({ plan: planOf(month, { b: allowance }), asOf, spending: [] });
		return {
			spent: state.buckets[0]?.pace.spent,
			leftShare: state.buckets[0]?.pace.leftShare,
			daysLeft: state.daysLeft,
		};
	};

	it.each([
		// month, allowance, as of, Pace spent, share left, days left
		["2026-09", 30_000, "2026-09-01", 1_000, 29 / 30, 29],
		["2026-09", 30_000, "2026-09-15", 15_000, 0.5, 15],
		["2026-09", 30_000, "2026-09-30", 30_000, 0, 0],
		// Before the month starts nothing should be spent; after it ends, everything.
		["2026-09", 30_000, "2026-08-31", 0, 1, 30],
		["2026-09", 30_000, "2026-10-01", 30_000, 0, 0],
		["2026-09", 30_000, "2027-01-15", 30_000, 0, 0],
		// Month edges across the year boundary.
		["2026-12", 31_000, "2026-12-31", 31_000, 0, 0],
		["2027-01", 31_000, "2026-12-31", 0, 1, 31],
		// February, in common and leap years.
		["2027-02", 28_000, "2027-02-28", 28_000, 0, 0],
		["2028-02", 29_000, "2028-02-28", 28_000, 1 / 29, 1],
		["2028-02", 29_000, "2028-02-29", 29_000, 0, 0],
		["2028-02", 10_000, "2028-02-14", 4_828, 15 / 29, 15], // 4827.58… rounds to the cent
	] as const)(
		"%s, %i¢ allowance, as of %s: Pace spent %i",
		(month, allowance, asOf, spent, leftShare, daysLeft) => {
			const pace = paceOf(month, allowance, asOf);
			expect(pace.spent).toBe(spent);
			expect(pace.leftShare).toBeCloseTo(leftShare, 10);
			expect(pace.daysLeft).toBe(daysLeft);
		},
	);
});

describe("monthState: status against Pace", () => {
	// 30-day month, $300 allowance: by the 10th Pace says $100 spent.
	const statusAfter = (spent: number) =>
		monthState({
			plan: planOf("2026-09", { b: 30_000 }),
			asOf: "2026-09-10",
			spending: spent ? [spend("b", spent, "2026-09-05")] : [],
		}).buckets[0]?.status;

	it.each([
		[0, "on-pace"], // behind Pace is fine
		[10_000, "on-pace"], // exactly on Pace
		[10_900, "on-pace"], // within 3% of the allowance ($9)
		[10_901, "ahead"],
		[30_000, "ahead"], // all spent, none over
		[30_001, "over"],
	] as const)("spending %i¢ is %s", (spent, status) => {
		expect(statusAfter(spent)).toBe(status);
	});

	it("treats any spending from a zero allowance as over", () => {
		const state = monthState({
			plan: planOf("2026-09", { empty: 0 }),
			asOf: "2026-09-10",
			spending: [spend("empty", 1, "2026-09-02")],
		});
		expect(state.buckets[0]?.status).toBe("over");
	});

	it("keeps an untouched zero allowance on Pace", () => {
		const state = monthState({
			plan: planOf("2026-09", { empty: 0 }),
			asOf: "2026-09-10",
			spending: [],
		});
		expect(state.buckets[0]).toMatchObject({ status: "on-pace", left: 0, pace: { spent: 0 } });
	});
});
