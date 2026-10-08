import { describe, expect, it } from "vitest";
import type {
	DayKey,
	HealthGoal,
	MonthKey,
	PlanRecords,
	PlanWarning,
	SetAsideChange,
} from "./index";
import { byUrgency, planHealth } from "./index";

const bucket = (id: string, owner?: string) => ({
	id,
	name: id,
	color: 1,
	position: 1,
	fromMonth: "2026-01" as MonthKey,
	archivedFromMonth: null,
	...(owner ? { owner } : {}),
});

const healthy: PlanRecords = {
	baselines: [{ month: "2026-01", amount: 500_000 }],
	buckets: [bucket("groceries"), bucket("their-allowance", "p2"), bucket("my-allowance", "p1")],
	allowances: [
		{ bucketId: "groceries", month: "2026-01", amount: 100_000 },
		{ bucketId: "their-allowance", month: "2026-01", amount: 100_000 },
		{ bucketId: "my-allowance", month: "2026-01", amount: 100_000 },
	],
	commitments: [],
	commitmentTerms: [],
	rolling: [],
};

const pastMonths: MonthKey[] = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];

const funding = (goalId: string, amount: number): SetAsideChange[] =>
	pastMonths.map((month) => ({ goalId, kind: "funding", amount, month }));

const health = (overrides: Partial<Parameters<typeof planHealth>[0]> = {}) =>
	planHealth({
		asOf: "2026-09-20",
		parentId: "p1",
		records: healthy,
		goals: [],
		changes: [],
		income: [
			{ amount: 500_000, date: "2026-08-01" },
			{ amount: 500_000, date: "2026-09-01" },
		],
		spent: [],
		...overrides,
	});

describe("planHealth", () => {
	it("finds nothing wrong with a healthy Plan", () => {
		expect(health()).toEqual([]);
	});

	it("warns of the first month ahead whose Free to Spend goes below zero", () => {
		const december = (amount: number): PlanRecords => ({
			...healthy,
			allowances: [
				...healthy.allowances,
				// Just December: a big month for Groceries.
				{ bucketId: "groceries", month: "2026-12", amount },
				{ bucketId: "groceries", month: "2027-01", amount: 100_000 },
			],
		});
		// More than the months before it leave: December is the first month short.
		const warnings = health({ records: december(4_500_000) });
		expect(warnings).toMatchObject([{ kind: "negative-ahead", month: "2026-12" }]);
		// On its own December is $1,500 short, but October and November leave more than that, and
		// Free to Spend is carried over (issue 113): nothing to warn of.
		expect(health({ records: december(450_000) })).toEqual([]);
		// Unless this month hands on a shortfall the months between do not make up.
		const short = health({ records: december(450_000), freeHandedOn: -5_000_000 });
		expect(short).toMatchObject([
			{ kind: "negative-ahead", month: "2026-10", carriedIn: -5_000_000 },
		]);
		// The warning says what the figure is made of and names the month's largest amounts.
		const [first] = short;
		if (first?.kind !== "negative-ahead") throw new Error("expected a month below zero");
		expect(first.carriedIn + first.own).toBe(first.freeToSpend);
		expect(first.largest.length).toBeGreaterThan(0);
		expect(first.largest.length).toBeLessThanOrEqual(2);
		expect(first.largest.map((a) => a.amount)).toEqual(
			[...first.largest.map((a) => a.amount)].sort((a, b) => b - a),
		);
		const [december1] = warnings;
		if (december1?.kind !== "negative-ahead") throw new Error("expected December below zero");
		expect(december1.largest[0]).toMatchObject({
			kind: "bucket",
			id: "groceries",
			amount: 4_500_000,
		});
	});

	it("warns when this month's income is behind take-home pay", () => {
		expect(
			health({
				income: [
					{ amount: 500_000, date: "2026-08-01" },
					{ amount: 200_000, date: "2026-09-01" },
				],
			}),
		).toEqual([
			{
				kind: "income-behind",
				month: "2026-09",
				short: 300_000,
				received: 200_000,
				expected: 500_000,
			},
		]);
	});

	it("warns of a Bucket over its allowance most months, but never the other Parent's Personal Allowance", () => {
		const spent = pastMonths.flatMap((month, i) => [
			// Over in five of six months.
			{ bucketId: "groceries", month, amount: i === 0 ? 100_000 : 150_000 },
			{ bucketId: "their-allowance", month, amount: 200_000 },
			{ bucketId: "my-allowance", month, amount: 100_000 },
		]);
		expect(health({ spent })).toEqual([
			{
				kind: "bucket-over",
				bucketId: "groceries",
				name: "groceries",
				over: 5,
				months: 6,
				gap: 250_000,
			},
		]);
	});

	it("warns of a dated Goal that won't be reached by its date at its recent pace", () => {
		const goals: HealthGoal[] = [
			// 60,000 saved; 50,000 over the last six months is about 8,333 a month, so the 90,000
			// to go takes until August 2027.
			{ id: "late", name: "Trip", target: 150_000, targetDate: "2026-12-31", fromMonth: "2026-01" },
			// 120,000 saved; at about 16,667 a month it reaches 200,000 by February 2027.
			{ id: "fine", name: "Car", target: 200_000, targetDate: "2027-12-31", fromMonth: "2026-01" },
			// Undated: no date to miss.
			{ id: "someday", name: "Someday", target: 900_000, targetDate: null, fromMonth: "2026-01" },
			// Added this month: no pace yet.
			{ id: "new", name: "New", target: 50_000, targetDate: "2026-10-31", fromMonth: "2026-09" },
		];
		const changes = [...funding("late", 10_000), ...funding("fine", 20_000)];
		expect(health({ goals, changes })).toEqual([
			{
				kind: "goal-late",
				goalId: "late",
				name: "Trip",
				targetDate: "2026-12-31",
				reachedIn: "2027-08",
			},
		]);
	});

	it("warns of a dated Goal that isn't growing at all", () => {
		const goals: HealthGoal[] = [
			{ id: "idle", name: "Idle", target: 100_000, targetDate: "2027-06-30", fromMonth: "2026-02" },
		];
		expect(health({ goals })).toMatchObject([{ kind: "goal-late", reachedIn: null }]);
	});
});

