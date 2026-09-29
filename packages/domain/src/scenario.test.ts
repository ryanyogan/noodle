import { describe, expect, it } from "vitest";
import {
	type BucketRecord,
	type DayKey,
	type MonthKey,
	moneyFreed,
	type PlanRecords,
	type ProjectionGoal,
	planAhead,
	project,
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

const records: PlanRecords = {
	baselines: [
		{ month: "2026-09", amount: 900_000 },
		{ month: "2027-01", amount: 950_000 },
	],
	buckets: [
		bucket("groceries", { position: 1 }),
		bucket("hockey", { position: 2 }),
		bucket("fun", { position: 3, archivedFromMonth: "2026-12" }),
	],
	allowances: [
		{ bucketId: "groceries", month: "2026-09", amount: 120_000 },
		{ bucketId: "hockey", month: "2026-09", amount: 40_000 },
		// Summer hockey camp, set on its own.
		{ bucketId: "hockey", month: "2026-11", amount: 80_000 },
		{ bucketId: "hockey", month: "2026-12", amount: 40_000 },
		{ bucketId: "fun", month: "2026-09", amount: 20_000 },
	],
	commitments: [
		{ id: "mortgage", name: "Mortgage", fromMonth: "2026-09", endedFromMonth: null },
		{ id: "insurance", name: "Insurance", fromMonth: "2026-09", endedFromMonth: null },
		{ id: "streaming", name: "Streaming", fromMonth: "2026-09", endedFromMonth: "2027-03" },
	],
	commitmentTerms: [
		{
			commitmentId: "mortgage",
			month: "2026-09",
			amount: 300_000,
			cadence: "monthly",
			dueDate: "2026-09-01",
		},
		{
			commitmentId: "insurance",
			month: "2026-09",
			amount: 120_000,
			cadence: "annual",
			dueDate: "2026-11-15",
		},
		{
			commitmentId: "streaming",
			month: "2026-09",
			amount: 2_000,
			cadence: "monthly",
			dueDate: "2026-09-10",
		},
	],
	rolling: [],
};

const ahead = (goals: ProjectionGoal[] = [], count = 12) =>
	planAhead(records, goals, "2026-09", count);

const month = (m: MonthKey, projection: ReturnType<typeof project>) =>
	projection.months.find((p) => p.month === m);

describe("project: the Plan as it stands", () => {
	const plan = project(ahead());

	it("runs month by month from the current one", () => {
		expect(plan.months).toHaveLength(12);
		expect(plan.months[0]?.month).toBe("2026-09");
		expect(plan.months[11]?.month).toBe("2027-08");
	});

	it("is the Baseline less Commitments expected and allowances, each month", () => {
		expect(month("2026-09", plan)).toEqual({
			month: "2026-09",
			baseline: 900_000,
			commitments: 302_000,
			allowances: 180_000,
			goalFunding: 0,
			freeToSpend: 418_000,
		});
	});

	it("follows every effective-dated change already in the Plan", () => {
		// The annual premium lands in November, with the camp allowance.
		expect(month("2026-11", plan)?.commitments).toBe(422_000);
		expect(month("2026-11", plan)?.allowances).toBe(220_000);
		// Fun is archived from December; the Baseline rises in January; Streaming ends in March.
		expect(month("2026-12", plan)?.allowances).toBe(160_000);
		expect(month("2027-01", plan)?.baseline).toBe(950_000);
		expect(month("2027-03", plan)?.commitments).toBe(300_000);
	});

	it("adds up Free to Spend over the months projected", () => {
		expect(plan.freeToSpend).toBe(plan.months.reduce((sum, m) => sum + m.freeToSpend, 0));
	});

	it("says a Plan that assigns more than the Baseline out loud (never clamped)", () => {
		const tight = project(ahead(), [{ kind: "allowance", bucketId: "groceries", amount: 800_000 }]);
		expect(month("2026-09", tight)?.freeToSpend).toBe(900_000 - 302_000 - 860_000);
	});
});

describe("project: Levers", () => {
	const plan = project(ahead());

	it("an allowance Lever sets it from the first month until a later month set its own", () => {
		const scenario = project(ahead(), [{ kind: "allowance", bucketId: "hockey", amount: 25_000 }]);
		expect(month("2026-09", scenario)?.allowances).toBe(165_000);
		expect(month("2026-10", scenario)?.allowances).toBe(165_000);
		// November and December were set on their own, as applying the Scenario would leave them.
		expect(month("2026-11", scenario)?.allowances).toBe(220_000);
		expect(month("2027-01", scenario)?.allowances).toBe(160_000);
	});

	it("ending a Commitment takes it out from its month on", () => {
		const scenario = project(ahead(), [
			{ kind: "end-commitment", commitmentId: "mortgage", fromMonth: "2026-10" },
		]);
		expect(month("2026-09", scenario)?.commitments).toBe(302_000);
		expect(month("2026-10", scenario)?.commitments).toBe(2_000);
	});

	it("frees money against the Plan, added up month by month", () => {
		const scenario = project(ahead(), [
			{ kind: "end-commitment", commitmentId: "streaming", fromMonth: "2026-09" },
		]);
		const freed = moneyFreed(plan, scenario);
		expect(freed[0]).toBe(2_000);
		expect(freed[5]).toBe(12_000);
		// Streaming was ending in March anyway.
		expect(freed[11]).toBe(12_000);
		expect(scenario.freeToSpend - plan.freeToSpend).toBe(12_000);
	});

	it("ignores Levers on Buckets, Commitments or Goals no longer in the Plan", () => {
		const scenario = project(ahead(), [
			{ kind: "allowance", bucketId: "gone", amount: 1 },
			{ kind: "end-commitment", commitmentId: "gone", fromMonth: "2026-09" },
			{ kind: "goal", goalId: "gone", target: 1, targetDate: null },
		]);
		expect(scenario).toEqual(plan);
	});
});

describe("project: Goals", () => {
	const car: ProjectionGoal = {
		id: "car",
		target: 1_200_000,
		targetDate: "2027-08-31",
		saved: 0,
		fundedThisMonth: 0,
	};

	it("funds a dated Goal its monthly needed amount out of Free to Spend until it's reached", () => {
		const projection = project(ahead([car]));
		const [goal] = projection.goals;
		expect(goal?.monthly).toBe(100_000);
		expect(goal?.earmarks[0]).toBe(100_000);
		expect(goal?.earmarks[11]).toBe(1_200_000);
		expect(goal?.reachedIn).toBe("2027-08");
		expect(month("2026-09", projection)?.goalFunding).toBe(100_000);
		expect(month("2026-09", projection)?.freeToSpend).toBe(318_000);
	});

	it("counts this month's funding so far, and funds only what's left of it", () => {
		const projection = project(ahead([{ ...car, saved: 60_000, fundedThisMonth: 60_000 }]));
		expect(projection.goals[0]?.monthly).toBe(100_000);
		expect(projection.goals[0]?.earmarks[0]).toBe(100_000);
		expect(month("2026-09", projection)?.goalFunding).toBe(100_000);
	});

	it("stops funding once the target is reached, never over it", () => {
		// 1,000,000 over 12 months rounds up to 83,334 a month.
		const projection = project(ahead([{ ...car, target: 1_000_000 }]));
		expect(projection.goals[0]?.monthly).toBe(83_334);
		expect(projection.goals[0]?.earmarks[11]).toBe(1_000_000);
		expect(projection.goals[0]?.reachedIn).toBe("2027-08");
		expect(month("2027-08", projection)?.goalFunding).toBe(1_000_000 - 83_334 * 11);
	});

	it("keeps an undated Goal's Earmark as it is", () => {
		const projection = project(ahead([{ ...car, targetDate: null, saved: 50_000 }]));
		expect(projection.goals[0]).toMatchObject({ monthly: null, reachedIn: null });
		expect(projection.goals[0]?.earmarks[11]).toBe(50_000);
		expect(month("2026-09", projection)?.goalFunding).toBe(0);
	});

	it("marks a Goal already reached as reached this month", () => {
		const projection = project(ahead([{ ...car, saved: 1_300_000 }]));
		expect(projection.goals[0]?.reachedIn).toBe("2026-09");
		expect(month("2026-10", projection)?.goalFunding).toBe(0);
	});

	it("a Goal Lever moves its date and target, and with them what it takes each month", () => {
		const later = project(ahead([car], 24), [
			{ kind: "goal", goalId: "car", target: 1_200_000, targetDate: "2028-08-31" },
		]);
		expect(later.goals[0]).toMatchObject({ monthly: 50_000, reachedIn: "2028-08" });
		expect(month("2026-09", later)?.freeToSpend).toBe(368_000);

		const bigger = project(ahead([car]), [
			{ kind: "goal", goalId: "car", target: 2_400_000, targetDate: "2027-08-31" },
		]);
		expect(bigger.goals[0]).toMatchObject({ monthly: 200_000, target: 2_400_000 });
	});

	it("reports a Goal reached after the months projected as not reached", () => {
		const projection = project(ahead([{ ...car, targetDate: "2028-08-31" }]));
		expect(projection.goals[0]?.reachedIn).toBeNull();
	});
});

describe("project: fast enough for every slider frame", () => {
	const many: PlanRecords = {
		...records,
		buckets: Array.from({ length: 12 }, (_, i) => bucket(`b${i}`, { position: i })),
		allowances: Array.from({ length: 12 }, (_, i) => ({
			bucketId: `b${i}`,
			month: "2026-09" as MonthKey,
			amount: 10_000 * (i + 1),
		})),
		commitments: Array.from({ length: 20 }, (_, i) => ({
			id: `c${i}`,
			name: `c${i}`,
			fromMonth: "2026-09" as MonthKey,
			endedFromMonth: null,
		})),
		commitmentTerms: Array.from({ length: 20 }, (_, i) => ({
			commitmentId: `c${i}`,
			month: "2026-09" as MonthKey,
			amount: 5_000,
			cadence: (["monthly", "biweekly", "annual"] as const)[i % 3] ?? "monthly",
			dueDate: "2026-09-05" as const,
		})),
	};
	const goals: ProjectionGoal[] = Array.from({ length: 6 }, (_, i) => ({
		id: `g${i}`,
		target: 500_000,
		targetDate: `20${28 + i}-06-30` as DayKey,
		saved: 10_000,
		fundedThisMonth: 0,
	}));

	it("projects 60 months in well under a millisecond", () => {
		const resolved = planAhead(many, goals, "2026-09", 60);
		const runs = 500;
		const started = Date.now();
		for (let i = 0; i < runs; i++) {
			project(resolved, [
				{ kind: "allowance", bucketId: "b3", amount: i * 100 },
				{ kind: "end-commitment", commitmentId: "c4", fromMonth: "2027-01" },
				{ kind: "goal", goalId: "g1", target: 600_000, targetDate: "2029-01-31" },
			]);
		}
		expect((Date.now() - started) / runs).toBeLessThan(1);
	});

	it("resolves 60 months of the Plan in a few milliseconds", () => {
		const started = Date.now();
		planAhead(many, goals, "2026-09", 60);
		expect(Date.now() - started).toBeLessThan(20);
	});
});
