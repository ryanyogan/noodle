import { describe, expect, it } from "vitest";
import {
	type BucketRecord,
	bucketMonths,
	type MonthKey,
	type MonthlySpend,
	type Move,
	monthState,
	type PlanRecords,
	planForMonth,
	rolledOver,
	rolloverSince,
} from "./index";

const bucket = (id: string, overrides: Partial<BucketRecord> = {}): BucketRecord => ({
	id,
	name: id,
	color: 1,
	position: 1,
	fromMonth: "2026-06",
	archivedFromMonth: null,
	...overrides,
});

const records = (
	carriesOver: PlanRecords["rolling"],
	buckets = [bucket("hockey")],
): PlanRecords => ({
	baselines: [{ month: "2026-06", amount: 500_000 }],
	buckets,
	allowances: buckets.map((b) => ({ bucketId: b.id, month: b.fromMonth, amount: 40_000 })),
	commitments: [],
	commitmentTerms: [],
	rolling: carriesOver,
});

const spent = (month: MonthKey, amount: number, bucketId = "hockey"): MonthlySpend => ({
	bucketId,
	month,
	amount,
});

const cover = (month: MonthKey, amount: number, toBucketId = "hockey"): Move => ({
	fromBucketId: null,
	toBucketId,
	amount,
	month,
});

describe("rolledOver: what each Bucket carries into a month", () => {
	it("carries nothing for a Fresh-start Bucket", () => {
		const plan = records([]);
		expect(
			rolledOver({ records: plan, spent: [spent("2026-06", 10_000)], moves: [], month: "2026-07" }),
		).toEqual({});
	});

	it("carries a Rolling Bucket's leftover forward, adding up across months", () => {
		const plan = records([{ bucketId: "hockey", month: "2026-06", rolling: true }]);
		const history = [spent("2026-06", 30_000), spent("2026-07", 35_000)];
		const into = (month: MonthKey) =>
			rolledOver({ records: plan, spent: history, moves: [], month });
		expect(into("2026-06")).toEqual({});
		expect(into("2026-07")).toEqual({ hockey: 10_000 });
		// 40,000 + 10,000 carried − 35,000 spent.
		expect(into("2026-08")).toEqual({ hockey: 15_000 });
		// Nothing spent in August: 40,000 + 15,000.
		expect(into("2026-09")).toEqual({ hockey: 55_000 });
	});

	it("carries overspending forward, and a Cover that brought the month back to zero carries nothing", () => {
		const plan = records([{ bucketId: "hockey", month: "2026-06", rolling: true }]);
		const history = [spent("2026-06", 45_000), spent("2026-07", 50_000)];
		// June overspent by 5,000; July starts with 35,000 and overspends by 15,000, then is Covered.
		expect(rolledOver({ records: plan, spent: history, moves: [], month: "2026-07" })).toEqual({
			hockey: -5_000,
		});
		expect(rolledOver({ records: plan, spent: history, moves: [], month: "2026-08" })).toEqual({
			hockey: -15_000,
		});
		const covered = [cover("2026-07", 15_000)];
		expect(rolledOver({ records: plan, spent: history, moves: covered, month: "2026-08" })).toEqual(
			{},
		);
	});

	it("carries a month's leftover only if the Bucket was Rolling in that month", () => {
		const plan = records([
			{ bucketId: "hockey", month: "2026-06", rolling: true },
			{ bucketId: "hockey", month: "2026-07", rolling: false },
			{ bucketId: "hockey", month: "2026-08", rolling: true },
		]);
		const history = [spent("2026-06", 30_000), spent("2026-07", 0), spent("2026-08", 20_000)];
		const into = (month: MonthKey) =>
			rolledOver({ records: plan, spent: history, moves: [], month });
		// June was Rolling: July starts with its 10,000.
		expect(into("2026-07")).toEqual({ hockey: 10_000 });
		// July was Fresh-start: its 50,000 left stays in July.
		expect(into("2026-08")).toEqual({});
		// August was Rolling again.
		expect(into("2026-09")).toEqual({ hockey: 20_000 });
	});

	it("carries nothing out of a month the Bucket wasn’t in the Plan", () => {
		const plan = records(
			[{ bucketId: "hockey", month: "2026-06", rolling: true }],
			[bucket("hockey", { archivedFromMonth: "2026-07" })],
		);
		const history = [spent("2026-06", 30_000)];
		expect(rolledOver({ records: plan, spent: history, moves: [], month: "2026-07" })).toEqual({
			hockey: 10_000,
		});
		expect(rolledOver({ records: plan, spent: history, moves: [], month: "2026-08" })).toEqual({});
	});

	it("keeps Buckets apart", () => {
		const plan = records(
			[{ bucketId: "hockey", month: "2026-06", rolling: true }],
			[bucket("hockey"), bucket("groceries", { position: 2 })],
		);
		const history = [spent("2026-06", 30_000), spent("2026-06", 1_000, "groceries")];
		expect(rolledOver({ records: plan, spent: history, moves: [], month: "2026-07" })).toEqual({
			hockey: 10_000,
		});
	});
});

