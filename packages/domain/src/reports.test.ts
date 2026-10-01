import { describe, expect, it } from "vitest";
import {
	cashFlow,
	changeOf,
	comparisonRange,
	type DayKey,
	freeToSpendOver,
	headlines,
	incomeByMonth,
	levelOf,
	type MonthKey,
	mergeCells,
	monthsIn,
	overThreshold,
	owedAtEndOf,
	type PlanRecords,
	paidDownHistory,
	periodKey,
	periodKeys,
	periodRange,
	planHabits,
	planVsActual,
	projectedCompletion,
	projectedPayoff,
	recurringSplit,
	regroupMonthly,
	type SpendCell,
	seriesOf,
	setAsideHistory,
	spendFor,
	toCsv,
	topWithOther,
	totalsBy,
	withinHistory,
	yearlyCost,
} from "./index";

const asOf = "2026-09-28" as DayKey;

const records: PlanRecords = {
	baselines: [{ month: "2026-01", amount: 800_000 }],
	buckets: [
		{
			id: "groceries",
			name: "Groceries",
			color: 1,
			position: 0,
			fromMonth: "2026-01",
			archivedFromMonth: null,
		},
		{
			id: "fun",
			name: "Fun",
			color: 2,
			position: 1,
			fromMonth: "2026-01",
			archivedFromMonth: null,
		},
	],
	allowances: [
		{ bucketId: "groceries", month: "2026-01", amount: 100_000 },
		{ bucketId: "fun", month: "2026-01", amount: 20_000 },
	],
	commitments: [{ id: "rent", name: "Rent", fromMonth: "2026-01", endedFromMonth: null }],
	commitmentTerms: [
		{
			commitmentId: "rent",
			month: "2026-01",
			amount: 300_000,
			cadence: "monthly",
			dueDate: "2026-01-01",
		},
	],
	rolling: [],
} as PlanRecords;

describe("periodRange", () => {
	it("counts this month as one of the last N, up to today", () => {
		expect(periodRange("this-month", asOf)).toEqual({ from: "2026-09-01", until: "2026-09-29" });
		expect(periodRange("3m", asOf)).toEqual({ from: "2026-07-01", until: "2026-09-29" });
		expect(periodRange("12m", asOf)).toEqual({ from: "2025-10-01", until: "2026-09-29" });
	});

	it("covers whole past months and years", () => {
		expect(periodRange("last-month", asOf)).toEqual({ from: "2026-08-01", until: "2026-09-01" });
		expect(periodRange("ytd", asOf)).toEqual({ from: "2026-01-01", until: "2026-09-29" });
		expect(periodRange("last-year", asOf)).toEqual({ from: "2025-01-01", until: "2026-01-01" });
	});

	it("includes both ends of a custom range, in either order", () => {
		const custom = { from: "2026-03-10" as DayKey, to: "2026-02-01" as DayKey };
		expect(periodRange("custom", asOf, custom)).toEqual({
			from: "2026-02-01",
			until: "2026-03-11",
		});
	});
});

describe("comparisonRange", () => {
	it("compares month-aligned ranges like for like", () => {
		const range = periodRange("this-month", asOf);
		expect(comparisonRange(range, "previous")).toEqual({ from: "2026-08-01", until: "2026-08-29" });
		expect(comparisonRange(periodRange("3m", asOf), "previous")).toEqual({
			from: "2026-04-01",
			until: "2026-06-29",
		});
	});

	it("moves other ranges back by their length, or a year, or not at all", () => {
		const range = { from: "2026-03-10" as DayKey, until: "2026-03-20" as DayKey };
		expect(comparisonRange(range, "previous")).toEqual({ from: "2026-02-28", until: "2026-03-10" });
		expect(comparisonRange(range, "last-year")).toEqual({
			from: "2025-03-10",
			until: "2025-03-20",
		});
		expect(comparisonRange(range, "none")).toBeNull();
	});

	it("keeps month ends in shorter months", () => {
		const range = { from: "2026-03-01" as DayKey, until: "2026-03-31" as DayKey };
		expect(comparisonRange(range, "previous")).toEqual({ from: "2026-02-01", until: "2026-02-28" });
	});
});

describe("periods", () => {
	it("keys a day by its week's Monday, its month, or its quarter", () => {
		expect(periodKey("2026-09-28" as DayKey, "week")).toBe("2026-09-28");
		expect(periodKey("2026-10-04" as DayKey, "week")).toBe("2026-09-28");
		expect(periodKey("2026-09-01" as DayKey, "week")).toBe("2026-08-31");
		expect(periodKey("2026-09-01" as DayKey, "month")).toBe("2026-09");
		expect(periodKey("2026-08-31" as DayKey, "quarter")).toBe("2026-Q3");
	});

	it("lists every period in a range", () => {
		const range = { from: "2026-07-15" as DayKey, until: "2026-10-02" as DayKey };
		expect(periodKeys(range, "month")).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
		expect(periodKeys(range, "quarter")).toEqual(["2026-Q3", "2026-Q4"]);
		expect(
			periodKeys({ from: "2026-09-01" as DayKey, until: "2026-09-15" as DayKey }, "week"),
		).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
		expect(monthsIn(range)).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
	});
});

