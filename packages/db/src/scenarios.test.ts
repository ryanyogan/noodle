import { type Lever, type MonthKey, planAhead, planForMonth, project } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBucket,
	addCommitment,
	addGoal,
	addPersonalAllowance,
	applyLevers,
	createHouseholdForParent,
	type Db,
	deleteScenario,
	LeverNotApplicable,
	loadGoals,
	loadPlanRecords,
	loadScenarios,
	saveScenario,
	setAllowance,
	setBaseline,
	updateCommitment,
} from "./index";
import { scenarios } from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const parentId = "parent";
const month: MonthKey = "2026-09";

let db: Db;

beforeEach(async () => {
	db = testDb();
	for (const [id, parent, clerk] of [
		[householdId, parentId, "clerk-user"],
		["other-household", "other-parent", "other-clerk-user"],
	] as const) {
		await createHouseholdForParent(db, {
			clerkUserId: clerk,
			householdId: id,
			householdName: id,
			timeZone: "America/Chicago",
			parentId: parent,
			parentName: parent,
		});
	}
	await setBaseline(db, { householdId, month, amountCents: 900_000 });
	await addBucket(db, {
		householdId,
		bucketId: "groceries",
		name: "Groceries",
		color: 1,
		month,
		allowanceCents: 120_000,
	});
	await addCommitment(db, {
		householdId,
		commitmentId: "streaming",
		name: "Streaming",
		month,
		amountCents: 2_000,
		cadence: "monthly",
		dueDate: "2026-09-10",
	});
	await addAccount(db, {
		householdId,
		accountId: "savings",
		name: "Savings",
		kind: "savings",
		balanceCents: 100_000,
		balanceId: "balance-savings",
		createdByMemberId: parentId,
	});
	await addGoal(db, {
		householdId,
		goalId: "car",
		accountId: "savings",
		name: "Car",
		targetCents: 1_200_000,
		targetDate: "2027-08-31",
		fromMonth: month,
		claimId: "claim-car",
		claimCents: 0,
		createdByMemberId: parentId,
	});
});

const save = (scenarioId: string, name: string, household = householdId) =>
	saveScenario(db, {
		householdId: household,
		memberId: parentId,
		scenarioId,
		name,
		levers: [{ kind: "allowance", bucketId: "groceries", amount: 100_000, fromMonth: month }],
	});

describe("Scenarios", () => {
	it("saves a Scenario with its Levers, and saving it again renames it and replaces them", async () => {
		await save("s1", "Tighter groceries");
		await saveScenario(db, {
			householdId,
			memberId: parentId,
			scenarioId: "s1",
			name: "No streaming",
			levers: [{ kind: "end-commitment", commitmentId: "streaming", fromMonth: "2026-10" }],
		});
		const [scenario, ...rest] = await loadScenarios(db, householdId, month);
		expect(rest).toEqual([]);
		expect(scenario).toMatchObject({
			id: "s1",
			name: "No streaming",
			levers: [{ kind: "end-commitment", commitmentId: "streaming", fromMonth: "2026-10" }],
		});
	});

	it("keeps each Household's Scenarios to itself", async () => {
		await save("s1", "Ours");
		// Another Household can neither overwrite it nor delete it.
		await save("s1", "Theirs", "other-household");
		await deleteScenario(db, { householdId: "other-household", scenarioId: "s1" });
		expect((await loadScenarios(db, householdId, month)).map((s) => s.name)).toEqual(["Ours"]);
		expect(await loadScenarios(db, "other-household", month)).toEqual([]);
	});

	it("deletes a Scenario", async () => {
		await save("s1", "Ours");
		await deleteScenario(db, { householdId, scenarioId: "s1" });
		expect(await loadScenarios(db, householdId, month)).toEqual([]);
	});
});

