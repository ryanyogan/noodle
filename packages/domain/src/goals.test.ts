import { describe, expect, it } from "vitest";
import {
	ACCOUNT_KINDS,
	accountBalance,
	attributeWithdrawal,
	canPayOff,
	type DayKey,
	goalHistory,
	goalProgress,
	holdsMoney,
	type MonthKey,
	monthState,
	owedFor,
	paidDownOf,
	projectionGoalOf,
	type SetAsideChange,
	setAsideOf,
	splitAccount,
	stillToFund,
} from "./index";

const change = (
	goalId: string,
	kind: SetAsideChange["kind"],
	amount: number,
	month: MonthKey = "2026-09",
): SetAsideChange => ({ goalId, kind, amount, month });

describe("holdsMoney: only checking and savings Accounts can back a Goal", () => {
	it.each([
		["checking", true],
		["savings", true],
		["credit-card", false],
		["loan", false],
	] as const)("%s: %s", (kind, holds) => {
		expect(holdsMoney(kind)).toBe(holds);
	});
});

describe("accountBalance", () => {
	it("is null until a balance is entered", () => {
		expect(accountBalance(null, [{ amount: 5_000, at: 10 }])).toBeNull();
	});

	it("is the latest balance less the withdrawals recorded after it", () => {
		const latest = { amount: 1_200_000, at: 100 };
		expect(
			accountBalance(latest, [
				// Already in the balance the Parent entered.
				{ amount: 30_000, at: 50 },
				{ amount: 45_000, at: 150 },
				// Recorded the same millisecond: taken as after the balance.
				{ amount: 5_000, at: 100 },
			]),
		).toBe(1_150_000);
	});
});

describe("setAsideOf: what a Goal has set aside", () => {
	it("sums claims, funding, and spending for that Goal only", () => {
		expect(
			setAsideOf("braces", [
				change("braces", "claim", 800_000, "2026-08"),
				change("braces", "funding", 25_000),
				change("braces", "spending", -300_000),
				change("braces", "claim", -10_000),
				change("vacation", "funding", 50_000),
			]),
		).toBe(515_000);
	});
});

describe("splitAccount: what Goals have set aside and not set aside", () => {
	const goals = [
		{ id: "braces", archived: false },
		{ id: "vacation", archived: false },
		{ id: "old-car", archived: true },
	];
	const changes = [
		change("braces", "claim", 400_000),
		change("vacation", "funding", 100_000),
		change("old-car", "claim", 300_000),
	];

	it("leaves what no Goal claims not set aside; archived Goals claim nothing", () => {
		expect(splitAccount({ balance: 1_000_000, goals, changes })).toEqual({
			earmarks: [
				{ goalId: "braces", amount: 400_000 },
				{ goalId: "vacation", amount: 100_000 },
			],
			earmarked: 500_000,
			unclaimed: 500_000,
			overClaimedBy: 0,
		});
	});

	it("says by how much what Goals have set aside exceed the balance", () => {
		const split = splitAccount({ balance: 450_000, goals, changes });
		expect(split.unclaimed).toBe(-50_000);
		expect(split.overClaimedBy).toBe(50_000);
	});

	it("has no not set aside until the Account has a balance", () => {
		const split = splitAccount({ balance: null, goals, changes });
		expect(split.earmarked).toBe(500_000);
		expect(split.unclaimed).toBeNull();
		expect(split.overClaimedBy).toBe(0);
	});
});

