import { describe, expect, it } from "vitest";
import { type Plan, type PlanRecords, planChanges, restoreAfterJust } from "./index";

describe("restoreAfterJust: putting the next month back after a Just <Month> change", () => {
	const series: PlanRecords["allowances"] = [
		{ bucketId: "groceries", month: "2026-07", amount: 120_000 },
		{ bucketId: "groceries", month: "2026-09", amount: 130_000 },
	];

	it("gives the next month the value in force from an earlier month", () => {
		expect(restoreAfterJust(series, "2026-07")).toEqual({
			bucketId: "groceries",
			month: "2026-08",
			amount: 120_000,
		});
	});

	it("gives the next month the value the month itself had", () => {
		expect(restoreAfterJust(series, "2026-09")).toEqual({
			bucketId: "groceries",
			month: "2026-10",
			amount: 130_000,
		});
	});

	it("leaves a next month that has its own value", () => {
		expect(restoreAfterJust(series, "2026-08")).toBeNull();
	});

	it("has nothing to go back to when nothing was in force", () => {
		expect(restoreAfterJust(series, "2026-06")).toBeNull();
		expect(restoreAfterJust([], "2026-09")).toBeNull();
	});

	it("ignores records after the next month", () => {
		expect(
			restoreAfterJust(
				[...series, { bucketId: "groceries", month: "2026-12", amount: 90_000 }],
				"2026-10",
			),
		).toEqual({ bucketId: "groceries", month: "2026-11", amount: 130_000 });
	});

	it("carries every field of the record, such as a Commitment's terms", () => {
		expect(
			restoreAfterJust(
				[{ month: "2026-09", amount: 5_000, cadence: "monthly", dueDate: "2026-09-15" }],
				"2026-09",
			),
		).toEqual({ month: "2026-10", amount: 5_000, cadence: "monthly", dueDate: "2026-09-15" });
	});
});

describe("planChanges: what changed from the month before", () => {
	const plan = (overrides: Partial<Plan> = {}): Plan => ({
		month: "2026-09",
		baseline: 900_000,
		commitments: [
			{ id: "rent", name: "Rent", amount: 200_000, cadence: "monthly", dueDate: "2026-09-01" },
		],
		buckets: [
			{ id: "groceries", name: "Groceries", color: 1, allowance: 120_000, rolling: false },
			{ id: "hockey", name: "Hockey", color: 2, allowance: 40_000, rolling: false },
		],
		...overrides,
	});
	const none = { baseline: null, allowances: {}, commitments: {} };

	it("is nothing when the Plan is the same as the month before, or there is none", () => {
		expect(planChanges(plan(), plan({ month: "2026-08" }))).toEqual(none);
		expect(planChanges(plan(), null)).toEqual(none);
	});

	it("gives each changed value what it was", () => {
		const before = plan({
			month: "2026-08",
			baseline: 850_000,
			commitments: [
				{ id: "rent", name: "Rent", amount: 190_000, cadence: "monthly", dueDate: "2026-08-01" },
			],
			buckets: [
				{ id: "groceries", name: "Groceries", color: 1, allowance: 110_000, rolling: false },
				{ id: "hockey", name: "Hockey", color: 2, allowance: 40_000, rolling: false },
			],
		});
		expect(planChanges(plan(), before)).toEqual({
			baseline: 850_000,
			allowances: { groceries: 110_000 },
			commitments: { rent: 190_000 },
		});
	});

	it("skips values new this month, and a Baseline set for the first time", () => {
		const before = plan({ month: "2026-08", baseline: null, commitments: [], buckets: [] });
		expect(planChanges(plan(), before)).toEqual(none);
	});

	it("skips a Baseline taken away", () => {
		expect(planChanges(plan({ baseline: null }), plan({ month: "2026-08" }))).toEqual(none);
	});
});
