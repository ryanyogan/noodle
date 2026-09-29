import { describe, expect, it } from "vitest";
import {
	type Lever,
	leverHoldsIn,
	leverImpacts,
	monthBreakdown,
	outcomeWarnings,
	type PlanRecords,
	type ProjectionGoal,
	planAhead,
	project,
	projectionAssumptions,
} from "./index";

// $5,000 − $1,400 Daycare − $1,600 in allowances: $2,000 Free to Spend a month.
const records = (groceries = 120_000): PlanRecords => ({
	baselines: [{ month: "2026-09", amount: 500_000 }],
	buckets: ["groceries", "hockey"].map((id, i) => ({
		id,
		name: id,
		color: 1,
		position: i + 1,
		fromMonth: "2026-09",
		archivedFromMonth: null,
	})),
	allowances: [
		{ bucketId: "groceries", month: "2026-09", amount: groceries },
		{ bucketId: "hockey", month: "2026-09", amount: 40_000 },
	],
	commitments: [{ id: "daycare", name: "Daycare", fromMonth: "2026-09", endedFromMonth: null }],
	commitmentTerms: [
		{
			commitmentId: "daycare",
			month: "2026-09",
			amount: 140_000,
			cadence: "monthly",
			dueDate: "2026-09-01",
		},
	],
	rolling: [],
});

const college: ProjectionGoal = {
	id: "college",
	target: 1_200_000,
	targetDate: "2027-08-31",
	saved: 0,
	fundedThisMonth: 0,
};

/** The Plan and a Scenario of `levers`, and the warnings between them. */
function outcome(
	levers: Lever[],
	{ count = 12, goals = [] as ProjectionGoal[], plan = records() } = {},
) {
	const ahead = planAhead(plan, goals, "2026-09", count);
	const impacts = leverImpacts(ahead, levers);
	const projections = { plan: project(ahead), scenario: project(ahead, levers) };
	return {
		...projections,
		impacts,
		warnings: outcomeWarnings({
			...projections,
			levers,
			impacts,
			goalName: (id) => (id === "college" ? "College" : id),
		}),
	};
}

const raise: Lever = { kind: "baseline", amount: 510_000, fromMonth: "2026-09" };
const groceries: Lever = {
	kind: "allowance",
	bucketId: "groceries",
	amount: 400_000,
	fromMonth: "2026-11",
};

describe("outcomeWarnings", () => {
	it("has nothing to say about a Plan that holds up", () => {
		expect(outcome([]).warnings).toEqual([]);
		expect(outcome([raise]).warnings).toEqual([]);
	});

	it("says when Free to Spend goes negative and the Cushion runs out, and which change did it", () => {
		// From November: $5,100 − $1,400 − $4,400 = −$700 a month, eating a $4,200 Cushion by May.
		const { warnings } = outcome([raise, groceries]);
		expect(warnings).toEqual([
			{
				kind: "free-to-spend-negative",
				text: "Free to Spend goes negative in Nov 2026",
				month: "2026-11",
				goalId: null,
				lever: 1,
			},
			{
				kind: "cushion-negative",
				text: "The Cushion dips below zero from May 2027",
				month: "2027-05",
				goalId: null,
				lever: 1,
			},
		]);
	});

	it("blames a one-off that empties the Cushion, though Free to Spend holds", () => {
		const roof: Lever = {
			kind: "one-off",
			oneOffId: "roof",
			name: "New roof",
			amount: 300_000,
			flow: "expense",
			fromMonth: "2026-10",
		};
		// $2,000 + $2,000 − $3,000 at the end of October: fine. $6,000 is not.
		expect(outcome([raise, roof]).warnings).toEqual([]);
		const { warnings } = outcome([raise, { ...roof, amount: 600_000 }]);
		expect(warnings).toEqual([
			expect.objectContaining({
				kind: "cushion-negative",
				text: "The Cushion dips below zero from Oct 2026",
				lever: 1,
			}),
		]);
	});

	it("names no change when the Plan does it too", () => {
		// Groceries at $4,000 in the Plan itself: −$1,200 every month.
		const { warnings } = outcome([], { plan: records(400_000) });
		expect(warnings.map((w) => [w.text, w.lever])).toEqual([
			["Free to Spend goes negative in Sep 2026, as in the Plan", null],
			["The Cushion dips below zero from Sep 2026, as in the Plan", null],
		]);
	});

	it("leaves a muted change out of the blame, as it's out of the projection", () => {
		expect(outcome([{ ...groceries, muted: true }]).warnings).toEqual([]);
	});

	it("says a Goal slips, and by how many months", () => {
		const later: Lever = {
			kind: "goal",
			goalId: "college",
			target: 1_200_000,
			targetDate: "2028-04-30",
			fromMonth: "2026-09",
		};
		const { plan, scenario, warnings } = outcome([raise, later], { count: 24, goals: [college] });
		expect(plan.goals[0]?.reachedIn).toBe("2027-08");
		expect(scenario.goals[0]?.reachedIn).toBe("2028-04");
		expect(warnings).toEqual([
			{
				kind: "goal-slips",
				text: "The College Goal slips 8 months, to Apr 2028",
				month: "2028-04",
				goalId: "college",
				lever: 1,
			},
		]);
		// Out of sight of a year's projection, it's no longer reached at all.
		expect(outcome([later], { count: 12, goals: [college] }).warnings).toEqual([
			expect.objectContaining({
				kind: "goal-missed",
				text: "The College Goal is no longer reached by Aug 2027",
				lever: 0,
			}),
		]);
	});

	it("doesn't warn about a Goal reached sooner", () => {
		const sooner: Lever = {
			kind: "goal",
			goalId: "college",
			target: 1_200_000,
			targetDate: "2027-06-30",
			fromMonth: "2026-09",
		};
		expect(outcome([sooner], { count: 24, goals: [college] }).warnings).toEqual([]);
	});
});

