import { describe, expect, it } from "vitest";
import {
	accountBalance,
	attributeWithdrawal,
	type DayKey,
	type EarmarkChange,
	earmarkOf,
	goalProgress,
	holdsMoney,
	type MonthKey,
	splitAccount,
} from "./index";

const change = (
	goalId: string,
	kind: EarmarkChange["kind"],
	amount: number,
	month: MonthKey = "2026-09",
): EarmarkChange => ({ goalId, kind, amount, month });

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

describe("earmarkOf: a Goal's Earmark", () => {
	it("sums claims, funding, and spending for that Goal only", () => {
		expect(
			earmarkOf("braces", [
				change("braces", "claim", 800_000, "2026-08"),
				change("braces", "funding", 25_000),
				change("braces", "spending", -300_000),
				change("braces", "claim", -10_000),
				change("vacation", "funding", 50_000),
			]),
		).toBe(515_000);
	});
});

describe("splitAccount: Earmarks and Unclaimed", () => {
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

	it("leaves what no Goal claims Unclaimed; archived Goals claim nothing", () => {
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

	it("says by how much Earmarks exceed the balance", () => {
		const split = splitAccount({ balance: 450_000, goals, changes });
		expect(split.unclaimed).toBe(-50_000);
		expect(split.overClaimedBy).toBe(50_000);
	});

	it("has no Unclaimed until the Account has a balance", () => {
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

	it("counts money set aside from Unclaimed this month as already saved", () => {
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

	it("comes out of Unclaimed money when that covers it", () => {
		expect(attributeWithdrawal({ amount: 300_000, goalId: null }, account)).toEqual({
			kind: "unclaimed",
		});
	});

	it("comes out of Unclaimed money when nothing is earmarked", () => {
		expect(
			attributeWithdrawal(
				{ amount: 2_000_000, goalId: null },
				{ balanceBefore: 1_000_000, earmarked: 0 },
			),
		).toEqual({ kind: "unclaimed" });
	});

	it("goes to Review for what it takes from Earmarks", () => {
		expect(attributeWithdrawal({ amount: 450_000, goalId: null }, account)).toEqual({
			kind: "review",
			fromEarmarks: 150_000,
		});
		// Already over-claimed: all of it comes from Earmarks.
		expect(
			attributeWithdrawal(
				{ amount: 50_000, goalId: null },
				{ balanceBefore: 600_000, earmarked: 700_000 },
			),
		).toEqual({ kind: "review", fromEarmarks: 50_000 });
	});
});