describe("applyLevers: a Scenario becomes the real Plan", () => {
	it("sets allowances, ends Commitments and moves Goals from this month on, all at once", async () => {
		await applyLevers(db, {
			householdId,
			memberId: parentId,
			month: "2026-10",
			levers: [
				{ kind: "allowance", bucketId: "groceries", amount: 90_000 },
				// A month already past ends from this month instead.
				{ kind: "end-commitment", commitmentId: "streaming", fromMonth: "2026-09" },
				{ kind: "goal", goalId: "car", target: 1_500_000, targetDate: "2028-08-31" },
			],
		});
		const records = await loadPlanRecords(db, householdId, "2026-12");
		const september = planForMonth(records, "2026-09");
		const october = planForMonth(records, "2026-10");
		expect(september.buckets[0]?.allowance).toBe(120_000);
		expect(september.commitments.map((c) => c.id)).toEqual(["streaming"]);
		expect(october.buckets[0]?.allowance).toBe(90_000);
		expect(october.commitments).toEqual([]);
		const { goals } = await loadGoals(db, { householdId, memberId: parentId });
		expect(goals[0]).toMatchObject({ target: 1_500_000, targetDate: "2028-08-31" });
	});

	it("adds a new Commitment from its month for its term, once however often it's applied", async () => {
		const loan = {
			kind: "add-commitment",
			commitmentId: "car-loan",
			name: "Car loan",
			amount: 59_404,
			fromMonth: "2026-11",
			months: 3,
		} as const;
		const home = {
			kind: "add-commitment",
			commitmentId: "home",
			name: "Home",
			amount: 253_929,
			// A month already past starts from this month instead.
			fromMonth: "2026-08",
			months: null,
		} as const;
		for (let i = 0; i < 2; i++) {
			await applyLevers(db, { householdId, memberId: parentId, month, levers: [loan, home] });
		}
		const records = await loadPlanRecords(db, householdId, "2027-03");
		const ids = (m: MonthKey) =>
			planForMonth(records, m)
				.commitments.map((c) => c.id)
				.sort();
		expect(ids(month)).toEqual(["home", "streaming"]);
		expect(ids("2026-11")).toEqual(["car-loan", "home", "streaming"]);
		expect(ids("2027-01")).toEqual(["car-loan", "home", "streaming"]);
		expect(ids("2027-02")).toEqual(["home", "streaming"]);
		expect(planForMonth(records, "2026-11").commitments).toContainEqual(
			expect.objectContaining({
				id: "car-loan",
				name: "Car loan",
				amount: 59_404,
				cadence: "monthly",
				dueDate: "2026-11-01",
			}),
		);
	});

	it("changes nothing of another Household's Commitment with the same ID", async () => {
		const before = planForMonth(await loadPlanRecords(db, householdId, "2026-12"), "2026-12");
		await applyLevers(db, {
			householdId: "other-household",
			memberId: "other-parent",
			month,
			levers: [
				{
					kind: "add-commitment",
					commitmentId: "streaming",
					name: "Sneaky",
					amount: 1,
					fromMonth: "2026-12",
					months: null,
				},
			],
		});
		const after = planForMonth(await loadPlanRecords(db, householdId, "2026-12"), "2026-12");
		expect(after.commitments).toEqual(before.commitments);
	});

	it("keeps a later month's allowance set on its own", async () => {
		await setAllowance(db, {
			householdId,
			memberId: parentId,
			bucketId: "groceries",
			month: "2026-12",
			amountCents: 200_000,
		});
		await applyLevers(db, {
			householdId,
			memberId: parentId,
			month,
			levers: [{ kind: "allowance", bucketId: "groceries", amount: 90_000 }],
		});
		const records = await loadPlanRecords(db, householdId, "2026-12");
		expect(planForMonth(records, "2026-11").buckets[0]?.allowance).toBe(90_000);
		expect(planForMonth(records, "2026-12").buckets[0]?.allowance).toBe(200_000);
	});

	it("changes nothing of another Household's, nor the other Parent's Personal Allowance", async () => {
		await addPersonalAllowance(db, {
			householdId,
			memberId: parentId,
			bucketId: "theirs",
			name: "Mine",
			color: 2,
			month,
			allowanceCents: 30_000,
		});
		await applyLevers(db, {
			householdId: "other-household",
			memberId: "other-parent",
			month,
			levers: [
				{ kind: "allowance", bucketId: "groceries", amount: 1 },
				{ kind: "end-commitment", commitmentId: "streaming", fromMonth: month },
				{ kind: "goal", goalId: "car", target: 1, targetDate: null },
			],
		});
		// The other Parent's Scenario can't set this Parent's Personal Allowance.
		await applyLevers(db, {
			householdId,
			memberId: "second-parent",
			month,
			levers: [{ kind: "allowance", bucketId: "theirs", amount: 1 }],
		});
		const plan = planForMonth(await loadPlanRecords(db, householdId, month), month);
		expect(plan.buckets.map((b) => b.allowance)).toEqual([120_000, 30_000]);
		expect(plan.commitments).toHaveLength(1);
		const { goals } = await loadGoals(db, { householdId, memberId: parentId });
		expect(goals[0]).toMatchObject({ target: 1_200_000, targetDate: "2027-08-31" });
	});

	it("does nothing without Levers", async () => {
		await applyLevers(db, { householdId, memberId: parentId, month, levers: [] });
	});
});

