import { describe, expect, it } from "vitest";
import {
	type DayKey,
	extraIncomeOf,
	extraIncomeSuggestions,
	type Income,
	incomeCheck,
	type MonthKey,
	monthState,
	type Plan,
} from "./index";

const planOf = (month: MonthKey, takeHomePay: number | null = 600_000): Plan => ({
	month,
	baseline: takeHomePay,
	commitments: [],
	buckets: [
		{ id: "groceries", name: "Groceries", color: 1, allowance: 120_000, rolling: false },
		{ id: "fun", name: "Fun", color: 2, allowance: 40_000, rolling: false },
	],
});

const paid = (date: DayKey, amount: number): Income => ({ date, amount });

describe("extraIncomeOf", () => {
	it("is the income beyond take-home pay, less what's been decided", () => {
		expect(extraIncomeOf({ baseline: 600_000, received: 750_000, decided: 0 })).toEqual({
			windfall: 150_000,
			pending: 150_000,
		});
		expect(extraIncomeOf({ baseline: 600_000, received: 750_000, decided: 100_000 })).toEqual({
			windfall: 150_000,
			pending: 50_000,
		});
	});

	it("is nothing until income passes take-home pay, or without a take-home pay", () => {
		expect(extraIncomeOf({ baseline: 600_000, received: 450_000, decided: 0 })).toEqual({
			windfall: 0,
			pending: 0,
		});
		expect(extraIncomeOf({ baseline: null, received: 450_000, decided: 0 }).windfall).toBe(0);
	});
});

describe("monthState: the Extra income", () => {
	// Biweekly paychecks of $3,000 on a $6,000 take-home pay.
	const biweekly = [
		paid("2026-10-02", 300_000),
		paid("2026-10-16", 300_000),
		paid("2026-10-30", 300_000),
	];

	it("makes a 3-paycheck month's third paycheck Extra income once it lands", () => {
		const plan = planOf("2026-10");
		const third = monthState({ plan, spending: [], income: biweekly, asOf: "2026-10-30" });
		expect(third).toMatchObject({ received: 900_000, windfall: 300_000, windfallLeft: 300_000 });
		const twoPaychecks = monthState({
			plan,
			spending: [],
			income: biweekly.slice(0, 2),
			asOf: "2026-10-29",
		});
		expect(twoPaychecks).toMatchObject({ received: 600_000, windfall: 0, windfallLeft: 0 });
	});

	it("counts a bonus beyond take-home pay, and only this month's income", () => {
		const state = monthState({
			plan: planOf("2026-10"),
			spending: [],
			income: [
				paid("2026-09-30", 300_000),
				paid("2026-10-01", 300_000),
				paid("2026-10-15", 300_000),
				paid("2026-10-20", 125_000),
			],
			asOf: "2026-10-20",
		});
		expect(state).toMatchObject({ received: 725_000, windfall: 125_000, windfallLeft: 125_000 });
	});

	it("never counts a Refund of a purchase as income: it restores its Bucket instead", () => {
		const state = monthState({
			plan: planOf("2026-10"),
			spending: [
				{ bucketId: "fun", amount: 8_000, date: "2026-10-03" },
				{ bucketId: "fun", amount: -8_000, date: "2026-10-09" },
			],
			income: [paid("2026-10-01", 600_000)],
			asOf: "2026-10-10",
		});
		expect(state.windfall).toBe(0);
		expect(state.buckets.find((b) => b.id === "fun")?.left).toBe(40_000);
	});

	it("counts a tax refund recorded as income toward the Extra income", () => {
		const state = monthState({
			plan: planOf("2026-10"),
			spending: [],
			income: [paid("2026-10-01", 600_000), paid("2026-10-12", 90_000)],
			asOf: "2026-10-12",
		});
		expect(state.windfall).toBe(90_000);
	});

	it("takes Extra income Moves to Goals and Buckets off what's left, leaving Free to Spend alone", () => {
		const plan = planOf("2026-10");
		const income = [paid("2026-10-01", 600_000), paid("2026-10-20", 150_000)];
		const plain = monthState({ plan, spending: [], income, asOf: "2026-10-20" });
		const state = monthState({
			plan,
			spending: [],
			income,
			moves: [
				{ fromBucketId: null, toBucketId: "fun", amount: 20_000, month: "2026-10", windfall: true },
			],
			goalFunding: [
				{ goalId: "trip", amount: 100_000, month: "2026-10", windfall: true },
				{ goalId: "trip", amount: 5_000, month: "2026-09", windfall: true },
			],
			asOf: "2026-10-20",
		});
		expect(state).toMatchObject({ windfall: 150_000, windfallLeft: 30_000 });
		expect(state.freeToSpend).toBe(plain.freeToSpend);
		expect(state.fundedGoals).toBe(0);
		expect(state.movedToBuckets).toBe(0);
		expect(state.buckets.find((b) => b.id === "fun")).toMatchObject({
			moved: 20_000,
			left: 60_000,
		});
	});

	it("takes a Sweep out of its Bucket's leftover", () => {
		const state = monthState({
			plan: planOf("2026-10"),
			spending: [{ bucketId: "fun", amount: 15_000, date: "2026-10-03" }],
			sweeps: [
				{ bucketId: "fun", goalId: "trip", amount: 25_000, month: "2026-10" },
				{ bucketId: "fun", goalId: "trip", amount: 1_000, month: "2026-09" },
			],
			asOf: "2026-10-31",
		});
		expect(state.buckets.find((b) => b.id === "fun")).toMatchObject({ moved: -25_000, left: 0 });
	});
});