describe("goalProgress", () => {
	// $1,200 by Dec 20, started in July: an even $200 a month over six months.
	const braces = {
		id: "braces",
		target: 120_000,
		targetDate: "2026-12-20" as DayKey,
		fromMonth: "2026-07" as MonthKey,
	};

	it("is on track when earlier months' shares were saved", () => {
		const progress = goalProgress(
			braces,
			[
				change("braces", "funding", 20_000, "2026-07"),
				change("braces", "funding", 20_000, "2026-08"),
			],
			"2026-09",
		);
		expect(progress).toEqual({
			saved: 40_000,
			remaining: 80_000,
			share: 1 / 3,
			fundedThisMonth: 0,
			monthsLeft: 4,
			monthly: 20_000,
			leftThisMonth: 20_000,
			status: "on-track",
		});
	});

	it("is behind when an earlier month's share was missed, and asks for more each month", () => {
		const progress = goalProgress(
			braces,
			[change("braces", "funding", 20_000, "2026-07")],
			"2026-09",
		);
		expect(progress.status).toBe("behind");
		expect(progress.monthly).toBe(25_000);
		expect(progress.leftThisMonth).toBe(25_000);
	});

	it("keeps this month's amount steady as it's funded, and catching up puts it back on track", () => {
		const earlier = [change("braces", "funding", 20_000, "2026-07")];
		const part = goalProgress(braces, [...earlier, change("braces", "funding", 10_000)], "2026-09");
		expect(part).toMatchObject({
			fundedThisMonth: 10_000,
			monthly: 25_000,
			leftThisMonth: 15_000,
			status: "behind",
		});
		const all = goalProgress(
			braces,
			[...earlier, change("braces", "funding", 10_000), change("braces", "funding", 15_000)],
			"2026-09",
		);
		expect(all).toMatchObject({ monthly: 25_000, leftThisMonth: 0, status: "on-track" });
	});

	it("counts money set aside from not set aside this month as already saved", () => {
		const progress = goalProgress(braces, [change("braces", "claim", 60_000)], "2026-09");
		expect(progress).toMatchObject({ saved: 60_000, monthly: 15_000, leftThisMonth: 15_000 });
	});

	it("lowers what's saved when the Goal is spent", () => {
		const progress = goalProgress(
			braces,
			[change("braces", "claim", 120_000, "2026-07"), change("braces", "spending", -30_000)],
			"2026-09",
		);
		expect(progress).toMatchObject({ saved: 90_000, remaining: 30_000, status: "on-track" });
	});

	it("asks for everything still to save when the target is this month", () => {
		const progress = goalProgress(
			braces,
			[
				change("braces", "funding", 100_000, "2026-11"),
				change("braces", "funding", 5_000, "2026-12"),
			],
			"2026-12",
		);
		expect(progress).toMatchObject({ monthsLeft: 1, monthly: 20_000, leftThisMonth: 15_000 });
	});

	it("counts months across the new year", () => {
		const progress = goalProgress(
			{ ...braces, targetDate: "2027-01-05", fromMonth: "2026-12" },
			[],
			"2026-12",
		);
		expect(progress).toMatchObject({ monthsLeft: 2, monthly: 60_000, status: "on-track" });
	});

	it("is on track with the whole target to save when created in its target month", () => {
		const progress = goalProgress({ ...braces, fromMonth: "2026-12" }, [], "2026-12");
		expect(progress).toMatchObject({
			monthsLeft: 1,
			monthly: 120_000,
			leftThisMonth: 120_000,
			status: "on-track",
		});
	});

	it("is past due once the target's month has passed short of the target", () => {
		const progress = goalProgress(
			braces,
			[change("braces", "claim", 50_000, "2026-07")],
			"2027-01",
		);
		expect(progress).toMatchObject({
			remaining: 70_000,
			monthsLeft: 0,
			monthly: null,
			leftThisMonth: null,
			status: "past-due",
		});
	});

	it("is reached at the target, with nothing more to fund", () => {
		const progress = goalProgress(
			braces,
			[change("braces", "claim", 130_000, "2026-07")],
			"2027-01",
		);
		expect(progress).toMatchObject({
			remaining: 0,
			share: 1,
			monthly: 0,
			leftThisMonth: 0,
			status: "reached",
		});
	});

	it("just saves toward an undated Goal, with no schedule", () => {
		const undated = { ...braces, targetDate: null };
		expect(goalProgress(undated, [change("braces", "funding", 30_000)], "2026-09")).toEqual({
			saved: 30_000,
			remaining: 90_000,
			share: 0.25,
			fundedThisMonth: 30_000,
			monthsLeft: null,
			monthly: null,
			leftThisMonth: null,
			status: "saving",
		});
		expect(goalProgress(undated, [change("braces", "claim", 120_000)], "2026-09").status).toBe(
			"reached",
		);
	});
});

