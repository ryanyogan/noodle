import { describe, expect, it } from "vitest";
import type { MonthKey, PlanRecords, ProjectionGoal, SpendCell, YearActuals } from "./index";
import { yearGrid } from "./index";

const records: PlanRecords = {
	baselines: [{ month: "2026-02", amount: 800_000 }],
	buckets: [
		{
			id: "groceries",
			name: "Groceries",
			color: 1,
			position: 1,
			fromMonth: "2026-02",
			archivedFromMonth: null,
		},
		{
			id: "mine",
			name: "Personal Allowance",
			color: 2,
			position: 2,
			fromMonth: "2026-02",
			archivedFromMonth: null,
			owner: "other-parent",
		},
	],
	allowances: [
		{ bucketId: "groceries", month: "2026-02", amount: 100_000 },
		{ bucketId: "mine", month: "2026-02", amount: 20_000 },
	],
	commitments: [
		{ id: "mortgage", name: "Mortgage", fromMonth: "2026-02", endedFromMonth: null },
		{ id: "insurance", name: "Car insurance", fromMonth: "2026-02", endedFromMonth: null },
	],
	commitmentTerms: [
		{
			commitmentId: "mortgage",
			month: "2026-02",
			amount: 300_000,
			cadence: "monthly",
			dueDate: "2026-02-01",
		},
		{
			commitmentId: "insurance",
			month: "2026-02",
			amount: 120_000,
			cadence: "annual",
			dueDate: "2026-03-15",
		},
	],
	rolling: [],
};

const cell = (period: MonthKey, target: SpendCell["target"], amount: number, priv = false) => ({
	period,
	target,
	amount,
	count: 1,
	...(priv ? { private: true } : {}),
});

const actuals: YearActuals = {
	spending: [
		cell("2026-03", "commitment:mortgage", 300_000),
		cell("2026-03", "commitment:insurance", 120_000),
		cell("2026-03", "bucket:groceries", 90_000),
		// The other Parent's Personal Allowance, as its month's total only.
		cell("2026-03", "bucket:mine", 25_000, true),
		cell("2026-03", "unassigned", 10_000),
		// Spent from a Goal's Earmark: not the month's money.
		cell("2026-03", "goal:trip", 50_000),
		cell("2026-09", "bucket:groceries", 40_000),
	],
	income: [
		{ month: "2026-03", amount: 810_000 },
		{ month: "2026-09", amount: 400_000 },
	],
	goalFunding: [{ month: "2026-03", amount: 50_000 }],
};

const grid = (year: number, goals: ProjectionGoal[] = []) =>
	yearGrid({ year, current: "2026-09", records, goals, actuals });

describe("yearGrid", () => {
	const months = grid(2026);
	const at = (month: MonthKey) => months.find((m) => m.month === month);

	it("has the year's 12 months: earlier ones past, this one current, later ones ahead", () => {
		expect(months.map((m) => m.month)).toEqual([
			"2026-01",
			"2026-02",
			"2026-03",
			"2026-04",
			"2026-05",
			"2026-06",
			"2026-07",
			"2026-08",
			"2026-09",
			"2026-10",
			"2026-11",
			"2026-12",
		]);
		expect(months.map((m) => m.when)).toEqual([
			...Array(8).fill("past"),
			"current",
			"ahead",
			"ahead",
			"ahead",
		]);
	});

	it("shows a past month's Plan with what actually happened next to it", () => {
		expect(at("2026-03")).toMatchObject({
			noBaseline: false,
			plan: {
				baseline: 800_000,
				commitments: 420_000,
				allowances: 120_000,
				goalFunding: 50_000,
				freeToSpend: 210_000,
			},
			actual: {
				baseline: 810_000,
				commitments: 420_000,
				allowances: 115_000,
				goalFunding: 50_000,
				// 810,000 − 420,000 − 115,000 − 10,000 unassigned − 50,000 Goal funding.
				freeToSpend: 215_000,
			},
		});
	});

	it("marks a month before any Baseline", () => {
		expect(at("2026-01")).toMatchObject({
			noBaseline: true,
			plan: { baseline: 0, commitments: 0, allowances: 0, freeToSpend: 0 },
		});
	});

	it("highlights lumpy months with the Commitments that cause them", () => {
		expect(months.filter((m) => m.lumps.length > 0).map((m) => m.month)).toEqual(["2026-03"]);
		expect(at("2026-03")?.lumps[0]).toMatchObject({ commitmentId: "insurance", extra: 120_000 });
	});

	it("shows this month's actual so far, and nothing actual for months ahead", () => {
		expect(at("2026-09")?.actual).toMatchObject({ baseline: 400_000, allowances: 40_000 });
		expect(at("2026-10")?.actual).toBeNull();
	});

	it("projects this month and later from planAhead, funding dated Goals", () => {
		const funded = grid(2026, [
			{
				id: "trip",
				target: 120_000,
				targetDate: "2026-12-31",
				saved: 0,
				fundedThisMonth: 0,
			},
		]);
		const oct = funded.find((m) => m.month === "2026-10");
		expect(oct?.plan).toEqual({
			baseline: 800_000,
			commitments: 300_000,
			allowances: 120_000,
			goalFunding: 30_000,
			freeToSpend: 350_000,
		});
	});

	it("projects a later year entirely ahead", () => {
		const next = grid(2027);
		expect(next.every((m) => m.when === "ahead" && m.actual === null)).toBe(true);
		expect(next.find((m) => m.month === "2027-03")?.plan.commitments).toBe(420_000);
		expect(next.find((m) => m.month === "2027-03")?.lumps).toHaveLength(1);
	});

	it("shows an earlier year entirely past", () => {
		const last = grid(2025);
		expect(last.every((m) => m.when === "past" && m.noBaseline)).toBe(true);
	});
});
