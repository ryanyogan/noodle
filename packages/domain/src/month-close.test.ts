import { describe, expect, it } from "vitest";
import {
	defaultDecision,
	fitsProposal,
	monthCloseProposal,
	monthState,
	nothingToClose,
	type Plan,
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
	it("offers Fresh-start Household Buckets' leftovers and the pending Windfall", () => {
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

	it("Sweeps every leftover to the emergency Goal and leaves the Windfall for the Parents", () => {
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

	it("takes Sweeps up to each leftover and Windfall up to what's pending", () => {
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