describe("Scenarios as versioned JSON", () => {
	it("saves v2 Levers as { version: 2, levers }", async () => {
		await save("s1", "Ours");
		const [row] = await db.select({ levers: scenarios.levers }).from(scenarios);
		expect(row?.levers).toEqual({
			version: 2,
			levers: [{ kind: "allowance", bucketId: "groceries", amount: 100_000, fromMonth: month }],
		});
	});

	it("loads a v1 Scenario upgraded, its allowance from the current month", async () => {
		await db.insert(scenarios).values({
			id: "old",
			householdId,
			name: "Old",
			levers: [
				{ kind: "allowance", bucketId: "groceries", amount: 90_000 },
				{
					kind: "add-commitment",
					commitmentId: "car",
					name: "Car",
					amount: 1,
					fromMonth: "2026-10",
					months: 3,
				},
			],
		});
		const [scenario] = await loadScenarios(db, householdId, "2026-11");
		expect(scenario?.levers).toEqual([
			{ kind: "allowance", bucketId: "groceries", amount: 90_000, fromMonth: "2026-11" },
			{
				kind: "add-commitment",
				commitmentId: "car",
				name: "Car",
				amount: 1,
				fromMonth: "2026-10",
				months: 3,
				cadence: "monthly",
				dueDay: 1,
			},
		]);
	});
});

