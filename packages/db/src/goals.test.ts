import {
	accountBalance,
	type DayKey,
	type MonthKey,
	monthState,
	planForMonth,
	setAsideOf,
	splitAccount,
} from "@noodle/domain";
import { type SQL, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { setAsideSql } from "./goals";
import {
	addAccount,
	addBucket,
	addGoal,
	addPayoffGoal,
	addQuickAdd,
	archiveGoal,
	claimForGoal,
	completeGoal,
	createHouseholdForParent,
	type Db,
	deleteTransaction,
	fundGoal,
	loadGoalFunding,
	loadGoals,
	loadMoves,
	loadPlanRecords,
	loadSpending,
	loadTransactionsPage,
	owedNow,
	restartPayoffGoal,
	setEmergencyGoal,
	setTakeHomePay,
	spendGoal,
	splitTransaction,
	undoGoalFunding,
	updateAccountBalance,
	updateGoal,
	updateTransaction,
} from "./index";
import { bucketLeftSql, freeToSpendSql } from "./moves";
import { testDb } from "./test-db";

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const month: MonthKey = "2026-09";

let db: Db;

async function seed(db: Db) {
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
	// Free to Spend: $9,000 take-home pay − $1,200 Groceries.
	await setTakeHomePay(db, { householdId, memberId: parentId, month, amountCents: 900_000 });
	await addBucket(db, {
		householdId,
		memberId: parentId,
		bucketId: "groceries",
		name: "Groceries",
		color: 1,
		month,
		allowanceCents: 120_000,
	});
	for (const [accountId, kind, balanceCents] of [
		["savings", "savings", 1_000_000],
		["checking", "checking", null],
		["visa", "credit-card", 50_000],
	] as const) {
		await addAccount(db, {
			householdId,
			accountId,
			name: accountId,
			kind,
			balanceCents,
			balanceId: `balance-${accountId}`,
			createdByMemberId: parentId,
		});
	}
	await addAccount(db, {
		householdId: "other-household",
		accountId: "other-savings",
		name: "Theirs",
		kind: "savings",
		balanceCents: 500_000,
		balanceId: "balance-other-savings",
		createdByMemberId: "other-parent",
	});
}

const goal = (goalId: string, claimCents = 0, accountId = "savings") =>
	addGoal(db, {
		householdId,
		goalId,
		accountId,
		name: goalId,
		targetCents: 600_000,
		targetDate: "2027-06-15",
		fromMonth: month,
		claimId: `claim-${goalId}`,
		claimCents,
		createdByMemberId: parentId,
	});

const fund = (moveId: string, goalId: string, amountCents: number, household = householdId) =>
	fundGoal(db, {
		householdId: household,
		moveId,
		goalId,
		month,
		amountCents,
		createdByMemberId: parentId,
	});

const spend = (
	transactionId: string,
	goalId: string,
	amountCents: number,
	household = householdId,
) =>
	spendGoal(db, {
		householdId: household,
		transactionId,
		goalId,
		date: "2026-09-20",
		amountCents,
		note: "Deposit",
		createdByMemberId: parentId,
	});

const claim = (claimId: string, goalId: string, amountCents: number) =>
	claimForGoal(db, {
		householdId,
		claimId,
		goalId,
		month,
		amountCents,
		createdByMemberId: parentId,
	});

const evaluate = async (expression: SQL) =>
	(await db.values<[number | null]>(sql`select ${expression}`))[0]?.[0];

/** A Goal's set-aside money as the app computes it, from the same rows. */
const setAside = async (goalId: string) =>
	setAsideOf(goalId, (await loadGoals(db, viewer)).changes);

beforeEach(async () => {
	db = testDb();
	await seed(db);
});

describe("Accounts", () => {
	it("adds an Account with its balance, once", async () => {
		await addAccount(db, {
			householdId,
			accountId: "savings",
			name: "Renamed on retry",
			kind: "checking",
			balanceCents: 1,
			balanceId: "balance-savings",
			createdByMemberId: parentId,
		});
		const { accounts } = await loadGoals(db, viewer);
		expect(
			accounts
				.map(({ id, name, kind, latestBalance }) => [id, name, kind, latestBalance?.amount])
				.sort(),
		).toEqual([
			["checking", "checking", "checking", undefined],
			["savings", "savings", "savings", 1_000_000],
			["visa", "visa", "credit-card", 50_000],
		]);
	});

	it("takes the latest balance entered", async () => {
		const update = (balanceId: string, amountCents: number, accountId = "savings") =>
			updateAccountBalance(db, {
				householdId,
				balanceId,
				accountId,
				amountCents,
				createdByMemberId: parentId,
			});
		// IDs are ULIDs, so later ones sort after: they settle balances entered the same instant.
		expect(await update("balance-savings-2", 1_100_000)).toMatchObject({ ok: true });
		expect(await update("balance-savings-3", 1_050_000)).toMatchObject({ ok: true });
		expect(await update("balance-savings-3", 1_050_000)).toMatchObject({ ok: true });
		expect(await update("balance-savings-4", 1, "other-savings")).toEqual({
			ok: false,
			reason: "refused",
		});
		const { accounts } = await loadGoals(db, viewer);
		expect(accounts.find((a) => a.id === "savings")?.latestBalance?.amount).toBe(1_050_000);
		const theirs = await loadGoals(db, {
			householdId: "other-household",
			memberId: "other-parent",
		});
		expect(theirs.accounts[0]?.latestBalance?.amount).toBe(500_000);
	});
});

describe("addGoal", () => {
	it("adds a Goal with what's already set aside for it, once", async () => {
		expect(await goal("braces", 300_000)).toMatchObject({ ok: true });
		expect(await goal("braces", 300_000)).toMatchObject({ ok: true });
		const { goals, changes } = await loadGoals(db, viewer);
		expect(goals).toEqual([
			{
				id: "braces",
				kind: "save",
				accountId: "savings",
				name: "braces",
				target: 600_000,
				targetDate: "2027-06-15",
				fromMonth: month,
				completed: false,
				completedAt: null,
				archived: false,
			},
		]);
		expect(changes).toEqual([
			{ id: "claim-braces", goalId: "braces", kind: "claim", amount: 300_000, month },
		]);
	});

	it("claims nothing when nothing is set aside", async () => {
		await goal("vacation");
		expect((await loadGoals(db, viewer)).changes).toEqual([]);
	});

	it("refuses an Account that isn't the Household's or doesn't hold money", async () => {
		expect(await goal("owed", 1_000, "visa")).toEqual({ ok: false, reason: "refused" });
		expect(await goal("theirs", 1_000, "other-savings")).toEqual({ ok: false, reason: "refused" });
		expect(await goal("missing", 1_000, "missing")).toEqual({ ok: false, reason: "refused" });
		expect(await loadGoals(db, viewer)).toMatchObject({ goals: [], changes: [] });
	});

	it("is edited, completed, and archived by the Household only", async () => {
		await goal("braces");
		await updateGoal(db, {
			householdId: "other-household",
			memberId: parentId,
			month: "2026-09",
			goalId: "braces",
			name: "Taken",
			targetCents: 1,
			targetDate: null,
		});
		await updateGoal(db, {
			householdId,
			memberId: parentId,
			month: "2026-09",
			goalId: "braces",
			name: "Braces",
			targetCents: 650_000,
			targetDate: null,
		});
		await completeGoal(db, { householdId, goalId: "braces" });
		await archiveGoal(db, { householdId: "other-household", goalId: "braces" });
		expect((await loadGoals(db, viewer)).goals[0]).toMatchObject({
			name: "Braces",
			target: 650_000,
			targetDate: null,
			completed: true,
			completedAt: expect.any(Number),
			archived: false,
		});
	});
});

describe("claimForGoal", () => {
	beforeEach(async () => {
		await goal("braces", 300_000);
	});

	it("sets not set aside money aside, and releases no more than what's set aside", async () => {
		expect(await claim("c1", "braces", 50_000)).toMatchObject({ ok: true });
		expect(await claim("c2", "braces", -350_001)).toEqual({ ok: false, reason: "refused" });
		expect(await claim("c3", "braces", -350_000)).toMatchObject({ ok: true });
		expect(await setAside("braces")).toBe(0);
	});

	it("refuses an archived Goal", async () => {
		await archiveGoal(db, { householdId, goalId: "braces" });
		expect(await claim("c1", "braces", 50_000)).toEqual({ ok: false, reason: "refused" });
	});
});

describe("fundGoal", () => {
	beforeEach(async () => {
		await goal("braces");
	});

	it("Moves money from Free to Spend into what's set aside, apart from Bucket Moves", async () => {
		expect(await fund("m1", "braces", 25_000)).toMatchObject({ ok: true });
		expect(await fund("m1", "braces", 25_000)).toMatchObject({ ok: true });
		expect(await setAside("braces")).toBe(25_000);
		expect(await loadGoalFunding(db, householdId, month)).toEqual([
			{ id: "m1", goalId: "braces", amount: 25_000, month },
		]);
		expect(await loadGoalFunding(db, householdId, "2026-10")).toEqual([]);
		expect(await loadMoves(db, householdId, month)).toEqual([]);
		const state = monthState({
			plan: planForMonth(await loadPlanRecords(db, householdId, month), month),
			spending: [],
			goalFunding: await loadGoalFunding(db, householdId, month),
			asOf: "2026-09-15",
		});
		expect(state.freeToSpend).toBe(780_000 - 25_000);
		expect(await evaluate(freeToSpendSql(householdId, month))).toBe(state.freeToSpend);
	});

	it("refuses more than Free to Spend has left", async () => {
		expect(await fund("m1", "braces", 780_001)).toEqual({ ok: false, reason: "refused" });
		expect(await fund("m2", "braces", 700_000)).toMatchObject({ ok: true });
		expect(await fund("m3", "braces", 80_001)).toEqual({ ok: false, reason: "refused" });
		expect(await fund("m4", "braces", 80_000)).toMatchObject({ ok: true });
	});

	it("refuses a Goal that isn't the Household's or isn't active", async () => {
		await goal("done");
		await completeGoal(db, { householdId, goalId: "done" });
		await goal("dropped");
		await archiveGoal(db, { householdId, goalId: "dropped" });
		expect(await fund("m1", "done", 100)).toEqual({ ok: false, reason: "refused" });
		expect(await fund("m2", "dropped", 100)).toEqual({ ok: false, reason: "refused" });
		expect(await fund("m3", "braces", 100, "other-household")).toEqual({
			ok: false,
			reason: "refused",
		});
		expect(await loadGoalFunding(db, householdId, month)).toEqual([]);
	});
});

describe("undoGoalFunding", () => {
	beforeEach(async () => {
		await goal("braces");
		await fund("m1", "braces", 25_000);
	});

	it("returns the money to Free to Spend, once", async () => {
		expect(await undoGoalFunding(db, { householdId, moveId: "m1", month })).toMatchObject({
			ok: true,
		});
		expect(await undoGoalFunding(db, { householdId, moveId: "m1", month })).toMatchObject({
			ok: true,
		});
		expect(await loadGoalFunding(db, householdId, month)).toEqual([]);
		expect(await evaluate(freeToSpendSql(householdId, month))).toBe(780_000);
	});

	it("refuses once the Goal has spent some of it", async () => {
		await spend("t1", "braces", 5_000);
		expect(await undoGoalFunding(db, { householdId, moveId: "m1", month })).toEqual({
			ok: false,
			reason: "refused",
		});
		// Another Goal's set-aside money doesn't make up for it.
		await goal("vacation", 100_000);
		expect(await undoGoalFunding(db, { householdId, moveId: "m1", month })).toEqual({
			ok: false,
			reason: "refused",
		});
		await claim("c1", "braces", 5_000);
		expect(await undoGoalFunding(db, { householdId, moveId: "m1", month })).toMatchObject({
			ok: true,
		});
	});

	it("leaves other Households' Goal funding alone", async () => {
		await undoGoalFunding(db, { householdId: "other-household", moveId: "m1", month });
		expect(await loadGoalFunding(db, householdId, month)).toHaveLength(1);
	});
});

describe("spendGoal", () => {
	beforeEach(async () => {
		await goal("braces", 300_000);
	});

	it("comes out of what's set aside and the Goal's Account, never a Bucket or Free to Spend", async () => {
		const before = {
			free: await evaluate(freeToSpendSql(householdId, month)),
			groceries: await evaluate(bucketLeftSql(householdId, "groceries", month)),
		};
		expect(await spend("t1", "braces", 120_000)).toMatchObject({ ok: true });
		expect(await spend("t1", "braces", 120_000)).toMatchObject({ ok: true });
		expect(await evaluate(freeToSpendSql(householdId, month))).toBe(before.free);
		expect(await evaluate(bucketLeftSql(householdId, "groceries", month))).toBe(before.groceries);
		expect(await loadSpending(db, viewer, month)).toEqual([]);

		const records = await loadGoals(db, viewer);
		expect(records.changes.at(-1)).toEqual({
			id: "t1",
			goalId: "braces",
			kind: "spending",
			amount: -120_000,
			month,
			date: "2026-09-20",
			note: "Deposit",
		});
		const savings = records.accounts.find((a) => a.id === "savings");
		const balance = accountBalance(
			savings?.latestBalance ?? null,
			records.withdrawals.filter((w) => w.accountId === "savings"),
		);
		expect(balance).toBe(880_000);
		expect(splitAccount({ balance, goals: records.goals, changes: records.changes })).toMatchObject(
			{ earmarked: 180_000, unclaimed: 700_000 },
		);
	});

	it("refuses more than what's set aside", async () => {
		expect(await spend("t1", "braces", 300_001)).toEqual({ ok: false, reason: "refused" });
		expect(await spend("t2", "braces", 300_000)).toMatchObject({ ok: true });
		expect(await spend("t3", "braces", 1)).toEqual({ ok: false, reason: "refused" });
	});

	it("refuses a Goal that isn't the Household's or is archived", async () => {
		expect(await spend("t1", "braces", 100, "other-household")).toEqual({
			ok: false,
			reason: "refused",
		});
		await archiveGoal(db, { householdId, goalId: "braces" });
		expect(await spend("t2", "braces", 100)).toEqual({ ok: false, reason: "refused" });
	});

	it("still spends a completed Goal", async () => {
		await completeGoal(db, { householdId, goalId: "braces" });
		expect(await spend("t1", "braces", 100)).toMatchObject({ ok: true });
	});

	it("lists as the Goal's in the Transactions list, where it can't be edited or deleted", async () => {
		await spend("t1", "braces", 120_000);
		const list = async () =>
			(await loadTransactionsPage(db, viewer, { month, limit: 10 })).transactions;
		expect(await list()).toMatchObject([
			{ id: "t1", bucketId: null, commitmentId: null, goal: { id: "braces", name: "braces" } },
		]);

		const edit = await updateTransaction(db, {
			householdId,
			memberId: parentId,
			transactionId: "t1",
			amountCents: 100,
			assignment: { bucketId: "groceries" },
			note: null,
			forMemberIds: [],
		});
		expect(edit.ok).toBe(false);
		await deleteTransaction(db, { householdId, memberId: parentId, transactionId: "t1" });
		expect(await list()).toMatchObject([
			{ id: "t1", amountCents: 120_000, bucketId: null, goal: { id: "braces" } },
		]);
	});
});

describe("Splits assigned to a Goal", () => {
	beforeEach(async () => {
		await goal("braces", 30_000);
		// A $250 Costco trip, in Groceries until it's split.
		await addQuickAdd(db, {
			householdId,
			transactionId: "costco",
			bucketId: "groceries",
			date: "2026-09-12" as DayKey,
			amountCents: 25_000,
			note: "Costco",
			forMemberIds: [],
			createdByMemberId: parentId,
		});
	});

	const split = (goalCents: number, ids = ["food", "part"], goalId = "braces") =>
		splitTransaction(db, {
			householdId,
			memberId: parentId,
			transactionId: "costco",
			amountCents: 25_000,
			note: "Costco",
			splits: [
				{
					id: ids[0] as string,
					amountCents: 25_000 - goalCents,
					assignment: { bucketId: "groceries" },
					forMemberIds: [],
				},
				{
					id: ids[1] as string,
					amountCents: goalCents,
					assignment: { goalId },
					forMemberIds: [],
				},
			],
		});

	it("is Goal spending: out of what's set aside and the Goal's Account, never a Bucket or Free to Spend", async () => {
		const free = await evaluate(freeToSpendSql(householdId, month));
		expect(await split(10_000)).toMatchObject({ ok: true });
		expect(await split(10_000)).toMatchObject({ ok: true });

		expect(await loadSpending(db, viewer, month)).toMatchObject([
			{ bucketId: "groceries", amount: 15_000 },
		]);
		expect(await evaluate(freeToSpendSql(householdId, month))).toBe(free);
		expect(await setAside("braces")).toBe(20_000);
		expect(await evaluate(setAsideSql(householdId, "braces"))).toBe(20_000);

		const records = await loadGoals(db, viewer);
		expect(records.changes.at(-1)).toEqual({
			id: "part",
			goalId: "braces",
			kind: "spending",
			amount: -10_000,
			month,
			date: "2026-09-12",
			note: "Costco",
		});
		const savings = records.accounts.find((a) => a.id === "savings");
		expect(
			accountBalance(
				savings?.latestBalance ?? null,
				records.withdrawals.filter((w) => w.accountId === "savings"),
			),
		).toBe(990_000);

		const [row] = (await loadTransactionsPage(db, viewer, { month, limit: 10 })).transactions;
		expect(row?.goal).toBeNull();
		expect(row?.splits).toMatchObject([
			{ id: "food", bucketId: "groceries", goal: null },
			{ id: "part", bucketId: null, commitmentId: null, goal: { id: "braces", name: "braces" } },
		]);
	});

	it("refuses more than what's set aside, counting what the Transaction already takes from it", async () => {
		await spend("t0", "braces", 20_000);
		expect(await split(10_001)).toEqual({ ok: false, reason: "not-in-plan" });
		expect(await split(10_000)).toMatchObject({ ok: true });
		expect(await setAside("braces")).toBe(0);
		// Split again with new Splits: its own $100 is back in what's set aside while they replace it.
		expect(await split(10_000, ["food-2", "part-2"])).toMatchObject({ ok: true });
		expect(await split(10_001, ["food-3", "part-3"])).toEqual({ ok: false, reason: "not-in-plan" });
		expect(await setAside("braces")).toBe(0);
	});

	it("refuses an archived Goal or another Household's", async () => {
		await addGoal(db, {
			householdId: "other-household",
			goalId: "theirs",
			accountId: "other-savings",
			name: "Theirs",
			targetCents: 100_000,
			targetDate: null,
			fromMonth: month,
			claimId: "claim-theirs",
			claimCents: 50_000,
			createdByMemberId: "other-parent",
		});
		expect(await split(1_000, ["a", "b"], "theirs")).toEqual({ ok: false, reason: "not-in-plan" });
		await archiveGoal(db, { householdId, goalId: "braces" });
		expect(await split(1_000)).toEqual({ ok: false, reason: "not-in-plan" });
		expect(await loadSpending(db, viewer, month)).toMatchObject([
			{ bucketId: "groceries", amount: 25_000 },
		]);
	});
});

describe("what's set aside guard's SQL agrees with @noodle/domain", () => {
	it("for every Goal", async () => {
		await goal("braces", 300_000);
		await goal("vacation");
		await fund("m1", "braces", 25_000);
		await fund("m2", "vacation", 40_000);
		await spend("t1", "braces", 120_000);
		await claim("c1", "vacation", 15_000);
		await claim("c2", "braces", -5_000);
		// Spending in a Bucket counts against no Goal.
		await addQuickAdd(db, {
			householdId,
			transactionId: "t2",
			bucketId: "groceries",
			date: "2026-09-10" as DayKey,
			amountCents: 9_000,
			note: null,
			forMemberIds: [],
			createdByMemberId: parentId,
		});
		for (const [goalId, expected] of [
			["braces", 200_000],
			["vacation", 55_000],
			["missing", 0],
		] as const) {
			expect(await setAside(goalId)).toBe(expected);
			expect(await evaluate(setAsideSql(householdId, goalId))).toBe(expected);
			expect(await evaluate(setAsideSql("other-household", goalId))).toBe(0);
		}
	});
});

describe("payoff Goals (ADR-0019)", () => {
	const payoff = (goalId: string, targetCents = 50_000, accountId = "visa") =>
		addPayoffGoal(db, {
			householdId,
			goalId,
			accountId,
			name: `Pay off ${accountId}`,
			targetCents,
			targetDate: "2027-03-31",
			fromMonth: month,
			createdByMemberId: parentId,
		});
	const owe = (balanceId: string, amountCents: number, accountId = "visa") =>
		updateAccountBalance(db, {
			householdId,
			balanceId,
			accountId,
			amountCents,
			createdByMemberId: parentId,
		});

	it("adds one on a card with what's owed now as its target, once, and logs it", async () => {
		expect(await owedNow(db, { householdId, accountId: "visa" })).toBe(50_000);
		expect(await payoff("visa-goal")).toMatchObject({ ok: true });
		expect(await payoff("visa-goal")).toMatchObject({ ok: true });
		const { goals, owed } = await loadGoals(db, viewer);
		expect(goals).toEqual([
			expect.objectContaining({
				id: "visa-goal",
				kind: "payoff",
				accountId: "visa",
				target: 50_000,
			}),
		]);
		expect(owed).toEqual([{ accountId: "visa", amount: 50_000, at: expect.any(Number) }]);
		const logged = await db.all(sql`select kind from plan_changes where target_id = 'visa-goal'`);
		expect(logged).toEqual([["goal-add"]]);
	});

	it("refuses an Account that holds money, owes nothing, or owes something else now", async () => {
		expect(await payoff("savings-goal", 1_000_000, "savings")).toEqual({
			ok: false,
			reason: "refused",
		});
		expect(await payoff("stale", 40_000)).toEqual({ ok: false, reason: "refused" });
		await owe("paid", 0);
		expect(await payoff("zero", 0)).toEqual({ ok: false, reason: "refused" });
		expect(await owedNow(db, { householdId: "other-household", accountId: "visa" })).toBeNull();
		expect((await loadGoals(db, viewer)).goals).toEqual([]);
	});

	it("allows one active payoff Goal per card or loan", async () => {
		await payoff("first");
		expect(await payoff("second")).toEqual({ ok: false, reason: "refused" });
		await completeGoal(db, { householdId, goalId: "first" });
		expect(await payoff("second")).toMatchObject({ ok: true });
		const logged = await db.all(sql`select 1 from plan_changes where kind = 'goal-add'`);
		expect(logged).toHaveLength(2);
	});

	it("is funded from Free to Spend, but sets nothing aside and can't be spent or the emergency Goal", async () => {
		await payoff("visa-goal");
		expect(await fund("f1", "visa-goal", 20_000)).toMatchObject({ ok: true });
		expect(await claim("c1", "visa-goal", 1_000)).toEqual({ ok: false, reason: "refused" });
		expect(await spend("t1", "visa-goal", 1_000)).toEqual({ ok: false, reason: "refused" });
		expect(await setEmergencyGoal(db, { householdId, goalId: "visa-goal" })).toEqual({
			ok: false,
			reason: "refused",
		});
		expect(await undoGoalFunding(db, { householdId, moveId: "f1", month })).toMatchObject({
			ok: true,
		});
	});

	it("keeps its target when edited: only its name and date change", async () => {
		await payoff("visa-goal");
		await updateGoal(db, {
			householdId,
			memberId: parentId,
			month,
			goalId: "visa-goal",
			name: "Visa",
			targetCents: 1,
			targetDate: null,
		});
		expect((await loadGoals(db, viewer)).goals[0]).toMatchObject({
			name: "Visa",
			target: 50_000,
			targetDate: null,
		});
		const [change] = await db.all<[string]>(
			sql`select after from plan_changes where kind = 'goal' and target_id = 'visa-goal'`,
		);
		expect(JSON.parse(change?.[0] ?? "null")).toEqual({ target: 50_000, targetDate: null });
	});

	it("starts again from today's balance, only at what's owed now", async () => {
		await payoff("visa-goal");
		await owe("more", 65_000);
		const restart = (owedCents: number, at: MonthKey = "2026-10") =>
			restartPayoffGoal(db, {
				householdId,
				memberId: parentId,
				goalId: "visa-goal",
				month: at,
				owedCents,
			});
		expect(await restart(50_000)).toEqual({ ok: false, reason: "refused" });
		expect(await restart(65_000)).toMatchObject({ ok: true });
		expect((await loadGoals(db, viewer)).goals[0]).toMatchObject({
			target: 65_000,
			fromMonth: "2026-10",
		});
		const logged = await db.all(sql`select 1 from plan_changes where kind = 'goal'`);
		expect(logged).toHaveLength(1);
		// Again changes nothing and logs nothing.
		expect(await restart(65_000)).toMatchObject({ ok: true });
		expect(await db.all(sql`select 1 from plan_changes where kind = 'goal'`)).toHaveLength(1);
	});
});
