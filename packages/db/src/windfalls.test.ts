import { type MonthKey, monthState, planForMonth } from "@noodle/domain";
import { type SQL, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBucket,
	addGoal,
	addIncome,
	createHouseholdForParent,
	type Db,
	decideWindfall,
	fundGoal,
	loadGoalFunding,
	loadGoals,
	loadIncome,
	loadMoves,
	loadPlanRecords,
	removeIncome,
	setBaseline,
	setEmergencyGoal,
	spendGoal,
	undoWindfall,
} from "./index";
import { freeToSpendSql } from "./moves";
import { testDb } from "./test-db";
import { windfallLeftSql } from "./windfalls";

const householdId = "household";
const parentId = "parent";
const month: MonthKey = "2026-10";

let db: Db;

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: "Alex",
	});
	await setBaseline(db, { householdId, memberId: parentId, month, amountCents: 600_000 });
	await addBucket(db, {
		householdId,
		memberId: parentId,
		bucketId: "fun",
		name: "Fun",
		color: 1,
		month,
		allowanceCents: 40_000,
	});
	await addAccount(db, {
		householdId,
		accountId: "savings",
		name: "Savings",
		kind: "savings",
		balanceCents: 1_000_000,
		balanceId: "balance",
		createdByMemberId: parentId,
	});
	for (const goalId of ["trip", "emergency"]) {
		await addGoal(db, {
			householdId,
			goalId,
			accountId: "savings",
			name: goalId,
			targetCents: 500_000,
			targetDate: null,
			fromMonth: month,
			claimId: `claim-${goalId}`,
			claimCents: 0,
			createdByMemberId: parentId,
		});
	}
});

const receive = (incomeId: string, date: `${number}-${number}-${number}`, amountCents: number) =>
	addIncome(db, {
		householdId,
		incomeId,
		date,
		amountCents,
		note: null,
		createdByMemberId: parentId,
	});

const decide = (
	moveId: string,
	to: { kind: "goal"; goalId: string } | { kind: "bucket"; bucketId: string },
	amountCents: number,
) =>
	decideWindfall(db, { householdId, moveId, month, to, amountCents, createdByMemberId: parentId });

const scalar = async (expression: SQL) =>
	(await db.values<[number | null]>(sql`select ${expression}`))[0]?.[0];

/** The month as the domain derives it from what's stored. */
async function state() {
	const records = await loadPlanRecords(db, householdId, month);
	return monthState({
		plan: planForMonth(records, month),
		spending: [],
		moves: await loadMoves(db, householdId, month),
		goalFunding: await loadGoalFunding(db, householdId, month),
		income: await loadIncome(db, householdId, month, "2026-11"),
		asOf: "2026-10-20",
	});
}

describe("income", () => {
	it("is recorded once per ID and loaded by month", async () => {
		await receive("pay-1", "2026-10-01", 300_000);
		await receive("pay-1", "2026-10-01", 300_000);
		await receive("pay-0", "2026-09-30", 300_000);
		expect(await loadIncome(db, householdId, month, "2026-11")).toEqual([
			{ id: "pay-1", amount: 300_000, date: "2026-10-01", note: null },
		]);
		expect(await loadIncome(db, householdId, "2026-09", "2026-11")).toHaveLength(2);
	});

	it("never counts toward spending or Free to Spend", async () => {
		const before = await scalar(freeToSpendSql(householdId, month));
		await receive("pay-1", "2026-10-01", 900_000);
		expect(await scalar(freeToSpendSql(householdId, month))).toBe(before);
	});
});