describe("planHealth: payoff Goals (ADR-0019)", () => {
	const card = (owed: number | null): HealthGoal => ({
		id: "card",
		name: "Pay off the Visa",
		target: 600_000,
		targetDate: "2026-12-31",
		fromMonth: "2026-06",
		kind: "payoff",
		owed,
	});

	it("is fine when what's owed is coming down fast enough", () => {
		// $4,000 paid down over June–September, $1,000 a month: $2,000 left is gone by November.
		expect(health({ goals: [card(200_000)] })).toEqual([]);
	});

	it("warns when what's owed won't reach $0 by the date at its pace", () => {
		// $800 paid down over 4 months is $200 a month: $5,200 takes 26 more.
		expect(health({ goals: [card(520_000)] })).toEqual([
			expect.objectContaining({ kind: "goal-late", goalId: "card", reachedIn: "2028-11" }),
		]);
	});

	it("warns when what's owed has gone up, so it isn't coming down", () => {
		expect(health({ goals: [card(650_000)] })).toEqual([
			expect.objectContaining({ kind: "goal-late", goalId: "card", reachedIn: null }),
		]);
	});

	it("never warns about one that's paid off", () => {
		expect(health({ goals: [card(0)] })).toEqual([]);
	});

	it("doesn't count its funding as progress", () => {
		expect(health({ goals: [card(650_000)], changes: funding("card", 100_000) })).toEqual([
			expect.objectContaining({ kind: "goal-late", goalId: "card" }),
		]);
	});

	it("warns when a Commitment pays down a card Noodle has begun to follow", () => {
		const records: PlanRecords = {
			...healthy,
			commitments: [
				{
					id: "amex-payment",
					name: "Amex payment",
					fromMonth: "2026-01",
					endedFromMonth: null,
					accountId: "amex",
				},
				{
					id: "carried",
					name: "Old Visa balance",
					fromMonth: "2026-01",
					endedFromMonth: null,
					accountId: "visa",
					carriedBalance: true,
				},
				{
					id: "store",
					name: "Store card",
					fromMonth: "2026-01",
					endedFromMonth: null,
					accountId: "store",
				},
				{ id: "rent", name: "Rent", fromMonth: "2026-01", endedFromMonth: null },
				{
					id: "ended",
					name: "Ended",
					fromMonth: "2026-01",
					endedFromMonth: "2026-06",
					accountId: "amex",
				},
			],
			commitmentTerms: ["amex-payment", "carried", "store", "rent", "ended"].map(
				(commitmentId) => ({
					commitmentId,
					month: "2026-01" as MonthKey,
					amount: 10_000,
					cadence: "monthly" as const,
					dueDate: "2026-01-05" as const,
				}),
			),
		};
		const cards = [
			{ id: "amex", name: "American Express", connected: true, followed: true },
			{ id: "visa", name: "Visa", connected: false, followed: true },
			// Its purchases aren't in Noodle (a Parent said so, or nothing seen lately): its payments are the spending.
			{ id: "store", name: "Store card", connected: false, followed: false },
		];
		expect(health({ records, cards })).toEqual([
			{
				kind: "card-followed",
				commitmentId: "amex-payment",
				name: "Amex payment",
				accountId: "amex",
				account: "American Express",
				connected: true,
			},
		]);
		// Without the cards nothing is checked.
		expect(health({ records })).toEqual([]);
	});
});

describe("byUrgency", () => {
	const late = (goalId: string, name: string, targetDate: string): PlanWarning => ({
		kind: "goal-late",
		goalId,
		name,
		targetDate: targetDate as DayKey,
		reachedIn: null,
	});
	const over = (bucketId: string, name: string, gap: number): PlanWarning => ({
		kind: "bucket-over",
		bucketId,
		name,
		over: 3,
		months: 6,
		gap: gap as never,
	});
	const behind: PlanWarning = {
		kind: "income-behind",
		month: "2026-10" as MonthKey,
		short: 100 as never,
		received: 0 as never,
		expected: 100 as never,
	};

	it("gives one order whatever order the warnings were found in", () => {
		const car = late("g2", "Next car", "2027-06-01");
		const trip = late("g1", "Hawaii trip", "2027-03-01");
		const twin = late("g0", "Hawaii trip", "2027-03-01");
		const dining = over("b1", "Dining out", 5000);
		const fun = over("b2", "Fun", 12000);
		const expected = [behind, twin, trip, car, fun, dining];
		expect(byUrgency([car, dining, trip, fun, behind, twin])).toEqual(expected);
		expect(byUrgency([fun, twin, behind, trip, dining, car])).toEqual(expected);
		expect(byUrgency([...expected].reverse())).toEqual(expected);
	});

	it("leaves the list it was given alone", () => {
		const given = [over("b1", "Dining out", 1), behind];
		byUrgency(given);
		expect(given[1]).toBe(behind);
	});
});
