import { describe, expect, it } from "vitest";
import {
	coverSources,
	type DayKey,
	leftToMove,
	type Move,
	monthState,
	type Plan,
	type Spend,
} from "./index";

const plan: Plan = {
	month: "2026-09",
	baseline: 500_000,
	commitments: [],
	buckets: [
		{ id: "groceries", name: "Groceries", color: 1, allowance: 120_000 },
		{ id: "hockey", name: "Hockey", color: 2, allowance: 40_000 },
		{ id: "fun", name: "Fun", color: 3, allowance: 25_000 },
	],
};

const spend = (bucketId: string, amount: number, date: DayKey = "2026-09-10"): Spend => ({
	bucketId,
	amount,
	date,
});

const cover = (fromBucketId: string | null, toBucketId: string, amount: number): Move => ({
	fromBucketId,
	toBucketId,
	amount,
	month: "2026-09",
});

const stateOf = (spending: Spend[], moves: Move[] = [], baseline = plan.baseline) =>
	monthState({ plan: { ...plan, baseline }, spending, moves, asOf: "2026-09-20" });

describe("monthState: Moves", () => {
	it("a Cover from another Bucket brings the overspent Bucket back to zero", () => {
		const state = stateOf(
			[spend("hockey", 45_000), spend("groceries", 20_000)],
			[cover("groceries", "hockey", 5_000)],
		);
		expect(
			state.buckets.map(({ id, moved, available, left, status }) => ({
				id,
				moved,
				available,
				left,
				status,
			})),
		).toEqual([
			{ id: "groceries", moved: -5_000, available: 115_000, left: 95_000, status: "on-pace" },
			{ id: "hockey", moved: 5_000, available: 45_000, left: 0, status: "ahead" },
			{ id: "fun", moved: 0, available: 25_000, left: 25_000, status: "on-pace" },
		]);
		// Money moved between Buckets never touches Free to Spend.
		expect(state.freeToSpend).toBe(500_000 - 185_000);
		expect(state.movedToBuckets).toBe(0);
	});

	it("a Cover from Free to Spend takes it out of Free to Spend", () => {
		const state = stateOf([spend("hockey", 45_000)], [cover(null, "hockey", 5_000)]);
		expect(state.buckets[1]).toMatchObject({ available: 45_000, left: 0 });
		expect(state.movedToBuckets).toBe(5_000);
		expect(state.freeToSpend).toBe(500_000 - 185_000 - 5_000);
		expect(state.leftInBuckets).toBe(120_000 + 25_000);
	});

	it("ignores Moves in other months and involving Buckets not in the Plan", () => {
		const state = stateOf(
			[spend("hockey", 45_000)],
			[
				{ ...cover("groceries", "hockey", 1_000), month: "2026-08" },
				cover("archived", "hockey", 2_000),
				cover("groceries", "archived", 3_000),
			],
		);
		expect(state.buckets.map((b) => b.moved)).toEqual([0, 0, 0]);
		expect(state.freeToSpend).toBe(500_000 - 185_000);
	});

	it("spreads Pace over what the Bucket has to spend", () => {
		const state = monthState({
			plan,
			spending: [],
			moves: [cover(null, "fun", 5_000)],
			asOf: "2026-09-15",
		});
		expect(state.buckets[2]?.pace.spent).toBe(15_000);
	});
});

describe("coverSources", () => {
	it("offers Free to Spend and Buckets with money left, those that can cover it all first", () => {
		// Hockey is $50 over. Fun has $20 left, Groceries $1,000, Free to Spend $3,150.
		const state = stateOf([
			spend("hockey", 45_000),
			spend("groceries", 20_000),
			spend("fun", 23_000),
		]);
		expect(
			coverSources(state, "hockey").map(({ bucket, left, coversAll }) => ({
				from: bucket?.id ?? "free to spend",
				left,
				coversAll,
			})),
		).toEqual([
			{ from: "free to spend", left: 315_000, coversAll: true },
			{ from: "groceries", left: 100_000, coversAll: true },
			{ from: "fun", left: 2_000, coversAll: false },
		]);
	});

	it("leaves out Free to Spend when nothing is free, and Buckets with nothing left", () => {
		const state = stateOf([spend("hockey", 45_000), spend("fun", 25_000)], [], 185_000);
		expect(coverSources(state, "hockey").map((s) => s.bucket?.id)).toEqual(["groceries"]);
	});

	it("puts a Bucket that can cover it all ahead of Free to Spend that can't", () => {
		const state = stateOf([spend("hockey", 45_000)], [], 188_000);
		expect(coverSources(state, "hockey").map((s) => s.bucket?.id ?? null)).toEqual([
			"groceries",
			"fun",
			null,
		]);
	});

	it("offers nothing for a Bucket that isn't over", () => {
		expect(coverSources(stateOf([spend("hockey", 40_000)]), "hockey")).toEqual([]);
	});
});

describe("leftToMove", () => {
	const state = stateOf([spend("groceries", 20_000)], [cover(null, "hockey", 1_000)]);

	it("is a Bucket's left, or Free to Spend", () => {
		expect(leftToMove(state, "groceries")).toBe(100_000);
		expect(leftToMove(state, null)).toBe(500_000 - 185_000 - 1_000);
	});

	it("is null for a Bucket not in the Plan", () => {
		expect(leftToMove(state, "archived")).toBeNull();
	});
});
