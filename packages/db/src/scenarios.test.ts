import { type MonthKey, planForMonth } from "@noodle/domain";
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
	loadGoals,
	loadPlanRecords,
	loadScenarios,
	saveScenario,
	setAllowance,
	setBaseline,
} from "./index";
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
		levers: [{ kind: "allowance", bucketId: "groceries", amount: 100_000 }],
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
		const [scenario, ...rest] = await loadScenarios(db, householdId);
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
		expect((await loadScenarios(db, householdId)).map((s) => s.name)).toEqual(["Ours"]);
		expect(await loadScenarios(db, "other-household")).toEqual([]);
	});

	it("deletes a Scenario", async () => {
		await save("s1", "Ours");
		await deleteScenario(db, { householdId, scenarioId: "s1" });
		expect(await loadScenarios(db, householdId)).toEqual([]);
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