const cell = (
	period: string,
	target: SpendCell["target"],
	amount: number,
	count = 1,
): SpendCell => ({
	period,
	target,
	amount,
	count,
});

describe("cells", () => {
	it("merges whole Transactions, Splits and private totals per period and Target", () => {
		const merged = mergeCells(
			[cell("2026-09", "bucket:g", 1_000), cell("2026-09", "bucket:f", 500)],
			[cell("2026-09", "bucket:g", 250, 2)],
			[{ ...cell("2026-09", "bucket:p", 900), private: true }],
		);
		expect(merged).toEqual([
			cell("2026-09", "bucket:g", 1_250, 3),
			cell("2026-09", "bucket:f", 500),
			{ ...cell("2026-09", "bucket:p", 900), private: true },
		]);
	});

	it("counts a monthly private total in the week or quarter of its first day", () => {
		const cells = [{ ...cell("2026-09", "bucket:p", 900), private: true }];
		expect(regroupMonthly(cells, "week")[0]?.period).toBe("2026-08-31");
		expect(regroupMonthly(cells, "quarter")[0]?.period).toBe("2026-Q3");
	});

	it("totals, fills series gaps, and folds the tail into other", () => {
		const cells = [
			cell("2026-07", "bucket:g", 100),
			cell("2026-09", "bucket:g", 300),
			cell("2026-09", "bucket:f", 50),
		];
		expect(totalsBy(cells, (c: SpendCell) => c.target)).toEqual([
			{ key: "bucket:g", amount: 400 },
			{ key: "bucket:f", amount: 50 },
		]);
		expect(seriesOf(cells, ["2026-07", "2026-08", "2026-09"])).toEqual([
			{ period: "2026-07", amount: 100 },
			{ period: "2026-08", amount: 0 },
			{ period: "2026-09", amount: 350 },
		]);
		const entries = [1, 2, 3, 4].map((n) => ({ key: `k${n}`, amount: n * 10 }));
		expect(topWithOther(entries, 2)).toEqual([
			{ key: "k4", amount: 40 },
			{ key: "k3", amount: 30 },
			{ key: "other", amount: 30, others: 2 },
		]);
		// Never an "other" of a single entry: it's shown as itself.
		expect(topWithOther(entries, 3)).toHaveLength(4);
	});

	it("splits recurring (Commitments) from one-offs", () => {
		const cells = [cell("2026-09", "commitment:rent", 300_000), cell("2026-09", "bucket:g", 5_000)];
		expect(recurringSplit(cells, ["2026-08", "2026-09"])).toEqual([
			{ period: "2026-08", recurring: 0, oneOff: 0 },
			{ period: "2026-09", recurring: 300_000, oneOff: 5_000 },
		]);
	});
});

describe("headlines", () => {
	it("derives saved and the savings rate", () => {
		expect(headlines({ spent: 600_000, earned: 800_000, freeToSpend: 1_000 })).toEqual({
			spent: 600_000,
			earned: 800_000,
			saved: 200_000,
			savingsRate: 0.25,
			freeToSpend: 1_000,
		});
		expect(headlines({ spent: 100, earned: 0, freeToSpend: 0 }).savingsRate).toBeNull();
	});

	it("compares against before, with no ratio from zero", () => {
		expect(changeOf(150, 100)).toEqual({ delta: 50, ratio: 0.5 });
		expect(changeOf(150, 0)).toEqual({ delta: 150, ratio: null });
		expect(changeOf(150, null)).toBeNull();
	});

	it("sums Free to Spend over the months' Plans", () => {
		expect(freeToSpendOver(records, ["2026-08", "2026-09"])).toBe(
			2 * (800_000 - 300_000 - 120_000),
		);
	});
});

describe("big expenses", () => {
	it("annualizes a Commitment by its cadence", () => {
		expect(yearlyCost({ amount: 10_000, cadence: "monthly" })).toBe(120_000);
		expect(yearlyCost({ amount: 10_000, cadence: "biweekly" })).toBe(260_000);
		expect(yearlyCost({ amount: 10_000, cadence: "annual" })).toBe(10_000);
	});

	it("counts Transactions at or over a threshold from the bands", () => {
		const bands = [
			{ floor: 0, count: 40, amount: 50_000 },
			{ floor: 100_00, count: 5, amount: 80_000 },
			{ floor: 1_000_00, count: 1, amount: 240_000 },
		];
		expect(overThreshold(bands, 100_00)).toEqual({ count: 6, amount: 320_000 });
		expect(overThreshold(bands, 5_000_00)).toEqual({ count: 0, amount: 0 });
	});
});

