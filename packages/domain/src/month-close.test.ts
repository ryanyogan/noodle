import { describe, expect, it } from "vitest";
import {
	defaultDecision,
	fitsProposal,
	monthCloseProposal,
	monthEnd,
	monthState,
	nothingToClose,
	type Plan,
	quietEnd,
} from "./index";

const plan: Plan = {
	month: "2026-09",
	baseline: 600_000,
	commitments: [],
	buckets: [
		{ id: "groceries", name: "Groceries", color: 1, allowance: 120_000, rolling: false },
		{ id: "hockey", name: "Hockey", color: 2, allowance: 40_000, rolling: true },
		{ id: "fun", name: "Fun", color: 3, allowance: 20_000, rolling: false },
		{ id: "mine", name: "Alex", color: 4, allowance: 10_000, rolling: false, owner: "alex" },
		{ id: "gifts", name: "Gifts", color: 5, allowance: 5_000, rolling: false },
	],
};

const closing = monthState({
	plan,
	spending: [
		{ bucketId: "groceries", amount: 100_000, date: "2026-09-20" },
		{ bucketId: "fun", amount: 25_000, date: "2026-09-12" },
		{ bucketId: "gifts", amount: 1_000, date: "2026-09-03" },
	],
	sweeps: [{ bucketId: "gifts", goalId: "trip", amount: 4_000, month: "2026-09" }],
	income: [{ amount: 650_000, date: "2026-09-01" }],
	asOf: "2026-09-30",
});

describe("monthCloseProposal", () => {
	it("offers resets monthly Household Buckets' leftovers and the pending Extra income", () => {
		const proposal = monthCloseProposal(closing);
		// Hockey rolls its money over; Fun is overspent; Alex's is Alex's; Gifts was Swept already.
		expect(proposal).toEqual({
			month: "2026-09",
			leftovers: [{ bucketId: "groceries", name: "Groceries", amount: 20_000 }],
			windfall: 50_000,
		});
		expect(nothingToClose(proposal)).toBe(false);
		expect(nothingToClose({ month: "2026-09", leftovers: [], windfall: 0 })).toBe(true);
	});
});

describe("defaultDecision", () => {
	const proposal = {
		month: "2026-09" as const,
		leftovers: [
			{ bucketId: "groceries", name: "Groceries", amount: 20_000 },
			{ bucketId: "fun", name: "Fun", amount: 3_000 },
		],
		windfall: 50_000,
	};

	it("Sweeps every leftover to the emergency Goal and leaves the Extra income for the Parents", () => {
		expect(defaultDecision(proposal, "rainy-day")).toEqual({
			sweeps: [
				{ bucketId: "groceries", goalId: "rainy-day", amount: 20_000 },
				{ bucketId: "fun", goalId: "rainy-day", amount: 3_000 },
			],
			windfall: [],
		});
	});

	it("leaves everything alone without an emergency Goal", () => {
		expect(defaultDecision(proposal, null)).toEqual({ sweeps: [], windfall: [] });
	});

	it("always fits its proposal", () => {
		expect(fitsProposal(proposal, defaultDecision(proposal, "rainy-day"))).toBe(true);
	});
});

describe("fitsProposal", () => {
	const proposal = {
		month: "2026-09" as const,
		leftovers: [{ bucketId: "groceries", name: "Groceries", amount: 20_000 }],
		windfall: 50_000,
	};
	const sweep = (bucketId: string, amount: number) => ({ bucketId, goalId: "trip", amount });

	it("takes Sweeps up to each leftover and Extra income up to what's pending", () => {
		expect(
			fitsProposal(proposal, {
				sweeps: [sweep("groceries", 20_000)],
				windfall: [
					{ goalId: "trip", amount: 30_000 },
					{ goalId: "roof", amount: 20_000 },
				],
			}),
		).toBe(true);
		expect(fitsProposal(proposal, { sweeps: [], windfall: [] })).toBe(true);
	});

	it("refuses more than there is, a Bucket with nothing left, or a Bucket twice", () => {
		expect(fitsProposal(proposal, { sweeps: [sweep("groceries", 20_001)], windfall: [] })).toBe(
			false,
		);
		expect(fitsProposal(proposal, { sweeps: [sweep("fun", 1)], windfall: [] })).toBe(false);
		expect(
			fitsProposal(proposal, {
				sweeps: [sweep("groceries", 10_000), sweep("groceries", 10_000)],
				windfall: [],
			}),
		).toBe(false);
		expect(
			fitsProposal(proposal, { sweeps: [], windfall: [{ goalId: "trip", amount: 50_001 }] }),
		).toBe(false);
	});
});

describe("monthEnd", () => {
	it("tells the month's Sweeps, its Extra income to Goals and what rolls over", () => {
		const end = monthEnd(closing, {
			sweeps: [
				{ bucketId: "gifts", goalId: "trip", amount: 4_000, month: "2026-09" },
				// Another month's, and one from a Bucket no longer in the Plan.
				{ bucketId: "groceries", goalId: "trip", amount: 9_000, month: "2026-08" },
				{ bucketId: "gone", goalId: "trip", amount: 1_000, month: "2026-09" },
			],
			goalFunding: [
				{ goalId: "trip", amount: 20_000, month: "2026-09", windfall: true },
				{ goalId: "trip", amount: 10_000, month: "2026-09", windfall: true },
				{ goalId: "roof", amount: 5_000, month: "2026-09" },
			],
		});
		expect(end).toEqual({
			sweeps: [{ bucketId: "gifts", name: "Gifts", goalId: "trip", amount: 4_000 }],
			windfall: [{ goalId: "trip", amount: 30_000 }],
			rolledOver: [{ bucketId: "hockey", name: "Hockey", amount: 40_000 }],
		});
		expect(quietEnd(end)).toBe(false);
	});

	it("carries an overspent carrying-over Bucket's shortfall, and is quiet when nothing happened", () => {
		const overspent = monthState({
			plan: { ...plan, buckets: plan.buckets.filter((b) => b.id === "hockey") },
			spending: [{ bucketId: "hockey", amount: 45_000, date: "2026-09-10" }],
			asOf: "2026-09-30",
		});
		expect(monthEnd(overspent, { sweeps: [], goalFunding: [] }).rolledOver).toEqual([
			{ bucketId: "hockey", name: "Hockey", amount: -5_000 },
		]);
		const quiet = monthState({
			plan: { ...plan, buckets: plan.buckets.filter((b) => !b.rolling) },
			spending: [],
			asOf: "2026-09-30",
		});
		expect(quietEnd(monthEnd(quiet, { sweeps: [], goalFunding: [] }))).toBe(true);
	});
});