describe("monthBreakdown", () => {
	const endDaycare: Lever = {
		kind: "end-commitment",
		commitmentId: "daycare",
		fromMonth: "2026-12",
	};
	const bonus: Lever = {
		kind: "one-off",
		oneOffId: "bonus",
		name: "Bonus",
		amount: 200_000,
		flow: "income",
		fromMonth: "2027-01",
	};

	it("lists the changes in play in a month and what each does to it", () => {
		const { plan, scenario, impacts } = outcome([endDaycare, bonus]);
		const levers = [endDaycare, bonus];
		const january = monthBreakdown({ plan, scenario, levers, impacts, index: 4 });
		expect(january).toMatchObject({
			month: "2027-01",
			plan: { commitments: 140_000, freeToSpend: 200_000, oneOffs: 0 },
			scenario: { commitments: 0, freeToSpend: 340_000, oneOffs: 200_000 },
			changes: [
				{ lever: 0, freeToSpend: 140_000, oneOffs: 0 },
				{ lever: 1, freeToSpend: 0, oneOffs: 200_000 },
			],
		});
		// Before either: nothing changed.
		expect(monthBreakdown({ plan, scenario, levers, impacts, index: 1 })?.changes).toEqual([]);
		// Past the months projected: nothing to say.
		expect(monthBreakdown({ plan, scenario, levers, impacts, index: 12 })).toBeNull();
	});

	it("leaves muted changes out", () => {
		const levers = [{ ...endDaycare, muted: true }];
		const { plan, scenario, impacts } = outcome(levers);
		expect(monthBreakdown({ plan, scenario, levers, impacts, index: 4 })?.changes).toEqual([]);
	});
});

describe("leverHoldsIn", () => {
	it("holds a one-off in its month only, and a new Commitment for its term", () => {
		const roof: Lever = {
			kind: "one-off",
			oneOffId: "roof",
			name: "Roof",
			amount: 1,
			flow: "expense",
			fromMonth: "2027-05",
		};
		expect(leverHoldsIn(roof, "2027-05")).toBe(true);
		expect(leverHoldsIn(roof, "2027-06")).toBe(false);
		const car: Lever = {
			kind: "add-commitment",
			commitmentId: "car",
			name: "Car",
			amount: 50_000,
			cadence: "monthly",
			dueDay: 1,
			months: 3,
			fromMonth: "2027-01",
		};
		expect(
			(["2026-12", "2027-01", "2027-03", "2027-04"] as const).map((m) => leverHoldsIn(car, m)),
		).toEqual([false, true, true, false]);
		expect(leverHoldsIn(groceries, "2030-01")).toBe(true);
	});
});

describe("projectionAssumptions", () => {
	it("states the model plainly, with growth when it's on", () => {
		expect(projectionAssumptions([], 0)).toEqual([
			"Spending is assumed to equal allowances.",
			"Dated Goals are funded what they need each month; undated ones aren’t.",
			"No interest or investment returns.",
			"No raises or inflation.",
			"The Cushion starts at $0.",
		]);
		const growth: Lever = { kind: "growth", incomePct: 3, costsPct: 2.5, fromMonth: "2027-01" };
		expect(projectionAssumptions([growth], 1_250_000)).toContain(
			"Income grows 3% and costs 2.5% a year from Jan 2027.",
		);
		expect(projectionAssumptions([growth], 1_250_000)).toContain("The Cushion starts at $12,500.");
		expect(projectionAssumptions([{ ...growth, muted: true }], 0)).toContain(
			"No raises or inflation.",
		);
	});
});
