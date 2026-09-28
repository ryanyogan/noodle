import { describe, expect, it } from "vitest";
import { type BucketRecord, freeToSpend, type PlanRecords, planForMonth } from "./index";

const bucket = (id: string, overrides: Partial<BucketRecord> = {}): BucketRecord => ({
	id,
	name: id,
	color: 1,
	position: 1,
	fromMonth: "2026-09",
	archivedFromMonth: null,
	...overrides,
});

describe("planForMonth: the Plan in force for a month", () => {
	const records: PlanRecords = {
		baselines: [
			{ month: "2026-09", amount: 900_000 },
			{ month: "2026-11", amount: 950_000 },
		],
		buckets: [
			bucket("groceries", { position: 2 }),
			bucket("hockey", { position: 1 }),
			bucket("fun", { position: 3, fromMonth: "2026-10" }),
			bucket("life", { position: 4, archivedFromMonth: "2026-10" }),
		],
		allowances: [
			{ bucketId: "groceries", month: "2026-09", amount: 120_000 },
			{ bucketId: "groceries", month: "2026-12", amount: 130_000 },
			{ bucketId: "hockey", month: "2026-09", amount: 40_000 },
			{ bucketId: "fun", month: "2026-10", amount: 20_000 },
			{ bucketId: "life", month: "2026-09", amount: 30_000 },
		],
	};

	it("orders Buckets by position", () => {
		const plan = planForMonth(records, "2026-09");
		expect(plan.buckets.map((b) => b.id)).toEqual(["hockey", "groceries", "life"]);
	});

	it("carries a Baseline or allowance forward until it is set again", () => {
		expect(planForMonth(records, "2026-10").baseline).toBe(900_000);
		expect(planForMonth(records, "2026-11").baseline).toBe(950_000);
		expect(planForMonth(records, "2027-03").baseline).toBe(950_000);
		const groceries = (month: `${number}-${number}`) =>
			planForMonth(records, month).buckets.find((b) => b.id === "groceries")?.allowance;
		expect(groceries("2026-11")).toBe(120_000);
		expect(groceries("2026-12")).toBe(130_000);
		expect(groceries("2027-01")).toBe(130_000);
	});

	it("includes a Bucket from the month it was added until the month it was archived", () => {
		const ids = (month: `${number}-${number}`) =>
			planForMonth(records, month).buckets.map((b) => b.id);
		expect(ids("2026-09")).not.toContain("fun");
		expect(ids("2026-10")).toContain("fun");
		expect(ids("2026-09")).toContain("life");
		expect(ids("2026-10")).not.toContain("life");
	});

	it("has no Baseline before one is set", () => {
		expect(planForMonth(records, "2026-08")).toEqual({
			month: "2026-08",
			baseline: null,
			buckets: [],
		});
	});

	it("ignores records from later months", () => {
		expect(planForMonth(records, "2026-09").buckets.find((b) => b.id === "groceries")).toEqual({
			id: "groceries",
			name: "groceries",
			color: 1,
			allowance: 120_000,
		});
	});
});

describe("freeToSpend: the Baseline not yet assigned", () => {
	const plan = (baseline: number | null, ...allowances: number[]) => ({
		baseline,
		buckets: allowances.map((allowance, i) => ({ id: `b${i}`, name: "", color: 1, allowance })),
	});

	it.each([
		["what the Buckets don't take", plan(900_000, 120_000, 40_050), 739_950],
		["all of it with no Buckets", plan(900_000), 900_000],
		["zero when fully assigned", plan(100_000, 60_000, 40_000), 0],
		["negative, never clamped, when over-assigned", plan(100_000, 80_000, 32_500), -12_500],
		["negative before a Baseline is set", plan(null, 5_000), -5_000],
	])("is %s", (_, input, expected) => {
		expect(freeToSpend(input)).toBe(expected);
	});
});
