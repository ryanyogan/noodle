import { describe, expect, it } from "vitest";
import {
	type BucketRecord,
	canAssign,
	freeToSpend,
	type PlanRecords,
	planForMonth,
	totalAllowances,
} from "./index";

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
		commitments: [],
		commitmentTerms: [],
		rolling: [
			{ bucketId: "hockey", month: "2026-09", rolling: true },
			{ bucketId: "hockey", month: "2026-11", rolling: false },
			{ bucketId: "groceries", month: "2026-12", rolling: true },
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

	it("makes a Bucket Fresh-start until it is set Rolling, and carries that forward", () => {
		const rolling = (month: `${number}-${number}`) =>
			Object.fromEntries(planForMonth(records, month).buckets.map((b) => [b.id, b.rolling]));
		expect(rolling("2026-09")).toMatchObject({ hockey: true, groceries: false });
		expect(rolling("2026-10")).toMatchObject({ hockey: true, groceries: false });
		expect(rolling("2026-11")).toMatchObject({ hockey: false, groceries: false });
		expect(rolling("2026-12")).toMatchObject({ hockey: false, groceries: true });
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
			commitments: [],
			buckets: [],
		});
	});

	it("ignores records from later months", () => {
		expect(planForMonth(records, "2026-09").buckets.find((b) => b.id === "groceries")).toEqual({
			id: "groceries",
			name: "groceries",
			color: 1,
			allowance: 120_000,
			rolling: false,
		});
	});
});

describe("planForMonth: Commitments", () => {
	const records: PlanRecords = {
		baselines: [{ month: "2026-09", amount: 900_000 }],
		buckets: [],
		allowances: [],
		commitments: [
			{ id: "02-daycare", name: "Daycare", fromMonth: "2026-09", endedFromMonth: "2027-01" },
			{ id: "01-mortgage", name: "Mortgage", fromMonth: "2026-09", endedFromMonth: null },
			{ id: "03-netflix", name: "Netflix", fromMonth: "2026-10", endedFromMonth: null },
		],
		commitmentTerms: [
			{
				commitmentId: "01-mortgage",
				month: "2026-09",
				amount: 250_000,
				cadence: "monthly",
				dueDate: "2026-09-01",
			},
			{
				commitmentId: "01-mortgage",
				month: "2026-11",
				amount: 255_000,
				cadence: "monthly",
				dueDate: "2026-11-15",
			},
			{
				commitmentId: "02-daycare",
				month: "2026-09",
				amount: 60_000,
				cadence: "biweekly",
				dueDate: "2026-09-04",
			},
			{
				commitmentId: "03-netflix",
				month: "2026-10",
				amount: 1_799,
				cadence: "monthly",
				dueDate: "2026-10-12",
			},
		],
		rolling: [],
	};
	const ids = (month: `${number}-${number}`) =>
		planForMonth(records, month).commitments.map((c) => c.id);

	it("lists Commitments in the order they were added", () => {
		expect(ids("2026-10")).toEqual(["01-mortgage", "02-daycare", "03-netflix"]);
	});

	it("includes a Commitment from the month it was added until the month it ended", () => {
		expect(ids("2026-08")).toEqual([]);
		expect(ids("2026-09")).toEqual(["01-mortgage", "02-daycare"]);
		expect(ids("2026-12")).toContain("02-daycare");
		expect(ids("2027-01")).toEqual(["01-mortgage", "03-netflix"]);
	});

	it("carries a Commitment's terms forward until they are set again", () => {
		const mortgage = (month: `${number}-${number}`) =>
			planForMonth(records, month).commitments.find((c) => c.id === "01-mortgage");
		expect(mortgage("2026-10")).toEqual({
			id: "01-mortgage",
			name: "Mortgage",
			amount: 250_000,
			cadence: "monthly",
			dueDate: "2026-09-01",
		});
		expect(mortgage("2026-11")).toMatchObject({ amount: 255_000, dueDate: "2026-11-15" });
		expect(mortgage("2027-06")).toMatchObject({ amount: 255_000 });
	});
});

describe("freeToSpend: the Baseline not yet assigned", () => {
	const plan = (baseline: number | null, ...allowances: number[]) => ({
		month: "2026-09" as const,
		baseline,
		commitments: [],
		buckets: allowances.map((allowance, i) => ({
			id: `b${i}`,
			name: "",
			color: 1,
			allowance,
			rolling: false,
		})),
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

describe("Personal Allowances", () => {
	const records: PlanRecords = {
		baselines: [{ month: "2026-09", amount: 900_000 }],
		buckets: [
			bucket("groceries", { owner: null }),
			bucket("alex", { position: 2, owner: "parent-alex" }),
			bucket("sam", { position: 3, owner: "parent-sam" }),
		],
		allowances: [
			{ bucketId: "groceries", month: "2026-09", amount: 120_000 },
			{ bucketId: "alex", month: "2026-09", amount: 15_000 },
			{ bucketId: "sam", month: "2026-09", amount: 20_000 },
		],
		commitments: [],
		commitmentTerms: [],
		rolling: [],
	};
	const plan = planForMonth(records, "2026-09");

	it("belong to their Parent and count in the Plan like any Bucket", () => {
		expect(plan.buckets.map((b) => [b.id, b.owner])).toEqual([
			["groceries", undefined],
			["alex", "parent-alex"],
			["sam", "parent-sam"],
		]);
		expect(totalAllowances(plan)).toBe(155_000);
		expect(freeToSpend(plan)).toBe(745_000);
	});

	it("take spending only from their own Parent", () => {
		const [groceries, alex, sam] = plan.buckets.map(
			(b) => (parentId: string) => canAssign(b, parentId),
		);
		expect(groceries?.("parent-alex")).toBe(true);
		expect(groceries?.("parent-sam")).toBe(true);
		expect(alex?.("parent-alex")).toBe(true);
		expect(alex?.("parent-sam")).toBe(false);
		expect(sam?.("parent-alex")).toBe(false);
	});
});