describe("attributeWithdrawal (ADR-0002)", () => {
	const account = { balanceBefore: 1_000_000, earmarked: 700_000 };

	it("goes to the Goal it's assigned to", () => {
		expect(attributeWithdrawal({ amount: 900_000, goalId: "braces" }, account)).toEqual({
			kind: "goal",
			goalId: "braces",
		});
	});

	it("comes out of not set aside money when that covers it", () => {
		expect(attributeWithdrawal({ amount: 300_000, goalId: null }, account)).toEqual({
			kind: "unclaimed",
		});
	});

	it("comes out of not set aside money when nothing is earmarked", () => {
		expect(
			attributeWithdrawal(
				{ amount: 2_000_000, goalId: null },
				{ balanceBefore: 1_000_000, earmarked: 0 },
			),
		).toEqual({ kind: "unclaimed" });
	});

	it("goes to Review for what it takes from what Goals have set aside", () => {
		expect(attributeWithdrawal({ amount: 450_000, goalId: null }, account)).toEqual({
			kind: "review",
			fromEarmarks: 150_000,
		});
		// Already over-claimed: all of it comes from what Goals have set aside.
		expect(
			attributeWithdrawal(
				{ amount: 50_000, goalId: null },
				{ balanceBefore: 600_000, earmarked: 700_000 },
			),
		).toEqual({ kind: "review", fromEarmarks: 50_000 });
	});
});

describe("stillToFund", () => {
	it("totals what dated Goals still need, while Goal funding counts every Goal", () => {
		// Braces needs $300 this month ($1,200 over four months) and has $50 of it; the undated Rainy day took $1,300.
		const braces = {
			id: "braces",
			target: 120_000,
			targetDate: "2026-12-20" as DayKey,
			fromMonth: "2026-09" as MonthKey,
		};
		const rainy = {
			id: "rainy",
			target: 3_000_000,
			targetDate: null,
			fromMonth: "2026-01" as MonthKey,
		};
		const changes = [
			change("braces", "funding", 5_000),
			change("rainy", "claim", 2_000_000, "2026-01"),
			change("rainy", "funding", 130_000),
		];
		const progress = [braces, rainy].map((g) => goalProgress(g, changes, "2026-09"));
		expect(stillToFund(progress)).toBe(30_000 - 5_000);
		// The funded side is the month's Goal funding, as Free to Spend takes it: both Goals.
		const state = monthState({
			plan: { month: "2026-09", baseline: 600_000, commitments: [], buckets: [] },
			spending: [],
			goalFunding: [
				{ goalId: "braces", amount: 5_000, month: "2026-09" },
				{ goalId: "rainy", amount: 130_000, month: "2026-09" },
			],
			asOf: "2026-09-15",
		});
		expect(state.fundedGoals).toBe(135_000);
	});

	it("needs nothing from reached, undated or past-due Goals", () => {
		expect(stillToFund([{ leftThisMonth: null }, { leftThisMonth: 0 }])).toBe(0);
	});
});

describe("goalHistory", () => {
	it("lists changes by when they happened, newest month first, not by when they were recorded", () => {
		const at = (
			id: string,
			kind: SetAsideChange["kind"],
			amount: number,
			month: MonthKey,
			date?: DayKey,
		) => ({
			...change("fund", kind, amount, month),
			id,
			...(date ? { date } : {}),
		});
		// Recorded in this order: May's Sweep last, a July spend entered in September.
		const changes = [
			at("01", "funding", 50_000, "2026-09"),
			at("02", "spending", -12_000, "2026-07", "2026-07-20"),
			at("03", "funding", 30_000, "2026-07"),
			at("04", "spending", -4_000, "2026-09", "2026-09-12"),
			at("05", "funding", 8_000, "2026-05"),
		];
		const history = goalHistory(changes);
		expect(history.map((m) => [m.month, m.net])).toEqual([
			["2026-09", 46_000],
			["2026-07", 18_000],
			["2026-05", 8_000],
		]);
		// Within a month, the dated spending before the month's funding.
		expect(history[0]?.changes.map((c) => c.id)).toEqual(["04", "01"]);
		expect(history[1]?.changes.map((c) => c.id)).toEqual(["02", "03"]);
	});
});