describe("incomeCheck: a warning when income is tracking below take-home pay", () => {
	const takeHomePay = 600_000;

	it("says nothing when no income is recorded this month or last", () => {
		expect(
			incomeCheck({ baseline: takeHomePay, income: [], month: "2026-10", asOf: "2026-10-20" }),
		).toBeNull();
		expect(
			incomeCheck({
				baseline: null,
				income: [paid("2026-10-01", 1)],
				month: "2026-10",
				asOf: "2026-10-20",
			}),
		).toBeNull();
	});

	it("expects what came in by the same day last month", () => {
		const income = [
			paid("2026-09-01", 300_000),
			paid("2026-09-15", 300_000),
			paid("2026-10-01", 300_000),
		];
		// The 15th's paycheck hasn't come: that's short, and it's mid-month.
		expect(
			incomeCheck({ baseline: takeHomePay, income, month: "2026-10", asOf: "2026-10-15" }),
		).toEqual({
			received: 300_000,
			expected: 600_000,
			short: 300_000,
			below: true,
		});
		// On the 14th last month had only the first paycheck too.
		expect(
			incomeCheck({ baseline: takeHomePay, income, month: "2026-10", asOf: "2026-10-14" }),
		).toMatchObject({
			expected: 300_000,
			short: 0,
			below: false,
		});
	});

	it("waits until mid-month before warning", () => {
		const income = [paid("2026-09-01", 300_000), paid("2026-09-10", 300_000)];
		expect(
			incomeCheck({ baseline: takeHomePay, income, month: "2026-10", asOf: "2026-10-12" }),
		).toMatchObject({
			short: 600_000,
			below: false,
		});
		expect(
			incomeCheck({ baseline: takeHomePay, income, month: "2026-10", asOf: "2026-10-15" })?.below,
		).toBe(true);
	});

	it("caps what's expected at take-home pay, so last month's bonus isn't expected again", () => {
		const income = [
			paid("2026-09-01", 300_000),
			paid("2026-09-05", 200_000),
			paid("2026-09-15", 300_000),
			paid("2026-10-01", 300_000),
			paid("2026-10-15", 300_000),
		];
		expect(
			incomeCheck({ baseline: takeHomePay, income, month: "2026-10", asOf: "2026-10-20" }),
		).toMatchObject({
			expected: 600_000,
			below: false,
		});
	});

	it("pro-rates take-home pay without last month to go by, and tolerates a little", () => {
		const income = [paid("2026-10-01", 280_000)];
		// 15 of October's 31 days: 15/31 of $6,000 is $2,903.23.
		expect(
			incomeCheck({ baseline: takeHomePay, income, month: "2026-10", asOf: "2026-10-15" }),
		).toMatchObject({
			expected: 290_323,
			short: 10_323,
			below: false,
		});
		expect(
			incomeCheck({ baseline: takeHomePay, income, month: "2026-10", asOf: "2026-10-31" })?.below,
		).toBe(true);
	});

	it("compares a finished month against all of last month", () => {
		const income = [paid("2026-02-27", 600_000), paid("2026-03-30", 600_000)];
		expect(
			incomeCheck({ baseline: takeHomePay, income, month: "2026-03", asOf: "2026-04-02" }),
		).toMatchObject({
			expected: 600_000,
			short: 0,
		});
	});
});