describe("rolloverSince: how far back history matters", () => {
	it("is the first month before this one that any Bucket was Rolling", () => {
		const plan = records([
			{ bucketId: "hockey", month: "2026-05", rolling: false },
			{ bucketId: "hockey", month: "2026-08", rolling: true },
			{ bucketId: "hockey", month: "2026-07", rolling: true },
		]);
		expect(rolloverSince(plan, "2026-09")).toBe("2026-07");
		expect(rolloverSince(plan, "2026-07")).toBeNull();
		expect(rolloverSince(records([]), "2026-09")).toBeNull();
	});
});

describe("monthState with what rolled over", () => {
	it("adds it to what the Bucket has to spend, without touching Free to Spend", () => {
		const plan = records([]);
		const state = monthState({
			plan: planForMonth(plan, "2026-07"),
			spending: [],
			rolledOver: { hockey: -5_000 },
			asOf: "2026-07-01",
		});
		expect(state.buckets[0]).toMatchObject({ rolledOver: -5_000, available: 35_000, left: 35_000 });
		expect(state.freeToSpend).toBe(460_000);
	});
});

describe("bucketMonths: a Bucket month by month", () => {
	it("gives each month's allowance, spending and balance, carrying a Rolling Bucket's", () => {
		const plan = records([{ bucketId: "hockey", month: "2026-06", rolling: true }]);
		const months = bucketMonths({
			records: plan,
			spent: [spent("2026-06", 30_000), spent("2026-07", 55_000), spent("2026-08", 10_000)],
			moves: [cover("2026-07", 2_000)],
			bucketId: "hockey",
			from: "2026-06",
			to: "2026-08",
		});
		expect(months).toEqual([
			{
				month: "2026-06",
				inPlan: true,
				rolling: true,
				allowance: 40_000,
				rolledOver: 0,
				moved: 0,
				spent: 30_000,
				left: 10_000,
			},
			{
				month: "2026-07",
				inPlan: true,
				rolling: true,
				allowance: 40_000,
				rolledOver: 10_000,
				moved: 2_000,
				spent: 55_000,
				left: -3_000,
			},
			{
				month: "2026-08",
				inPlan: true,
				rolling: true,
				allowance: 40_000,
				rolledOver: -3_000,
				moved: 0,
				spent: 10_000,
				left: 27_000,
			},
		]);
	});

	it("carries what rolled in before the first month shown, as rolledOver does", () => {
		const plan = records([{ bucketId: "hockey", month: "2026-06", rolling: true }]);
		const history = [spent("2026-06", 30_000), spent("2026-07", 35_000)];
		const [august] = bucketMonths({
			records: plan,
			spent: history,
			moves: [],
			bucketId: "hockey",
			from: "2026-08",
			to: "2026-08",
		});
		expect(august?.rolledOver).toBe(
			rolledOver({ records: plan, spent: history, moves: [], month: "2026-08" }).hockey,
		);
		expect(august).toMatchObject({ rolledOver: 15_000, left: 55_000 });
	});

	it("leaves a Fresh-start Bucket's leftover behind each month", () => {
		const months = bucketMonths({
			records: records([]),
			spent: [spent("2026-06", 30_000)],
			moves: [],
			bucketId: "hockey",
			from: "2026-06",
			to: "2026-07",
		});
		expect(months.map((m) => [m.rolling, m.rolledOver, m.left])).toEqual([
			[false, 0, 10_000],
			[false, 0, 40_000],
		]);
	});

	it("marks months the Bucket wasn't in the Plan, before it started or once archived", () => {
		const plan = records([], [bucket("hockey", { archivedFromMonth: "2026-07" })]);
		const months = bucketMonths({
			records: plan,
			spent: [],
			moves: [],
			bucketId: "hockey",
			from: "2026-05",
			to: "2026-07",
		});
		expect(months.map((m) => [m.month, m.inPlan, m.allowance])).toEqual([
			["2026-05", false, 0],
			["2026-06", true, 40_000],
			["2026-07", false, 0],
		]);
	});
});
