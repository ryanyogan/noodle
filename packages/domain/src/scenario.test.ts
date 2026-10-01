import { describe, expect, it } from "vitest";
import {
	activeLevers,
	type BucketRecord,
	type DayKey,
	type Lever,
	type LeverV1,
	leverImpacts,
	type MonthKey,
	moneyFreed,
	type PlanAhead,
	type PlanRecords,
	type ProjectionGoal,
	planAhead,
	project,
	readScenarioLevers,
	upgradeLevers,
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

// The tests up to "engine v2" project v1 Levers, as saved before Levers had ranges, upgraded:
// they must come out exactly as they always have.
const projectV1 = (a: PlanAhead, changes: LeverV1[] = []) =>
	project(a, upgradeLevers(changes, "2026-09"));

const month = (m: MonthKey, projection: ReturnType<typeof project>) =>
	projection.months.find((p) => p.month === m);

describe("project: the Plan as it stands", () => {
	const plan = projectV1(ahead());

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
			oneOffs: 0,
			cushion: 418_000,
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
		const tight = projectV1(ahead(), [
			{ kind: "allowance", bucketId: "groceries", amount: 800_000 },
		]);
		expect(month("2026-09", tight)?.freeToSpend).toBe(900_000 - 302_000 - 860_000);
	});
});