describe("extraIncomeSuggestions", () => {
	const goal = (
		id: string,
		status: "behind" | "on-track" | "past-due" | "saving" | "reached",
		targetDate: DayKey | null,
		remaining = 500_000,
	) => ({ id, name: id, status, targetDate, remaining });

	it("suggests behind Goals nearest-dated first, then the emergency Goal, then overspent Buckets", () => {
		const suggestions = extraIncomeSuggestions({
			pending: 150_000,
			goals: [
				goal("roof", "behind", "2027-06-01"),
				goal("camp", "behind", "2027-02-01", 80_000),
				goal("trip", "on-track", "2026-12-01"),
				goal("emergency", "saving", null),
			],
			emergencyGoalId: "emergency",
			buckets: [
				{ id: "fun", name: "Fun", left: -4_000 },
				{ id: "groceries", name: "Groceries", left: -12_000 },
				{ id: "hockey", name: "Hockey", left: 3_000 },
			],
		});
		expect(suggestions.map((s) => [s.name, s.amount, s.reason])).toEqual([
			["camp", 80_000, "behind"],
			["roof", 150_000, "behind"],
			["emergency", 150_000, "emergency"],
			["Groceries", 12_000, "overspent"],
			["Fun", 4_000, "overspent"],
		]);
		expect(suggestions[0]?.to).toEqual({ kind: "goal", goalId: "camp" });
		expect(suggestions[3]?.to).toEqual({ kind: "bucket", bucketId: "groceries" });
	});

	it("lists the emergency Goal once, and skips it once it's reached", () => {
		const emergency = goal("emergency", "behind", "2027-01-01");
		expect(
			extraIncomeSuggestions({
				pending: 1_000,
				goals: [emergency],
				emergencyGoalId: "emergency",
				buckets: [],
			}),
		).toHaveLength(1);
		expect(
			extraIncomeSuggestions({
				pending: 1_000,
				goals: [goal("emergency", "reached", null, 0)],
				emergencyGoalId: "emergency",
				buckets: [],
			}),
		).toEqual([]);
	});

	it("suggests nothing without a pending Extra income", () => {
		expect(
			extraIncomeSuggestions({
				pending: 0,
				goals: [goal("roof", "behind", "2027-06-01")],
				emergencyGoalId: null,
				buckets: [],
			}),
		).toEqual([]);
	});
});

describe("a few dollars above take-home pay (#86)", () => {
	it("is the usual pay, not Extra income, up to $25", () => {
		expect(extraIncomeOf({ baseline: 600_000, received: 600_437, decided: 0 })).toEqual({
			windfall: 0,
			pending: 0,
		});
		expect(extraIncomeOf({ baseline: 600_000, received: 602_500, decided: 0 }).windfall).toBe(0);
	});

	it("is all Extra income once it's more than $25", () => {
		expect(extraIncomeOf({ baseline: 600_000, received: 602_501, decided: 0 })).toEqual({
			windfall: 2_501,
			pending: 2_501,
		});
	});
});

describe("monthState: Extra income added to Free to Spend (#86)", () => {
	const income = [paid("2026-10-02", 300_000), paid("2026-10-16", 380_000)];

	it("leaves Free to Spend alone until a Parent adds it", () => {
		const state = monthState({ plan: planOf("2026-10"), spending: [], income, asOf: "2026-10-20" });
		expect(state.windfallLeft).toBe(80_000);
		expect(state.extraToFreeToSpend).toBe(0);
		expect(state.freeToSpend).toBe(
			monthState({ plan: planOf("2026-10"), spending: [], asOf: "2026-10-20" }).freeToSpend,
		);
	});

	it("raises Free to Spend by what was added, and takes it off what's left to decide", () => {
		const before = monthState({
			plan: planOf("2026-10"),
			spending: [],
			income,
			asOf: "2026-10-20",
		});
		const state = monthState({
			plan: planOf("2026-10"),
			spending: [],
			income,
			extraToFree: [
				{ amount: 50_000, month: "2026-10" },
				// Another month's is not this month's.
				{ amount: 70_000, month: "2026-09" },
			],
			asOf: "2026-10-20",
		});
		expect(state.freeToSpend).toBe(before.freeToSpend + 50_000);
		expect(state.extraToFreeToSpend).toBe(50_000);
		expect(state.windfall).toBe(80_000);
		expect(state.windfallLeft).toBe(30_000);
	});
});