describe("payoff Goals (ADR-0019)", () => {
	const card = {
		id: "card",
		target: 600_000,
		targetDate: "2027-02-28" as DayKey,
		fromMonth: "2026-07" as MonthKey,
	};

	describe("paidDownOf", () => {
		it.each([
			[450_000, 150_000],
			[600_000, 0],
			// New charges took it above what was owed: nothing paid down, never negative.
			[700_000, 0],
			[0, 600_000],
			// A credit on the card counts as paid off, no more.
			[-5_000, 600_000],
			[null, 0],
		])("owing %s has paid down %s", (owed, paid) => {
			expect(paidDownOf(600_000, owed)).toBe(paid);
		});
	});

	describe("owedFor", () => {
		const accounts = [
			{ id: "visa", latestBalance: { amount: 45_000, at: 1 } },
			{ id: "new-card", latestBalance: null },
		];
		it("is the card's latest balance", () => {
			expect(owedFor({ kind: "payoff", accountId: "visa" }, accounts)).toBe(45_000);
		});
		it("is null without a balance, and for a savings Goal", () => {
			expect(owedFor({ kind: "payoff", accountId: "new-card" }, accounts)).toBeNull();
			expect(owedFor({ kind: "save", accountId: "visa" }, accounts)).toBeNull();
		});
	});

	describe("goalProgress of a payoff Goal", () => {
		const progress = (owed: number | null, changes: SetAsideChange[] = [], month = "2026-09") =>
			goalProgress({ ...card, kind: "payoff", owed }, changes, month as MonthKey);

		it("is paid down from the target to what's owed, with what's owed still to go", () => {
			expect(progress(450_000)).toMatchObject({
				saved: 150_000,
				remaining: 450_000,
				share: 0.25,
				status: "on-track",
			});
		});

		it("needs what's owed spread over the months left, this one included", () => {
			// September to February is 6 months: $4,500 / 6.
			expect(progress(450_000)).toMatchObject({ monthsLeft: 6, monthly: 75_000 });
		});

		it("counts this month's funding against the month's need, never as progress", () => {
			const funded = progress(450_000, [
				change("card", "funding", 50_000),
				change("card", "funding", 40_000, "2026-08"),
				change("other", "funding", 99_000),
			]);
			expect(funded).toMatchObject({
				saved: 150_000,
				fundedThisMonth: 50_000,
				monthly: 75_000,
				leftThisMonth: 25_000,
			});
		});

		it("is behind when paid down is short of an even schedule from the month it was added", () => {
			// July to February is 8 months; by September's start 2/8 of $6,000 ($1,500) is expected.
			expect(progress(460_000).status).toBe("behind");
			expect(progress(450_000).status).toBe("on-track");
		});

		it("loses progress when new charges take what's owed back up", () => {
			expect(progress(650_000)).toMatchObject({ saved: 0, remaining: 650_000, share: 0 });
		});

		it("is reached (paid off) at $0 owed", () => {
			expect(progress(0)).toMatchObject({
				saved: 600_000,
				remaining: 0,
				share: 1,
				monthly: 0,
				leftThisMonth: 0,
				status: "reached",
			});
		});

		it("is past due once its date's month has gone with something still owed", () => {
			expect(progress(10_000, [], "2027-03")).toMatchObject({ status: "past-due", monthly: null });
		});

		it("has no schedule without a target date", () => {
			const undated = (owed: number) =>
				goalProgress({ ...card, targetDate: null, kind: "payoff", owed }, [], "2026-09");
			expect(undated(300_000)).toMatchObject({ status: "saving", monthly: null, saved: 300_000 });
			expect(undated(0).status).toBe("reached");
		});

		it("has nothing paid down until the card has a balance", () => {
			expect(progress(null)).toMatchObject({ saved: 0, remaining: 600_000 });
		});
	});

	describe("projectionGoalOf", () => {
		it("is what a savings Goal has set aside", () => {
			const changes = [change("g", "claim", 10_000), change("g", "funding", 5_000)];
			expect(
				projectionGoalOf(
					{ id: "g", target: 50_000, targetDate: null, fromMonth: "2026-01" },
					changes,
					"2026-09",
				),
			).toEqual({
				id: "g",
				target: 50_000,
				targetDate: null,
				saved: 15_000,
				fundedThisMonth: 5_000,
				fundedElsewhereThisMonth: 0,
			});
		});

		it("projects a payoff Goal from what it has paid down, as if this month's funding is paid", () => {
			const changes = [change("card", "funding", 50_000), change("card", "funding", 1, "2026-08")];
			expect(
				projectionGoalOf({ ...card, kind: "payoff", owed: 450_000 }, changes, "2026-09"),
			).toEqual({
				id: "card",
				target: 600_000,
				targetDate: "2027-02-28",
				saved: 200_000,
				fundedThisMonth: 50_000,
				fundedElsewhereThisMonth: 0,
			});
		});
	});

	it("canPayOff: credit cards and loans", () => {
		expect(ACCOUNT_KINDS.filter(canPayOff)).toEqual(["credit-card", "loan"]);
	});
});