describe("project: Levers", () => {
	const plan = projectV1(ahead());

	it("an allowance Lever sets it from the first month until a later month set its own", () => {
		const scenario = projectV1(ahead(), [
			{ kind: "allowance", bucketId: "hockey", amount: 25_000 },
		]);
		expect(month("2026-09", scenario)?.allowances).toBe(165_000);
		expect(month("2026-10", scenario)?.allowances).toBe(165_000);
		// November and December were set on their own, as applying the Scenario would leave them.
		expect(month("2026-11", scenario)?.allowances).toBe(220_000);
		expect(month("2027-01", scenario)?.allowances).toBe(160_000);
	});

	it("ending a Commitment takes it out from its month on", () => {
		const scenario = projectV1(ahead(), [
			{ kind: "end-commitment", commitmentId: "mortgage", fromMonth: "2026-10" },
		]);
		expect(month("2026-09", scenario)?.commitments).toBe(302_000);
		expect(month("2026-10", scenario)?.commitments).toBe(2_000);
	});

	it("frees money against the Plan, added up month by month", () => {
		const scenario = projectV1(ahead(), [
			{ kind: "end-commitment", commitmentId: "streaming", fromMonth: "2026-09" },
		]);
		const freed = moneyFreed(plan, scenario);
		expect(freed[0]).toBe(2_000);
		expect(freed[5]).toBe(12_000);
		// Streaming was ending in March anyway.
		expect(freed[11]).toBe(12_000);
		expect(scenario.freeToSpend - plan.freeToSpend).toBe(12_000);
	});

	it("a new Commitment takes its amount every month from its month, for its term", () => {
		// A $450 car loan from November for 3 months: November, December and January.
		const scenario = projectV1(ahead(), [
			{
				kind: "add-commitment",
				commitmentId: "car",
				name: "Car loan",
				amount: 45_000,
				fromMonth: "2026-11",
				months: 3,
			},
		]);
		expect(month("2026-10", scenario)?.commitments).toBe(302_000);
		expect(month("2026-11", scenario)?.commitments).toBe(422_000 + 45_000);
		expect(month("2027-01", scenario)?.commitments).toBe(302_000 + 45_000);
		expect(month("2027-02", scenario)?.commitments).toBe(302_000);
		expect(scenario.freeToSpend).toBe(plan.freeToSpend - 3 * 45_000);
	});

	it("a new Commitment with no term runs for good, alongside ending the one it replaces", () => {
		// A $3,400 mortgage replacing the $3,000 one from October.
		const scenario = projectV1(ahead(), [
			{ kind: "end-commitment", commitmentId: "mortgage", fromMonth: "2026-10" },
			{
				kind: "add-commitment",
				commitmentId: "home",
				name: "New home",
				amount: 340_000,
				fromMonth: "2026-10",
				months: null,
			},
		]);
		expect(month("2026-09", scenario)?.commitments).toBe(302_000);
		expect(month("2026-10", scenario)?.commitments).toBe(342_000);
		expect(month("2027-08", scenario)?.commitments).toBe(340_000);
		expect(moneyFreed(plan, scenario)[11]).toBe(-11 * 40_000);
	});

	it("ignores Levers on Buckets, Commitments or Goals no longer in the Plan", () => {
		const scenario = projectV1(ahead(), [
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
		const projection = projectV1(ahead([car]));
		const [goal] = projection.goals;
		expect(goal?.monthly).toBe(100_000);
		expect(goal?.earmarks[0]).toBe(100_000);
		expect(goal?.earmarks[11]).toBe(1_200_000);
		expect(goal?.reachedIn).toBe("2027-08");
		expect(month("2026-09", projection)?.goalFunding).toBe(100_000);
		expect(month("2026-09", projection)?.freeToSpend).toBe(318_000);
	});

	it("counts this month's funding so far, and funds only what's left of it", () => {
		const projection = projectV1(ahead([{ ...car, saved: 60_000, fundedThisMonth: 60_000 }]));
		expect(projection.goals[0]?.monthly).toBe(100_000);
		expect(projection.goals[0]?.earmarks[0]).toBe(100_000);
		expect(month("2026-09", projection)?.goalFunding).toBe(100_000);
	});

	it("stops funding once the target is reached, never over it", () => {
		// 1,000,000 over 12 months rounds up to 83,334 a month.
		const projection = projectV1(ahead([{ ...car, target: 1_000_000 }]));
		expect(projection.goals[0]?.monthly).toBe(83_334);
		expect(projection.goals[0]?.earmarks[11]).toBe(1_000_000);
		expect(projection.goals[0]?.reachedIn).toBe("2027-08");
		expect(month("2027-08", projection)?.goalFunding).toBe(1_000_000 - 83_334 * 11);
	});

	it("keeps an undated Goal's Earmark as it is", () => {
		const projection = projectV1(ahead([{ ...car, targetDate: null, saved: 50_000 }]));
		expect(projection.goals[0]).toMatchObject({ monthly: null, reachedIn: null });
		expect(projection.goals[0]?.earmarks[11]).toBe(50_000);
		expect(month("2026-09", projection)?.goalFunding).toBe(0);
	});

	it("marks a Goal already reached as reached this month", () => {
		const projection = projectV1(ahead([{ ...car, saved: 1_300_000 }]));
		expect(projection.goals[0]?.reachedIn).toBe("2026-09");
		expect(month("2026-10", projection)?.goalFunding).toBe(0);
	});

	it("a Goal Lever moves its date and target, and with them what it takes each month", () => {
		const later = projectV1(ahead([car], 24), [
			{ kind: "goal", goalId: "car", target: 1_200_000, targetDate: "2028-08-31" },
		]);
		expect(later.goals[0]).toMatchObject({ monthly: 50_000, reachedIn: "2028-08" });
		expect(month("2026-09", later)?.freeToSpend).toBe(368_000);

		const bigger = projectV1(ahead([car]), [
			{ kind: "goal", goalId: "car", target: 2_400_000, targetDate: "2027-08-31" },
		]);
		expect(bigger.goals[0]).toMatchObject({ monthly: 200_000, target: 2_400_000 });
	});

	it("reports a Goal reached after the months projected as not reached", () => {
		const projection = projectV1(ahead([{ ...car, targetDate: "2028-08-31" }]));
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

	// Twenty Levers of every kind, the most a sandbox is likely to hold.
	const twenty: Lever[] = [
		{ kind: "baseline", amount: 1_000_000, fromMonth: "2027-01" },
		{ kind: "growth", incomePct: 3, costsPct: 2, fromMonth: "2026-09" },
		...Array.from(
			{ length: 6 },
			(_, i): Lever => ({
				kind: "allowance",
				bucketId: `b${i}`,
				amount: 5_000 * i,
				fromMonth: "2026-10",
				untilMonth: "2028-01",
			}),
		),
		{ kind: "commitment-terms", commitmentId: "c1", amount: 9_000, fromMonth: "2027-03" },
		{ kind: "commitment-terms", commitmentId: "c2", cadence: "monthly", fromMonth: "2027-06" },
		{ kind: "end-commitment", commitmentId: "c4", fromMonth: "2027-01" },
		{
			kind: "add-commitment",
			commitmentId: "car",
			name: "Car",
			amount: 20_000,
			cadence: "biweekly",
			dueDay: 3,
			fromMonth: "2027-02",
			months: 48,
		},
		{
			kind: "one-off",
			oneOffId: "roof",
			name: "Roof",
			amount: 300_000,
			flow: "expense",
			fromMonth: "2027-05",
		},
		{
			kind: "one-off",
			oneOffId: "bonus",
			name: "Bonus",
			amount: 200_000,
			flow: "income",
			fromMonth: "2027-03",
		},
		{ kind: "add-bucket", bucketId: "swim", name: "Swim", amount: 8_000, fromMonth: "2027-01" },
		{ kind: "archive-bucket", bucketId: "b9", fromMonth: "2028-01" },
		{ kind: "goal", goalId: "g1", target: 600_000, targetDate: "2029-01-31", fromMonth: "2026-09" },
		{
			kind: "add-goal",
			goalId: "trip",
			name: "Trip",
			target: 400_000,
			targetDate: "2028-06-30",
			fromMonth: "2026-12",
		},
		{ kind: "allowance", bucketId: "swim", amount: 9_000, fromMonth: "2028-01" },
		{ kind: "archive-bucket", bucketId: "b10", fromMonth: "2027-01", untilMonth: "2027-04" },
	];

	// A speed budget measures what the code can do, so each test takes the fastest of many runs
	// after a warm-up: noise from a shared machine only ever adds time, never takes it away. CI's
	// runner has 2 vCPUs shared by every package's tests at once (turbo runs them together), so it
	// samples for up to a second and a half to catch a quiet moment, and allows half as much again
	// there. A real blowup (a Lever that re-resolves the Plan, a quadratic loop) is many times
	// the budget, so it still fails.
	const fastest = (work: () => void): number => {
		work();
		work();
		let best = Number.POSITIVE_INFINITY;
		const sampling = performance.now();
		for (let run = 0; run < 30 && (run < 5 || performance.now() - sampling < 1_500); run++) {
			const started = performance.now();
			work();
			best = Math.min(best, performance.now() - started);
		}
		return best;
	};
	const budget = (ms: number) => (process.env.CI ? ms * 1.5 : ms);

	it("projects 60 months with twenty Levers well within a slider frame", () => {
		expect(twenty).toHaveLength(20);
		const resolved = planAhead(many, goals, "2026-09", 60);
		// Ten projections a run, a few milliseconds here.
		const ten = () => {
			for (let i = 0; i < 10; i++) project(resolved, twenty);
		};
		expect(fastest(ten)).toBeLessThan(budget(50));
	});

	it("resolves the Plan and works out every Lever's impact in well under 100ms", () => {
		expect(fastest(() => leverImpacts(planAhead(many, goals, "2026-09", 60), twenty))).toBeLessThan(
			budget(100),
		);
	});

	it("resolves 60 months of the Plan in a few milliseconds", () => {
		expect(fastest(() => planAhead(many, goals, "2026-09", 60))).toBeLessThan(budget(50));
	});
});

// ---------------------------------------------------------------------------------------------
// Engine v2: Levers with ranges, and the kinds that change anything in the Plan.

describe("v1 Scenarios", () => {
	const v1: LeverV1[] = [
		{ kind: "allowance", bucketId: "hockey", amount: 25_000 },
		{ kind: "end-commitment", commitmentId: "mortgage", fromMonth: "2026-10" },
		{ kind: "goal", goalId: "car", target: 1_000_000, targetDate: null },
		{
			kind: "add-commitment",
			commitmentId: "car",
			name: "Car loan",
			amount: 45_000,
			fromMonth: "2026-11",
			months: 3,
		},
	];

	it("upgrade to v2 Levers that mean the same: from the first month, due monthly on the 1st", () => {
		expect(upgradeLevers(v1, "2026-09")).toEqual([
			{ kind: "allowance", bucketId: "hockey", amount: 25_000, fromMonth: "2026-09" },
			{ kind: "end-commitment", commitmentId: "mortgage", fromMonth: "2026-10" },
			{ kind: "goal", goalId: "car", target: 1_000_000, targetDate: null, fromMonth: "2026-09" },
			{
				kind: "add-commitment",
				commitmentId: "car",
				name: "Car loan",
				amount: 45_000,
				fromMonth: "2026-11",
				months: 3,
				cadence: "monthly",
				dueDay: 1,
			},
		]);
	});

	it("load whether saved as a bare v1 array or as versioned v2 JSON", () => {
		const upgraded = upgradeLevers(v1, "2026-09");
		expect(readScenarioLevers(v1, "2026-09")).toEqual(upgraded);
		expect(readScenarioLevers({ version: 2, levers: upgraded }, "2027-01")).toEqual(upgraded);
		// Upgrading again changes nothing.
		expect(upgradeLevers(upgraded, "2027-01")).toEqual(upgraded);
	});
});

describe("project: v2 Levers over a range of months", () => {
	const plan = project(ahead());

	it("a Baseline Lever changes income for its range, then the Plan's comes back", () => {
		// Parental leave: $6,000 a month for October and November.
		const leave = project(ahead(), [
			{ kind: "baseline", amount: 600_000, fromMonth: "2026-10", untilMonth: "2026-12" },
		]);
		expect(leave.months.slice(0, 4).map((m) => m.baseline)).toEqual([
			900_000, 600_000, 600_000, 900_000,
		]);
		expect(leave.freeToSpend).toBe(plan.freeToSpend - 2 * 300_000);
	});

	it("a Lever's value holds until a later month the Plan set on its own, as applying it would", () => {
		// A raise from October; the Plan already has January's Baseline set on its own.
		const raise = project(ahead(), [{ kind: "baseline", amount: 1_000_000, fromMonth: "2026-10" }]);
		expect(month("2026-12", raise)?.baseline).toBe(1_000_000);
		expect(month("2027-01", raise)?.baseline).toBe(950_000);
		// From February, it replaces January's.
		const later = project(ahead(), [{ kind: "baseline", amount: 1_000_000, fromMonth: "2027-02" }]);
		expect(month("2027-01", later)?.baseline).toBe(950_000);
		expect(month("2027-02", later)?.baseline).toBe(1_000_000);
	});

	it("a range that began before the first month holds from the first month", () => {
		const scenario = project(ahead(), [
			{ kind: "allowance", bucketId: "hockey", amount: 25_000, fromMonth: "2026-06" },
		]);
		expect(month("2026-09", scenario)?.allowances).toBe(165_000);
		// November was set on its own after the first month.
		expect(month("2026-11", scenario)?.allowances).toBe(220_000);
	});

	it("an allowance Lever for a few months: Groceries +$300 for October to December", () => {
		const scenario = project(ahead(), [
			{
				kind: "allowance",
				bucketId: "groceries",
				amount: 150_000,
				fromMonth: "2026-10",
				untilMonth: "2027-01",
			},
		]);
		expect(scenario.months.slice(0, 5).map((m) => m.allowances)).toEqual([
			180_000, 210_000, 250_000, 190_000, 160_000,
		]);
	});

	it("changes a Commitment's amount from a month", () => {
		const scenario = project(ahead(), [
			{ kind: "commitment-terms", commitmentId: "mortgage", amount: 350_000, fromMonth: "2026-10" },
		]);
		expect(month("2026-09", scenario)?.commitments).toBe(302_000);
		expect(month("2026-10", scenario)?.commitments).toBe(352_000);
		expect(month("2027-08", scenario)?.commitments).toBe(350_000);
	});

	it("changes a Commitment to biweekly, three payments in some months, as real Commitments", () => {
		// Due every other Friday from October 2: Oct 2, 16, 30; Nov 13, 27.
		const scenario = project(ahead(), [
			{
				kind: "commitment-terms",
				commitmentId: "mortgage",
				amount: 150_000,
				cadence: "biweekly",
				dueDay: 2,
				fromMonth: "2026-10",
				untilMonth: "2026-12",
			},
		]);
		expect(month("2026-10", scenario)?.commitments).toBe(3 * 150_000 + 2_000);
		expect(month("2026-11", scenario)?.commitments).toBe(2 * 150_000 + 2_000 + 120_000);
		// The Plan's monthly terms come back in December.
		expect(month("2026-12", scenario)?.commitments).toBe(302_000);
	});

	it("keeps an annual Commitment's month when only its due day changes", () => {
		const scenario = project(ahead(), [
			{ kind: "commitment-terms", commitmentId: "insurance", dueDay: 1, fromMonth: "2026-09" },
		]);
		expect(scenario.months.map((m) => m.commitments)).toEqual(
			plan.months.map((m) => m.commitments),
		);
		// Streaming turned annual from October is due each October, on its old day.
		const annual = project(ahead([], 14), [
			{
				kind: "commitment-terms",
				commitmentId: "streaming",
				cadence: "annual",
				amount: 20_000,
				fromMonth: "2026-10",
			},
		]);
		expect(month("2026-10", annual)?.commitments).toBe(300_000 + 20_000);
		expect(month("2026-12", annual)?.commitments).toBe(300_000);
	});

	it("ends a Commitment for a while", () => {
		const scenario = project(ahead(), [
			{
				kind: "end-commitment",
				commitmentId: "mortgage",
				fromMonth: "2026-10",
				untilMonth: "2026-12",
			},
		]);
		expect(scenario.months.slice(0, 4).map((m) => m.commitments)).toEqual([
			302_000, 2_000, 122_000, 302_000,
		]);
	});

	it("adds a biweekly Commitment for its term", () => {
		const scenario = project(ahead(), [
			{
				kind: "add-commitment",
				commitmentId: "daycare",
				name: "Daycare",
				amount: 50_000,
				cadence: "biweekly",
				dueDay: 2,
				fromMonth: "2026-10",
				months: 3,
			},
		]);
		const added = scenario.months.map((m, i) => m.commitments - (plan.months[i]?.commitments ?? 0));
		// Oct 2, 16, 30; Nov 13, 27; Dec 11, 25; then its term is over.
		expect(added.slice(0, 5)).toEqual([0, 150_000, 100_000, 100_000, 0]);
	});

	it("adds an annual Commitment in its month each year, ending at untilMonth before its term", () => {
		const change: Lever = {
			kind: "add-commitment",
			commitmentId: "tuition",
			name: "Tuition",
			amount: 500_000,
			cadence: "annual",
			dueDay: 15,
			fromMonth: "2026-10",
			months: null,
		};
		const plan14 = project(ahead([], 14));
		const extra = (changes: Lever[]) =>
			project(ahead([], 14), changes)
				.months.map((m, i) => m.commitments - (plan14.months[i]?.commitments ?? 0))
				.filter((x) => x !== 0);
		expect(extra([change])).toEqual([500_000, 500_000]);
		expect(extra([{ ...change, untilMonth: "2027-10" }])).toEqual([500_000]);
		expect(extra([{ ...change, months: 12, untilMonth: "2028-01" }])).toEqual([500_000]);
	});

	it("a one-off lands in its month, outside Free to Spend but in the Cushion", () => {
		const scenario = project(ahead(), [
			{
				kind: "one-off",
				oneOffId: "roof",
				name: "Roof",
				amount: 300_000,
				flow: "expense",
				fromMonth: "2026-11",
			},
			{
				kind: "one-off",
				oneOffId: "bonus",
				name: "Bonus",
				amount: 200_000,
				flow: "income",
				fromMonth: "2027-03",
			},
			// Before the first month: already happened, so not projected.
			{
				kind: "one-off",
				oneOffId: "old",
				name: "Old",
				amount: 1,
				flow: "income",
				fromMonth: "2026-08",
			},
		]);
		expect(scenario.freeToSpend).toBe(plan.freeToSpend);
		expect(month("2026-11", scenario)?.oneOffs).toBe(-300_000);
		expect(month("2027-03", scenario)?.oneOffs).toBe(200_000);
		expect(scenario.oneOffs).toBe(-100_000);
		expect(scenario.months.at(-1)?.cushion).toBe(plan.freeToSpend - 100_000);
	});

	it("adds a Bucket for its range, and archives one from its month", () => {
		const scenario = project(ahead(), [
			{
				kind: "add-bucket",
				bucketId: "swim",
				name: "Swim",
				amount: 30_000,
				fromMonth: "2026-10",
				untilMonth: "2027-01",
			},
			{ kind: "archive-bucket", bucketId: "groceries", fromMonth: "2026-11" },
			{ kind: "archive-bucket", bucketId: "swim", fromMonth: "2026-12" },
		]);
		expect(scenario.months.slice(0, 5).map((m) => m.allowances)).toEqual([
			180_000, 210_000, 130_000, 40_000, 40_000,
		]);
	});

	it("an allowance Lever changes an added Bucket's allowance too", () => {
		const scenario = project(ahead(), [
			{ kind: "add-bucket", bucketId: "swim", name: "Swim", amount: 30_000, fromMonth: "2026-10" },
			{ kind: "allowance", bucketId: "swim", amount: 10_000, fromMonth: "2026-12" },
		]);
		expect(month("2026-11", scenario)?.allowances).toBe(250_000);
		expect(month("2026-12", scenario)?.allowances).toBe(170_000);
	});

	it("ignores Levers on things no longer in the Plan", () => {
		const scenario = project(ahead(), [
			{ kind: "baseline", amount: 900_000, fromMonth: "2026-09" },
			{ kind: "commitment-terms", commitmentId: "gone", amount: 1, fromMonth: "2026-09" },
			{ kind: "archive-bucket", bucketId: "gone", fromMonth: "2026-09" },
			{ kind: "end-commitment", commitmentId: "gone", fromMonth: "2026-09", untilMonth: "2026-10" },
		]);
		expect(scenario).toEqual(plan);
	});
});

describe("project: growth", () => {
	it("compounds yearly in steps from its first month, for income and costs separately", () => {
		const grown = project(ahead([], 25), [
			{ kind: "growth", incomePct: 3, costsPct: 2, fromMonth: "2026-09" },
		]);
		const flat = project(ahead([], 25));
		// The first twelve months hold.
		expect(grown.months.slice(0, 12)).toEqual(flat.months.slice(0, 12));
		expect(month("2027-09", grown)).toMatchObject({
			baseline: 978_500,
			commitments: 306_000,
			allowances: 163_200,
		});
		// Compounded in the second year: 950,000 × 1.03².
		expect(month("2028-09", grown)?.baseline).toBe(1_007_855);
	});

	it("holds only over its range", () => {
		const grown = project(ahead([], 25), [
			{ kind: "growth", incomePct: 10, costsPct: 0, fromMonth: "2026-09", untilMonth: "2028-01" },
		]);
		expect(month("2027-12", grown)?.baseline).toBe(1_045_000);
		expect(month("2028-01", grown)?.baseline).toBe(950_000);
	});
});

describe("project: the Cushion", () => {
	it("builds up Free to Spend and one-offs month by month from a starting balance", () => {
		const projection = project(ahead(), [], { startingBalance: 100_000 });
		expect(projection.startingCushion).toBe(100_000);
		expect(month("2026-09", projection)?.cushion).toBe(518_000);
		expect(month("2026-10", projection)?.cushion).toBe(936_000);
		expect(projection.lowest).toEqual({ month: "2026-09", amount: 518_000 });
		expect(projection.firstNegative).toBeNull();
	});

	it("reports its lowest point and the first month it goes negative", () => {
		const projection = project(ahead(), [
			{
				kind: "one-off",
				oneOffId: "roof",
				name: "Roof",
				amount: 1_000_000,
				flow: "expense",
				fromMonth: "2026-10",
			},
		]);
		expect(projection.months.slice(0, 3).map((m) => m.cushion)).toEqual([
			418_000, -164_000, 94_000,
		]);
		expect(projection.lowest).toEqual({ month: "2026-10", amount: -164_000 });
		expect(projection.firstNegative).toBe("2026-10");
	});

	it("starts from zero without a balance, and has no lowest point with no months", () => {
		expect(project(ahead()).startingCushion).toBe(0);
		expect(project(ahead([], 0))).toMatchObject({ lowest: null, firstNegative: null });
	});
});

describe("project: Goals in v2", () => {
	const car: ProjectionGoal = {
		id: "car",
		target: 1_200_000,
		targetDate: "2027-08-31",
		saved: 0,
		fundedThisMonth: 0,
	};

	it("an added Goal gets its own Earmark path, funded from its first month", () => {
		const projection = project(ahead(), [
			{
				kind: "add-goal",
				goalId: "trip",
				name: "Trip",
				target: 120_000,
				targetDate: "2027-02-28",
				fromMonth: "2026-11",
			},
		]);
		const [trip] = projection.goals;
		expect(trip).toMatchObject({
			goalId: "trip",
			added: true,
			monthly: 30_000,
			reachedIn: "2027-02",
		});
		expect(trip?.earmarks.slice(0, 7)).toEqual([0, 0, 30_000, 60_000, 90_000, 120_000, 120_000]);
		expect(month("2026-11", projection)?.goalFunding).toBe(30_000);
		expect(month("2027-03", projection)?.goalFunding).toBe(0);
	});

	it("a Goal Lever from a later month works out what it needs again from its Earmark then", () => {
		const projection = project(ahead([car], 24), [
			{
				kind: "goal",
				goalId: "car",
				target: 1_200_000,
				targetDate: "2028-08-31",
				fromMonth: "2026-12",
			},
		]);
		const [goal] = projection.goals;
		// $1,000 a month through November, then the $9,000 left over 21 months.
		expect(goal?.monthly).toBe(100_000);
		expect(goal?.earmarks.slice(2, 4)).toEqual([300_000, 342_858]);
		expect(goal?.reachedIn).toBe("2028-08");
	});

	it("a Goal Lever for a while gives the Goal back its own target and date at its end", () => {
		// No date (so not funded) for December to February.
		const projection = project(ahead([car], 12), [
			{
				kind: "goal",
				goalId: "car",
				target: 1_200_000,
				targetDate: null,
				fromMonth: "2026-12",
				untilMonth: "2027-03",
			},
		]);
		const [goal] = projection.goals;
		// Back in March: $9,000 left over six months.
		expect(goal?.earmarks.slice(2, 7)).toEqual([300_000, 300_000, 300_000, 300_000, 450_000]);
		expect(goal?.reachedIn).toBe("2027-08");
	});
});

describe("leverImpacts: each Lever left out in turn", () => {
	const car: ProjectionGoal = {
		id: "car",
		target: 1_200_000,
		targetDate: "2027-08-31",
		saved: 0,
		fundedThisMonth: 0,
	};
	const changes: Lever[] = [
		{ kind: "end-commitment", commitmentId: "streaming", fromMonth: "2026-09" },
		{
			kind: "one-off",
			oneOffId: "roof",
			name: "Roof",
			amount: 300_000,
			flow: "expense",
			fromMonth: "2026-11",
		},
		{
			kind: "goal",
			goalId: "car",
			target: 1_200_000,
			targetDate: "2028-08-31",
			fromMonth: "2026-09",
		},
		{ kind: "allowance", bucketId: "gone", amount: 1, fromMonth: "2026-09" },
	];
	const impacts = leverImpacts(ahead([car], 24), changes, { startingBalance: 50_000 });

	it("has one impact per Lever, in order", () => {
		expect(impacts).toHaveLength(4);
	});

	it("says what a Lever frees each month and over the horizon", () => {
		// Streaming ends in March anyway: $20 a month for six months.
		expect(impacts[0]).toMatchObject({
			freeToSpend: 12_000,
			cushion: 12_000,
			firstChange: { month: "2026-09", amount: 2_000 },
			goals: [],
		});
	});

	it("shows a one-off in the Cushion, not Free to Spend", () => {
		expect(impacts[1]).toMatchObject({
			freeToSpend: 0,
			cushion: -300_000,
			firstChange: { month: "2026-11", amount: -300_000 },
		});
	});

	it("says how far a Lever moves a Goal", () => {
		expect(impacts[2]?.goals).toEqual([
			{ goalId: "car", reachedIn: "2028-08", without: "2027-08", months: 12 },
		]);
		expect(impacts[2]?.firstChange).toEqual({ month: "2026-09", amount: 50_000 });
		expect(impacts[2]?.lowest).toBe(50_000);
	});

	it("is nothing for a Lever on something no longer in the Plan", () => {
		expect(impacts[3]).toEqual({
			freeToSpend: 0,
			cushion: 0,
			lowest: 0,
			firstChange: null,
			byMonth: Array.from({ length: 24 }, () => ({ freeToSpend: 0, oneOffs: 0 })),
			goals: [],
		});
	});
});

describe("muted Levers", () => {
	const end: Lever = { kind: "end-commitment", commitmentId: "streaming", fromMonth: "2026-09" };
	const roof: Lever = {
		kind: "one-off",
		oneOffId: "roof",
		name: "Roof",
		amount: 300_000,
		flow: "expense",
		fromMonth: "2026-11",
	};

	it("are kept but left out of the projection", () => {
		const a = ahead();
		expect(project(a, [end, { ...roof, muted: true }])).toEqual(project(a, [end]));
		expect(project(a, [{ ...end, muted: true }])).toEqual(project(a));
		// Unmuted, a Lever counts again.
		expect(project(a, [{ ...end, muted: false }])).toEqual(project(a, [end]));
	});

	it("are left out of what applying sees", () => {
		expect(activeLevers([end, { ...roof, muted: true }])).toEqual([end]);
	});

	it("show what they'd do turned back on, with the other Levers as they are", () => {
		const [ended, muted] = leverImpacts(ahead([], 24), [end, { ...roof, muted: true }]);
		expect(ended?.freeToSpend).toBe(12_000);
		expect(muted).toMatchObject({
			freeToSpend: 0,
			cushion: -300_000,
			firstChange: { month: "2026-11", amount: -300_000 },
		});
		const [endMuted] = leverImpacts(ahead([], 24), [{ ...end, muted: true }, roof]);
		expect(endMuted).toMatchObject({ freeToSpend: 12_000, cushion: 12_000 });
	});
});