describe("plan vs actual", () => {
	it("puts each Bucket's spending against its allowance", () => {
		const rows = planVsActual(
			records,
			[{ bucketId: "fun", month: "2026-09", amount: 30_000 }],
			["2026-09"],
		);
		expect(rows).toEqual([
			{ bucketId: "groceries", month: "2026-09", planned: 100_000, spent: 0, ratio: 0 },
			{ bucketId: "fun", month: "2026-09", planned: 20_000, spent: 30_000, ratio: 1.5 },
		]);
	});

	it("finds Buckets chronically over or under", () => {
		const months = ["2026-07", "2026-08", "2026-09"] as const;
		const rows = planVsActual(
			records,
			months.flatMap((month) => [
				{ bucketId: "fun", month, amount: 30_000 },
				{ bucketId: "groceries", month, amount: 60_000 },
			]),
			[...months],
		);
		const habits = planHabits(rows);
		expect(habits.map((h) => [h.bucketId, h.habit, h.over, h.under])).toEqual([
			["fun", "over", 3, 0],
			["groceries", "under", 0, 3],
		]);
	});
});

describe("levelOf", () => {
	it("shades on a square-root scale, zero for nothing", () => {
		expect(levelOf(0, 100)).toBe(0);
		expect(levelOf(100, 100)).toBe(4);
		expect(levelOf(1, 100)).toBe(1);
		expect(levelOf(25, 100)).toBe(2);
	});
});

describe("spendFor", () => {
	it("shares spending For several Members evenly and keeps the Household's apart", () => {
		expect(
			spendFor([
				{ period: "2026-09", for: ["a", "b"], amount: 101, count: 1 },
				{ period: "2026-09", for: ["a"], amount: 10, count: 1 },
				{ period: "2026-09", for: [], amount: 500, count: 3 },
			]),
		).toEqual([
			{ period: "2026-09", who: "a", amount: 61 },
			{ period: "2026-09", who: "b", amount: 50 },
			{ period: "2026-09", who: "household", amount: 500 },
		]);
	});
});

describe("cashFlow", () => {
	it("flows income through the Household to spending, Goals and savings", () => {
		const flow = cashFlow({
			income: [{ key: "salary", name: "Salary", amount: 1_000 }],
			spending: [{ key: "g", name: "Groceries", amount: 600 }],
			goals: 100,
		});
		expect(flow.nodes.map((n) => n.name)).toEqual([
			"Salary",
			"Household",
			"Groceries",
			"Goals",
			"Saved",
		]);
		expect(flow.links).toEqual([
			{ source: 0, target: 1, value: 1_000 },
			{ source: 1, target: 2, value: 600 },
			{ source: 1, target: 3, value: 100 },
			{ source: 1, target: 4, value: 300 },
		]);
	});

	it("draws spending beyond income from savings, and folds small Buckets together", () => {
		const flow = cashFlow({
			income: [{ key: "salary", name: "Salary", amount: 100 }],
			spending: [1, 2, 3].map((n) => ({ key: `b${n}`, name: `B${n}`, amount: n * 100 })),
			goals: 0,
			buckets: 1,
		});
		expect(flow.nodes.map((n) => n.name)).toEqual([
			"Salary",
			"From savings",
			"Household",
			"B3",
			"Everything else",
		]);
		expect(flow.links[1]).toEqual({ source: 1, target: 2, value: 500 });
	});
});

describe("goals", () => {
	const changes = [
		{ goalId: "trip", kind: "claim" as const, amount: 100_000, month: "2026-04" as const },
		{ goalId: "trip", kind: "funding" as const, amount: 20_000, month: "2026-08" as const },
		{ goalId: "trip", kind: "funding" as const, amount: 40_000, month: "2026-09" as const },
	];
	const trip = { id: "trip", target: 400_000, fromMonth: "2026-04" as const };

	it("tracks what's set aside month by month", () => {
		expect(setAsideHistory("trip", changes, ["2026-03", "2026-04", "2026-09"])).toEqual([
			{ month: "2026-03", saved: 0 },
			{ month: "2026-04", saved: 100_000 },
			{ month: "2026-09", saved: 160_000 },
		]);
	});

	it("projects completion at the recent pace", () => {
		// 160,000 over Apr–Sep (6 months) is ~26,667 a month; 240,000 to go takes 9 more months.
		expect(projectedCompletion(trip, changes, "2026-09")).toBe("2027-06");
		expect(projectedCompletion({ ...trip, target: 100_000 }, changes, "2026-09")).toBe("2026-09");
		expect(projectedCompletion(trip, [], "2026-09")).toBeNull();
	});
});