describe("applyLevers: v2 Levers", () => {
	const apply = (levers: Lever[], at: MonthKey = month) =>
		applyLevers(db, { householdId, memberId: parentId, month: at, levers });
	const planIn = async (m: MonthKey) =>
		planForMonth(await loadPlanRecords(db, householdId, "2028-12"), m);

	it("changes the Baseline for a range, writing the Plan's back at its end", async () => {
		await apply([
			{ kind: "baseline", amount: 600_000, fromMonth: "2026-10", untilMonth: "2027-01" },
		]);
		expect((await planIn("2026-09")).baseline).toBe(900_000);
		expect((await planIn("2026-12")).baseline).toBe(600_000);
		expect((await planIn("2027-01")).baseline).toBe(900_000);
	});

	it("changes an allowance for a range, leaving a later month's own value", async () => {
		await setAllowance(db, {
			householdId,
			memberId: parentId,
			bucketId: "groceries",
			month: "2027-02",
			amountCents: 200_000,
		});
		const lever: Lever = {
			kind: "allowance",
			bucketId: "groceries",
			amount: 150_000,
			fromMonth: "2026-10",
			untilMonth: "2026-12",
		};
		// Idempotent: applying again changes nothing.
		await apply([lever]);
		await apply([lever]);
		const allowance = async (m: MonthKey) => (await planIn(m)).buckets[0]?.allowance;
		expect(await allowance("2026-09")).toBe(120_000);
		expect(await allowance("2026-11")).toBe(150_000);
		expect(await allowance("2026-12")).toBe(120_000);
		expect(await allowance("2027-02")).toBe(200_000);
	});

	it("changes a Commitment's terms for a range, from the terms in force", async () => {
		const lever: Lever = {
			kind: "commitment-terms",
			commitmentId: "streaming",
			amount: 1_500,
			cadence: "biweekly",
			fromMonth: "2026-10",
			untilMonth: "2027-01",
		};
		await apply([lever]);
		await apply([lever]);
		const streaming = async (m: MonthKey) => (await planIn(m)).commitments[0];
		expect(await streaming("2026-09")).toMatchObject({ amount: 2_000, cadence: "monthly" });
		expect(await streaming("2026-11")).toMatchObject({
			amount: 1_500,
			cadence: "biweekly",
			dueDate: "2026-10-10",
		});
		expect(await streaming("2027-01")).toMatchObject({
			amount: 2_000,
			cadence: "monthly",
			dueDate: "2026-09-10",
		});
	});

	it("adds a biweekly Commitment on its due day, and ends one from its month", async () => {
		await apply([
			{
				kind: "add-commitment",
				commitmentId: "daycare",
				name: "Daycare",
				amount: 50_000,
				cadence: "biweekly",
				dueDay: 2,
				fromMonth: "2026-10",
				months: 24,
				untilMonth: "2027-06",
			},
			{ kind: "end-commitment", commitmentId: "streaming", fromMonth: "2027-01" },
		]);
		expect((await planIn("2026-10")).commitments).toContainEqual(
			expect.objectContaining({ id: "daycare", cadence: "biweekly", dueDate: "2026-10-02" }),
		);
		expect((await planIn("2027-05")).commitments.map((c) => c.id)).toEqual(["daycare"]);
		expect((await planIn("2027-06")).commitments).toEqual([]);
	});

	it("adds a Bucket for a range, Rolling, and archives one from its month", async () => {
		await apply([
			{
				kind: "add-bucket",
				bucketId: "swim",
				name: "Swim",
				amount: 30_000,
				rolling: true,
				fromMonth: "2026-10",
				untilMonth: "2027-06",
			},
			{ kind: "archive-bucket", bucketId: "groceries", fromMonth: "2026-11" },
		]);
		expect((await planIn("2026-10")).buckets).toEqual([
			expect.objectContaining({ id: "groceries", allowance: 120_000 }),
			expect.objectContaining({ id: "swim", allowance: 30_000, rolling: true, color: 2 }),
		]);
		expect((await planIn("2026-11")).buckets.map((b) => b.id)).toEqual(["swim"]);
		expect((await planIn("2027-06")).buckets).toEqual([]);
	});

	it("adds a Goal in the Account it names", async () => {
		await apply([
			{
				kind: "add-goal",
				goalId: "trip",
				name: "Trip",
				target: 300_000,
				targetDate: "2027-06-30",
				fromMonth: month,
				accountId: "savings",
			},
		]);
		const { goals } = await loadGoals(db, { householdId, memberId: parentId });
		expect(goals.map((g) => g.name).sort()).toEqual(["Car", "Trip"]);
	});

	it("refuses the lot if any Lever can't be applied, writing nothing", async () => {
		await expect(
			apply([
				{ kind: "baseline", amount: 1, fromMonth: month },
				{
					kind: "one-off",
					oneOffId: "roof",
					name: "Roof",
					amount: 300_000,
					flow: "expense",
					fromMonth: "2026-11",
				},
			]),
		).rejects.toBeInstanceOf(LeverNotApplicable);
		await expect(
			apply([{ kind: "growth", incomePct: 3, costsPct: 2, fromMonth: month }]),
		).rejects.toThrow(/assumption/);
		expect((await planIn(month)).baseline).toBe(900_000);
	});

	it("skips a Lever whose range is over", async () => {
		await apply(
			[{ kind: "baseline", amount: 1, fromMonth: "2026-09", untilMonth: "2026-10" }],
			"2026-11",
		);
		expect((await planIn("2026-11")).baseline).toBe(900_000);
	});

	it("doesn't change a Commitment's terms someone else changed in between", async () => {
		// Terms set for November after the Scenario was made: a December change starts from them.
		await updateCommitment(db, {
			householdId,
			commitmentId: "streaming",
			name: "Streaming",
			month: "2026-11",
			amountCents: 2_500,
			cadence: "monthly",
			dueDate: "2026-11-10",
		});
		await apply([
			{
				kind: "commitment-terms",
				commitmentId: "streaming",
				cadence: "annual",
				fromMonth: "2026-12",
			},
		]);
		expect((await planIn("2026-12")).commitments[0]).toMatchObject({
			amount: 2_500,
			cadence: "annual",
			dueDate: "2026-12-10",
		});
	});

	it("comes out as the Scenario projected it", async () => {
		const levers: Lever[] = [
			{ kind: "baseline", amount: 950_000, fromMonth: "2026-11", untilMonth: "2027-05" },
			{ kind: "allowance", bucketId: "groceries", amount: 90_000, fromMonth: "2026-10" },
			{
				kind: "commitment-terms",
				commitmentId: "streaming",
				amount: 700,
				cadence: "biweekly",
				dueDay: 4,
				fromMonth: "2027-01",
				untilMonth: "2027-09",
			},
			{
				kind: "add-commitment",
				commitmentId: "insurance",
				name: "Insurance",
				amount: 120_000,
				cadence: "annual",
				dueDay: 15,
				fromMonth: "2026-12",
				months: null,
			},
			{ kind: "add-bucket", bucketId: "swim", name: "Swim", amount: 30_000, fromMonth: "2027-02" },
			{ kind: "archive-bucket", bucketId: "groceries", fromMonth: "2027-10" },
		];
		const outcome = (p: ReturnType<typeof project>) =>
			p.months.map(({ baseline, commitments, allowances }) => ({
				baseline,
				commitments,
				allowances,
			}));
		const before = await loadPlanRecords(db, householdId, "2028-08");
		const scenario = project(planAhead(before, [], month, 24), levers);
		await apply(levers);
		const after = project(
			planAhead(await loadPlanRecords(db, householdId, "2028-08"), [], month, 24),
		);
		expect(outcome(after)).toEqual(outcome(scenario));
	});
});