describe("Windfall Moves", () => {
	beforeEach(async () => {
		await receive("pay-1", "2026-10-02", 300_000);
		await receive("pay-2", "2026-10-16", 300_000);
		await receive("pay-3", "2026-10-30", 300_000);
	});

	it("SQL agrees with the domain on what's left to decide", async () => {
		expect(await scalar(windfallLeftSql(householdId, month))).toBe(300_000);
		expect((await state()).windfallLeft).toBe(300_000);
		await decide("to-trip", { kind: "goal", goalId: "trip" }, 200_000);
		await decide("to-fun", { kind: "bucket", bucketId: "fun" }, 30_000);
		expect(await scalar(windfallLeftSql(householdId, month))).toBe(70_000);
		const after = await state();
		expect(after.windfallLeft).toBe(70_000);
		expect(after.buckets[0]?.left).toBe(70_000);
		expect(after.fundedGoals).toBe(0);
	});

	it("go to a Goal's Earmark without touching Free to Spend", async () => {
		const free = (await scalar(freeToSpendSql(householdId, month))) ?? 0;
		expect(await decide("to-trip", { kind: "goal", goalId: "trip" }, 300_000)).toEqual({
			ok: true,
		});
		expect(await scalar(freeToSpendSql(householdId, month))).toBe(free);
		// Goal funding from Free to Spend is still judged on Free to Spend alone.
		expect(
			await fundGoal(db, {
				householdId,
				moveId: "funding",
				goalId: "trip",
				month,
				amountCents: free,
				createdByMemberId: parentId,
			}),
		).toEqual({ ok: true });
		const { changes } = await loadGoals(db, { householdId, memberId: parentId });
		const trip = changes.filter((c) => c.goalId === "trip");
		expect(trip.map((c) => [c.kind, c.amount]).sort()).toEqual([
			["funding", 300_000],
			["funding", free],
		]);
	});

	it("are refused beyond what's left, and idempotent per ID", async () => {
		expect(await decide("big", { kind: "goal", goalId: "trip" }, 300_001)).toEqual({
			ok: false,
			reason: "refused",
		});
		expect(await decide("a", { kind: "goal", goalId: "trip" }, 200_000)).toEqual({ ok: true });
		expect(await decide("a", { kind: "goal", goalId: "trip" }, 200_000)).toEqual({ ok: true });
		expect(await decide("b", { kind: "bucket", bucketId: "fun" }, 100_001)).toEqual({
			ok: false,
			reason: "refused",
		});
		expect(await scalar(windfallLeftSql(householdId, month))).toBe(100_000);
	});

	it("are refused to another Household's Goal or a Bucket not in the Plan", async () => {
		expect(await decide("x", { kind: "goal", goalId: "nope" }, 1_000)).toMatchObject({ ok: false });
		expect(
			await decideWindfall(db, {
				householdId,
				moveId: "y",
				month: "2026-09",
				to: { kind: "bucket", bucketId: "fun" },
				amountCents: 1_000,
				createdByMemberId: parentId,
			}),
		).toMatchObject({ ok: false });
	});

	it("can be undone, unless the Goal has spent the money since", async () => {
		await decide("to-fun", { kind: "bucket", bucketId: "fun" }, 50_000);
		expect(await undoWindfall(db, { householdId, moveId: "to-fun", month })).toEqual({ ok: true });
		await decide("to-trip", { kind: "goal", goalId: "trip" }, 100_000);
		await spendGoal(db, {
			householdId,
			transactionId: "deposit",
			goalId: "trip",
			date: "2026-10-20",
			amountCents: 60_000,
			note: null,
			createdByMemberId: parentId,
		});
		expect(await undoWindfall(db, { householdId, moveId: "to-trip", month })).toEqual({
			ok: false,
			reason: "refused",
		});
		expect(await scalar(windfallLeftSql(householdId, month))).toBe(200_000);
	});

	it("keep the income they came from from being removed", async () => {
		await decide("to-trip", { kind: "goal", goalId: "trip" }, 250_000);
		expect(await removeIncome(db, { householdId, incomeId: "pay-3", month })).toEqual({
			ok: false,
			reason: "refused",
		});
		await undoWindfall(db, { householdId, moveId: "to-trip", month });
		expect(await removeIncome(db, { householdId, incomeId: "pay-3", month })).toEqual({ ok: true });
		expect(await removeIncome(db, { householdId, incomeId: "pay-3", month })).toEqual({ ok: true });
		expect(await scalar(windfallLeftSql(householdId, month))).toBe(0);
	});
});

describe("the emergency Goal", () => {
	it("is one of the Household's active Goals, or none", async () => {
		expect(await setEmergencyGoal(db, { householdId, goalId: "emergency" })).toEqual({ ok: true });
		expect((await loadGoals(db, { householdId, memberId: parentId })).emergencyGoalId).toBe(
			"emergency",
		);
		expect(await setEmergencyGoal(db, { householdId, goalId: "nope" })).toMatchObject({
			ok: false,
		});
		expect((await loadGoals(db, { householdId, memberId: parentId })).emergencyGoalId).toBe(
			"emergency",
		);
		await setEmergencyGoal(db, { householdId, goalId: null });
		expect((await loadGoals(db, { householdId, memberId: parentId })).emergencyGoalId).toBeNull();
	});
});