describe("incomeByMonth", () => {
	it("marks income beyond take-home pay as the month's Extra income", () => {
		expect(
			incomeByMonth(
				[
					{ month: "2026-09", amount: 800_000 },
					{ month: "2026-09", amount: 150_000 },
				],
				records,
				["2026-08", "2026-09"],
			),
		).toEqual([
			{ month: "2026-08", total: 0, baseline: 800_000, windfall: 0 },
			{ month: "2026-09", total: 950_000, baseline: 800_000, windfall: 150_000 },
		]);
	});
});

describe("toCsv", () => {
	it("quotes, escapes, and defuses formulas", () => {
		expect(
			toCsv([
				["Note", "Amount"],
				['Costco, "bulk"', 12.5],
				["=HYPERLINK()", null],
			]),
		).toBe('Note,Amount\r\n"Costco, ""bulk""",12.5\r\n\'=HYPERLINK(),\r\n');
	});
});

describe("withinHistory: a Report kept to the Household's history", () => {
	// Last 6 months as of Sep 30: Apr to Sep, compared to Oct to Mar. History starts Jan 29.
	const range = { from: "2026-04-01" as DayKey, until: "2026-10-01" as DayKey };
	const previous = comparisonRange(range, "previous");

	it("drops a comparison that reaches before the first spending or income", () => {
		// Oct–Dec had nothing: "226% more" would only say history hadn't started.
		expect(withinHistory(range, previous, "2026-01-29")).toEqual({ range, compared: null });
		expect(
			withinHistory(range, comparisonRange(range, "last-year"), "2026-01-29").compared,
		).toBeNull();
	});

	it("keeps one that's all within it", () => {
		expect(withinHistory(range, previous, "2025-06-02")).toEqual({ range, compared: previous });
	});

	it("starts the period at the month history starts, not on empty months", () => {
		const year = { from: "2025-10-01" as DayKey, until: "2026-10-01" as DayKey };
		expect(withinHistory(year, null, "2026-01-29").range).toEqual({
			from: "2026-01-01",
			until: "2026-10-01",
		});
	});

	it("has nothing to compare with before any history", () => {
		expect(withinHistory(range, previous, null)).toEqual({ range, compared: null });
	});
});

describe("projectedPayoff (ADR-0019)", () => {
	const card = { target: 600_000, fromMonth: "2026-07" as MonthKey };
	it("pays off what's owed at the pace it has come down since the Goal was added", () => {
		// $1,500 down over July–September is $500 a month: $4,500 takes 9 more.
		expect(projectedPayoff(card, 450_000, "2026-09")).toBe("2027-06");
	});
	it("is this month once paid off, and null when it isn't coming down", () => {
		expect(projectedPayoff(card, 0, "2026-09")).toBe("2026-09");
		expect(projectedPayoff(card, 600_000, "2026-09")).toBeNull();
		expect(projectedPayoff(card, 700_000, "2026-09")).toBeNull();
		expect(projectedPayoff(card, null, "2026-09")).toBeNull();
	});
	it("is what projectedCompletion gives a payoff Goal, whatever its funding", () => {
		const funded = [
			{ goalId: "c", kind: "funding" as const, amount: 900_000, month: "2026-09" as MonthKey },
		];
		expect(
			projectedCompletion({ id: "c", ...card, kind: "payoff", owed: 450_000 }, funded, "2026-09"),
		).toBe("2027-06");
	});
});

describe("paidDownHistory (ADR-0019)", () => {
	const owed = [
		{ month: "2026-05" as MonthKey, amount: 300_000 },
		{ month: "2026-07" as MonthKey, amount: 250_000 },
		{ month: "2026-07" as MonthKey, amount: 240_000 },
		{ month: "2026-09" as MonthKey, amount: 320_000 },
	];
	it("is what was paid down at each month's end, nothing before the Goal", () => {
		expect(
			paidDownHistory({ target: 300_000, fromMonth: "2026-06" }, owed, [
				"2026-05",
				"2026-06",
				"2026-07",
				"2026-08",
				"2026-09",
			]),
		).toEqual([
			{ month: "2026-05", saved: 0 },
			{ month: "2026-06", saved: 0 },
			{ month: "2026-07", saved: 60_000 },
			{ month: "2026-08", saved: 60_000 },
			{ month: "2026-09", saved: 0 },
		]);
		expect(owedAtEndOf(owed, "2026-04")).toBeNull();
	});
});
