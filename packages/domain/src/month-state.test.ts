import { describe, expect, it } from "vitest";
import {
	type Cadence,
	type Charge,
	type DayKey,
	dueDatesIn,
	type GoalFunding,
	type MonthKey,
	monthState,
	type Plan,
	type PlanCommitment,
	paymentsView,
	type Spend,
} from "./index";

const planOf = (
	month: MonthKey,
	allowances: Record<string, number>,
	takeHomePay = 500_000,
): Plan => ({
	month,
	baseline: takeHomePay,
	commitments: [],
	buckets: Object.entries(allowances).map(([id, allowance], i) => ({
		id,
		name: id,
		color: i + 1,
		allowance,
		rolling: false,
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
	it("is take-home pay less every allowance, whatever has been spent", () => {
		const state = monthState({
			plan: planOf("2026-09", { groceries: 120_000, hockey: 40_000 }, 500_000),
			asOf: "2026-09-15",
			spending: [spend("groceries", 50_000, "2026-09-02")],
		});
		expect(state.planned).toBe(160_000);
		expect(state.freeToSpend).toBe(340_000);
	});

	it("goes negative, not zero, when allowances exceed take-home pay", () => {
		const state = monthState({
			plan: planOf("2026-09", { groceries: 300_000, hockey: 250_000 }, 500_000),
			asOf: "2026-09-15",
			spending: [],
		});
		expect(state.freeToSpend).toBe(-50_000);
	});
});

describe("monthState: Goal funding", () => {
	const plan = planOf("2026-09", { groceries: 120_000, hockey: 40_000 }, 500_000);
	const funding = (goalId: string, amount: number, month: MonthKey = "2026-09"): GoalFunding => ({
		goalId,
		amount,
		month,
	});

	it("comes out of Free to Spend, leaving every Bucket alone", () => {
		const state = monthState({
			plan,
			asOf: "2026-09-15",
			spending: [],
			goalFunding: [funding("braces", 25_000), funding("vacation", 10_000)],
		});
		expect(state.fundedGoals).toBe(35_000);
		expect(state.freeToSpend).toBe(340_000 - 35_000);
		expect(state.buckets.map((b) => b.left)).toEqual([120_000, 40_000]);
		expect(state.leftInBuckets).toBe(160_000);
	});

	it("ignores Goal funding in other months", () => {
		const state = monthState({
			plan,
			asOf: "2026-09-15",
			spending: [],
			goalFunding: [funding("braces", 25_000, "2026-08"), funding("braces", 25_000, "2026-10")],
		});
		expect(state.fundedGoals).toBe(0);
		expect(state.freeToSpend).toBe(340_000);
	});

	it("can take Free to Spend negative, like any other assignment beyond take-home pay", () => {
		const state = monthState({
			plan,
			asOf: "2026-09-15",
			spending: [],
			goalFunding: [funding("braces", 400_000)],
		});
		expect(state.freeToSpend).toBe(-60_000);
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

const commitment = (
	id: string,
	amount: number,
	cadence: Cadence,
	dueDate: DayKey,
): PlanCommitment => ({ id, name: id, amount, cadence, dueDate });

const charge = (commitmentId: string, amount: number, date: DayKey): Charge => ({
	commitmentId,
	amount,
	date,
});

describe("Commitment cadences: the days a Commitment is due in a month", () => {
	it.each([
		// Monthly: once a month on the due date's day, or the month's last day when it's shorter.
		["monthly", "2026-09-15", "2026-09", ["2026-09-15"]],
		["monthly", "2026-09-15", "2027-01", ["2027-01-15"]],
		["monthly", "2026-01-31", "2026-03", ["2026-03-31"]],
		["monthly", "2026-01-31", "2026-04", ["2026-04-30"]],
		["monthly", "2026-01-31", "2026-02", ["2026-02-28"]],
		["monthly", "2026-01-31", "2028-02", ["2028-02-29"]],
		["monthly", "2026-01-01", "2026-12", ["2026-12-01"]],
		// Every 14 days, both before and after the due date: two or three a month.
		["biweekly", "2026-01-02", "2026-01", ["2026-01-02", "2026-01-16", "2026-01-30"]],
		["biweekly", "2026-01-02", "2026-02", ["2026-02-13", "2026-02-27"]],
		["biweekly", "2026-01-02", "2026-05", ["2026-05-08", "2026-05-22"]],
		["biweekly", "2026-01-02", "2025-12", ["2025-12-05", "2025-12-19"]],
		// Month edges: the 1st and the last day both count.
		["biweekly", "2026-10-31", "2026-10", ["2026-10-03", "2026-10-17", "2026-10-31"]],
		["biweekly", "2026-10-31", "2026-11", ["2026-11-14", "2026-11-28"]],
		["biweekly", "2026-12-25", "2027-01", ["2027-01-08", "2027-01-22"]],
		// Leap years: Feb 29 is a real day in the count.
		["biweekly", "2028-02-01", "2028-02", ["2028-02-01", "2028-02-15", "2028-02-29"]],
		["biweekly", "2027-02-01", "2027-02", ["2027-02-01", "2027-02-15"]],
		["biweekly", "2028-02-15", "2028-03", ["2028-03-14", "2028-03-28"]],
		["biweekly", "2027-02-15", "2027-03", ["2027-03-01", "2027-03-15", "2027-03-29"]],
		// Annual: in the due date's month each year, and no other.
		["annual", "2027-03-15", "2026-03", ["2026-03-15"]],
		["annual", "2027-03-15", "2027-03", ["2027-03-15"]],
		["annual", "2027-03-15", "2026-09", []],
		["annual", "2026-12-31", "2027-12", ["2027-12-31"]],
		["annual", "2026-12-31", "2027-01", []],
		["annual", "2028-02-29", "2029-02", ["2029-02-28"]],
		["annual", "2028-02-29", "2032-02", ["2032-02-29"]],
	] as const)("%s due %s: in %s on %j", (cadence, dueDate, month, expected) => {
		expect(dueDatesIn({ cadence, dueDate }, month)).toEqual(expected);
	});
});

describe("monthState: Commitments count against take-home pay", () => {
	const plan = (month: MonthKey): Plan => ({
		...planOf(month, { groceries: 120_000 }, 900_000),
		commitments: [
			commitment("mortgage", 250_000, "monthly", "2026-09-01"),
			commitment("daycare", 60_000, "biweekly", "2026-09-04"),
			commitment("insurance", 90_000, "annual", "2027-03-01"),
		],
	});
	const state = (month: MonthKey, charges: Charge[] = []) =>
		monthState({ plan: plan(month), spending: [], charges, asOf: `${month}-15` as DayKey });

	it.each([
		// month, what the Commitments are expected to take, Free to Spend
		["2026-09", 250_000 + 2 * 60_000, 900_000 - 370_000 - 120_000], // daycare Sep 4, 18
		["2026-10", 250_000 + 3 * 60_000, 900_000 - 430_000 - 120_000], // daycare Oct 2, 16, 30
		["2027-03", 250_000 + 2 * 60_000 + 90_000, 900_000 - 460_000 - 120_000], // insurance's month
	] as const)("in %s, takes %i and leaves %i Free to Spend", (month, committed, free) => {
		expect(state(month).committed).toBe(committed);
		expect(state(month).freeToSpend).toBe(free);
	});

	it("sums each Commitment's expected amount for the month", () => {
		expect(
			state("2026-10").commitments.map(({ id, dueDates, expected }) => ({
				id,
				dueDates,
				expected,
			})),
		).toEqual([
			{ id: "mortgage", dueDates: ["2026-10-01"], expected: 250_000 },
			{ id: "daycare", dueDates: ["2026-10-02", "2026-10-16", "2026-10-30"], expected: 180_000 },
			{ id: "insurance", dueDates: [], expected: 0 },
		]);
	});

	it("goes negative when Commitments and allowances exceed take-home pay", () => {
		const over = monthState({
			plan: { ...plan("2026-09"), baseline: 400_000 },
			spending: [],
			asOf: "2026-09-15",
		});
		expect(over.freeToSpend).toBe(400_000 - 370_000 - 120_000);
	});

	it("isn't changed by what was actually charged", () => {
		expect(state("2026-09", [charge("mortgage", 262_000, "2026-09-01")]).freeToSpend).toBe(
			state("2026-09").freeToSpend,
		);
	});
});

describe("monthState: each Commitment's expected against actual", () => {
	const plan: Plan = {
		...planOf("2026-09", {}),
		commitments: [
			commitment("mortgage", 250_000, "monthly", "2026-09-01"),
			commitment("daycare", 60_000, "biweekly", "2026-09-04"),
			commitment("insurance", 90_000, "annual", "2027-03-01"),
		],
	};
	const stateOf = (id: string, charges: Charge[]) => {
		const state = monthState({ plan, spending: [], charges, asOf: "2026-09-20" });
		const found = state.commitments.find((c) => c.id === id);
		return found && { actual: found.actual, difference: found.difference, status: found.status };
	};

	it.each([
		["mortgage", [], { actual: 0, difference: 0, status: "upcoming" }],
		[
			"mortgage",
			[charge("mortgage", 250_000, "2026-09-01")],
			{ actual: 250_000, difference: 0, status: "paid" },
		],
		// A charge for more or less than expected is flagged by how much it differs.
		[
			"mortgage",
			[charge("mortgage", 262_050, "2026-09-01")],
			{ actual: 262_050, difference: 12_050, status: "differs" },
		],
		[
			"mortgage",
			[charge("mortgage", 240_000, "2026-09-01")],
			{ actual: 240_000, difference: -10_000, status: "differs" },
		],
		// Charged more often than it's due: the extra charge wasn't expected at all.
		[
			"mortgage",
			[charge("mortgage", 250_000, "2026-09-01"), charge("mortgage", 250_000, "2026-09-02")],
			{ actual: 500_000, difference: 250_000, status: "differs" },
		],
		// Biweekly, due twice: one charge so far is still upcoming, not short.
		[
			"daycare",
			[charge("daycare", 60_000, "2026-09-04")],
			{ actual: 60_000, difference: 0, status: "upcoming" },
		],
		[
			"daycare",
			[charge("daycare", 60_000, "2026-09-04"), charge("daycare", 60_000, "2026-09-18")],
			{ actual: 120_000, difference: 0, status: "paid" },
		],
		[
			"daycare",
			[charge("daycare", 60_000, "2026-09-04"), charge("daycare", 64_500, "2026-09-18")],
			{ actual: 124_500, difference: 4_500, status: "differs" },
		],
		// Annual, in another month.
		["insurance", [], { actual: 0, difference: 0, status: "not-due" }],
		[
			"insurance",
			[charge("insurance", 90_000, "2026-09-10")],
			{ actual: 90_000, difference: 90_000, status: "differs" },
		],
	] as const)("%s charged %j is %j", (id, charges, expected) => {
		expect(stateOf(id, [...charges])).toEqual(expected);
	});

	it("ignores charges in other months and against Commitments not in the Plan", () => {
		expect(
			stateOf("mortgage", [
				charge("mortgage", 250_000, "2026-08-31"),
				charge("mortgage", 250_000, "2026-10-01"),
				charge("ended", 5_000, "2026-09-10"),
			]),
		).toEqual({ actual: 0, difference: 0, status: "upcoming" });
	});
});

describe("monthState: Paid back into a Commitment isn't a payment of it", () => {
	const plan: Plan = {
		...planOf("2026-09", {}),
		commitments: [commitment("tuition", 60_000, "monthly", "2026-09-01")],
	};
	const stateOf = (charges: Charge[]) => {
		const state = monthState({ plan, spending: [], charges, asOf: "2026-09-20" });
		const {
			actual,
			charges: paid,
			difference,
			status,
		} = state.commitments[0] as NonNullable<(typeof state.commitments)[0]>;
		return { actual, paid, difference, status };
	};
	const paid: Charge = { commitmentId: "tuition", amount: 120_000, date: "2026-09-01" };
	const back: Charge = {
		commitmentId: "tuition",
		amount: -60_000,
		date: "2026-09-12",
		paidBack: true,
	};

	it("is over by the part owed back until the money comes, then as planned", () => {
		expect(stateOf([paid])).toEqual({
			actual: 120_000,
			paid: 1,
			difference: 60_000,
			status: "differs",
		});
		expect(stateOf([paid, back])).toEqual({
			actual: 60_000,
			paid: 1,
			difference: 0,
			status: "paid",
		});
	});

	it("doesn't mark the bill paid when only the money back has come", () => {
		const state = stateOf([back]);
		expect(state.paid).toBe(0);
		expect(state.actual).toBe(-60_000);
		expect(state.status).not.toBe("paid");
	});
});

describe("monthState: what was Paid back this month is said apart from what was paid or spent", () => {
	const plan: Plan = {
		...planOf("2026-10", { kids: 30_000 }),
		commitments: [commitment("tuition", 60_000, "monthly", "2026-09-01")],
	};
	const back: Charge = {
		commitmentId: "tuition",
		amount: -60_000,
		date: "2026-10-03",
		paidBack: true,
		who: "Casey",
	};
	const tuitionOf = (charges: Charge[]) => {
		const state = monthState({ plan, spending: [], charges, asOf: "2026-10-20" });
		return state.commitments[0] as NonNullable<(typeof state.commitments)[0]>;
	};

	it("keeps how much came back into a Commitment, and from whom", () => {
		expect(tuitionOf([back]).paidBack).toEqual({ amount: 60_000, who: ["Casey"] });
		expect(
			tuitionOf([back, { ...back, amount: -2_500 as never, who: "casey" }, { ...back, who: "Sam" }])
				.paidBack,
		).toEqual({ amount: 122_500, who: ["Casey", "Sam"] });
		expect(tuitionOf([]).paidBack).toBeUndefined();
	});

	it("reads a month with only the money back as not paid yet, never as a negative payment", () => {
		const row = paymentsView(tuitionOf([back]));
		expect(row).toMatchObject({ actual: 0, difference: 0, status: "upcoming", charges: 0 });
		expect(row.paidBack).toEqual({ amount: 60_000, who: ["Casey"] });
	});

	it("reads this month's own payment as paid when last month's money comes back", () => {
		const paid: Charge = { commitmentId: "tuition", amount: 60_000, date: "2026-10-01" };
		expect(tuitionOf([paid, back])).toMatchObject({ actual: 0, difference: -60_000 });
		expect(paymentsView(tuitionOf([paid, back]))).toMatchObject({
			actual: 60_000,
			difference: 0,
			status: "paid",
		});
	});

	it("leaves a month alone where the money back only brings it down to what was planned", () => {
		const shared: Charge = { commitmentId: "tuition", amount: 120_000, date: "2026-10-01" };
		const state = tuitionOf([shared, back]);
		expect(paymentsView(state)).toBe(state);
		expect(state).toMatchObject({ actual: 60_000, difference: 0, status: "paid" });
		const plain = tuitionOf([shared]);
		expect(paymentsView(plain)).toBe(plain);
	});

	it("keeps apart what a linked Refund gave back from what was Paid back", () => {
		const state = monthState({
			plan,
			spending: [
				{ bucketId: "kids", amount: -4_500 as never, date: "2026-10-03", paidBack: true },
				{
					bucketId: "kids",
					amount: -2_000 as never,
					date: "2026-10-05",
					paidBack: true,
					refund: true,
				},
			],
			charges: [
				{
					commitmentId: "tuition",
					amount: -60_000,
					date: "2026-10-06",
					paidBack: true,
					who: "Casey",
				},
				{
					commitmentId: "tuition",
					amount: -2_000,
					date: "2026-10-07",
					paidBack: true,
					refund: true,
				},
			] as Charge[],
			asOf: "2026-10-20",
		});
		expect(state.buckets[0]).toMatchObject({ spent: -6_500, paidBack: 6_500, refunded: 2_000 });
		expect(state.commitments[0]?.paidBack).toEqual({
			amount: 62_000,
			who: ["Casey"],
			refunded: 2_000,
		});
		// With no Refund among it, nothing says "refunded".
		const plain = monthState({
			plan,
			spending: [{ bucketId: "kids", amount: -4_500 as never, date: "2026-10-03", paidBack: true }],
			charges: [],
			asOf: "2026-10-20",
		});
		expect(plain.buckets[0]?.refunded).toBeUndefined();
	});

	it("keeps how much came back into a Bucket", () => {
		const bucketOf = (spending: Parameters<typeof monthState>[0]["spending"]) =>
			monthState({ plan, spending, charges: [], asOf: "2026-10-20" }).buckets[0];
		expect(
			bucketOf([
				{ bucketId: "kids", amount: -4_500 as never, date: "2026-10-03", paidBack: true },
				{ bucketId: "kids", amount: 1_000 as never, date: "2026-10-04" },
			]),
		).toMatchObject({ spent: -3_500, paidBack: 4_500 });
		expect(
			bucketOf([{ bucketId: "kids", amount: 1_000 as never, date: "2026-10-04" }])?.paidBack,
		).toBeUndefined();
	});
});
