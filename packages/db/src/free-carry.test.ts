import { addMonths, type DayKey, type MonthKey, monthState, planForMonth } from "@noodle/domain";
import { type SQL, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBucket,
	addGoal,
	addIncome,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	fundGoal,
	loadExtraToFree,
	loadFreeCarriedIn,
	loadFreeCarriedInto,
	loadFreeCarryMonths,
	loadGoalFunding,
	loadPlanRecords,
	setTakeHomePay,
} from "./index";
import { addCover, freeToSpendSql, loadMoves } from "./moves";
import { testDb } from "./test-db";

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const current: MonthKey = "2026-10";

let db: Db;
let n = 0;

const earn = (month: MonthKey, amountCents: number) =>
	addIncome(db, {
		householdId,
		incomeId: `income-${n++}`,
		date: `${month}-03` as DayKey,
		amountCents,
		note: "Salary",
		createdByMemberId: parentId,
	});

const spend = (month: MonthKey, amountCents: number) =>
	addQuickAdd(db, {
		householdId,
		transactionId: `spend-${n++}`,
		bucketId: "fun",
		date: `${month}-10` as DayKey,
		amountCents,
		note: null,
		forMemberIds: [],
		createdByMemberId: parentId,
	});

const fund = (moveId: string, month: MonthKey, amountCents: number, freeCarriedInCents?: number) =>
	fundGoal(db, {
		householdId,
		moveId,
		goalId: "braces",
		month,
		amountCents,
		freeCarriedInCents,
		createdByMemberId: parentId,
	});

// The Plan starts in April 2026: take-home pay $5,000 and a $4,400 Bucket, so each month's Plan
// leaves $600. What the ended months actually left (income less spending and Goal funding):
// April +$700, May −$1,200, June −$500, July +$1,000, August +$600, September nothing.
// March's $9,000 of income is bank history from before the Plan. October, the Household's month,
// has a $50 Cover from Free to Spend.
beforeEach(async () => {
	db = testDb();
	n = 0;
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: "Alex",
	});
	const month = "2026-04";
	await setTakeHomePay(db, { householdId, memberId: parentId, month, amountCents: 500_000 });
	for (const [bucketId, color, allowanceCents] of [
		["fun", 1, 440_000],
		["extras", 2, 0],
	] as const) {
		await addBucket(db, {
			householdId,
			memberId: parentId,
			bucketId,
			name: bucketId,
			color,
			month,
			allowanceCents,
		});
	}
	await addAccount(db, {
		householdId,
		accountId: "savings",
		name: "Savings",
		kind: "savings",
		balanceCents: 5_000_000,
		balanceId: "balance",
		createdByMemberId: parentId,
	});
	await addGoal(db, {
		householdId,
		goalId: "braces",
		accountId: "savings",
		name: "Braces",
		targetCents: 3_000_000,
		targetDate: null,
		fromMonth: "2026-04",
		claimId: "claim",
		claimCents: 0,
		createdByMemberId: parentId,
	});
	await earn("2026-03", 900_000);
	for (const [m, income, spent] of [
		["2026-04", 500_000, 430_000],
		["2026-05", 500_000, 620_000],
		["2026-06", 400_000, 450_000],
		["2026-07", 500_000, 380_000],
		["2026-08", 500_000, 440_000],
	] as const) {
		await earn(m, income);
		await spend(m, spent);
	}
	expect((await fund("fund-jul", "2026-07", 20_000)).ok).toBe(true);
	await addCover(db, {
		householdId,
		moveId: "cover-oct",
		month: current,
		fromBucketId: null,
		toBucketId: "extras",
		amountCents: 5_000,
		freeCarriedInCents: 60_000,
		createdByMemberId: parentId,
	});
});

const evaluate = async (expression: SQL) =>
	(await db.values<[number | null]>(sql`select ${expression}`))[0]?.[0];

const walk = async (through: MonthKey, now: MonthKey = current) =>
	loadFreeCarryMonths(db, viewer, await loadPlanRecords(db, householdId, through), through, now);

describe("Free to Spend carried over (issue 113)", () => {
	it("walks from the first month with a Plan, ended months handing on what they actually left", async () => {
		const months = await walk(current);
		expect(months.map((m) => [m.month, m.carriedIn, m.own, m.left])).toEqual([
			["2026-04", 0, 70_000, 70_000],
			["2026-05", 70_000, -120_000, -50_000],
			["2026-06", -50_000, -50_000, -100_000],
			["2026-07", -100_000, 100_000, 0],
			["2026-08", 0, 60_000, 60_000],
			["2026-09", 60_000, 0, 60_000],
			// The Household's month: its Plan's $600 less the $50 Cover.
			["2026-10", 60_000, 55_000, 115_000],
		]);
		expect(months.map((m) => m.ended)).toEqual([true, true, true, true, true, true, false]);
	});

	it("carries nothing into the first month with a Plan, or any before it", async () => {
		expect(await loadFreeCarriedInto(db, viewer, "2026-04", current)).toBe(0);
		expect(await loadFreeCarriedInto(db, viewer, "2026-03", current)).toBe(0);
		expect(await walk("2026-03")).toEqual([]);
	});

	it("months ahead hand on their Plan figure", async () => {
		const months = await walk("2026-12");
		expect(months.slice(-2).map((m) => [m.month, m.carriedIn, m.own, m.left])).toEqual([
			["2026-11", 115_000, 60_000, 175_000],
			["2026-12", 175_000, 60_000, 235_000],
		]);
	});

	it("the guards' SQL agrees with monthState in every month, carried in above or below zero", async () => {
		const seen: number[] = [];
		// Each month in turn as the Household's month, so it is its Plan figure that is checked.
		for (let month: MonthKey = "2026-04"; month <= current; month = addMonths(month, 1)) {
			const records = await loadPlanRecords(db, householdId, month);
			const [moves, goalFunding, extraToFree, freeCarriedIn] = await Promise.all([
				loadMoves(db, householdId, month),
				loadGoalFunding(db, householdId, month),
				loadExtraToFree(db, householdId, month),
				loadFreeCarriedIn(db, viewer, records, month, month),
			]);
			const state = monthState({
				plan: planForMonth(records, month),
				spending: [],
				moves,
				goalFunding,
				extraToFree,
				freeCarriedIn,
				asOf: `${month}-15` as DayKey,
			});
			expect(await evaluate(freeToSpendSql(householdId, month, freeCarriedIn))).toBe(
				state.freeToSpend,
			);
			seen.push(freeCarriedIn);
		}
		expect(seen).toEqual([0, 70_000, -50_000, -100_000, 0, 60_000, 60_000]);
	});

	it("an ended month with no income recorded hands on only what it was carried (Quick Add only)", async () => {
		// September: $4,000 spent, no income recorded. Its own figure counts as nothing.
		await spend("2026-09", 400_000);
		expect(
			(await walk(current)).slice(-2).map((m) => [m.month, m.carriedIn, m.own, m.left]),
		).toEqual([
			["2026-09", 60_000, 0, 60_000],
			["2026-10", 60_000, 55_000, 115_000],
		]);
		// The guards' SQL is given the same carry, so it agrees with monthState.
		const sqlAgrees = async (carried: number) => {
			const records = await loadPlanRecords(db, householdId, current);
			const [moves, goalFunding, extraToFree, freeCarriedIn] = await Promise.all([
				loadMoves(db, householdId, current),
				loadGoalFunding(db, householdId, current),
				loadExtraToFree(db, householdId, current),
				loadFreeCarriedIn(db, viewer, records, current, current),
			]);
			expect(freeCarriedIn).toBe(carried);
			const state = monthState({
				plan: planForMonth(records, current),
				spending: [],
				moves,
				goalFunding,
				extraToFree,
				freeCarriedIn,
				asOf: `${current}-15` as DayKey,
			});
			expect(await evaluate(freeToSpendSql(householdId, current, freeCarriedIn))).toBe(
				state.freeToSpend,
			);
		};
		await sqlAgrees(60_000);
		// $1 of income recorded puts the month on the books: income less spending, −$3,999.
		await earn("2026-09", 100);
		expect((await walk(current)).at(-2)).toMatchObject({ own: -399_900, left: -339_900 });
		await sqlAgrees(-339_900);
	});

	it("Goal funding and a Cover may use what was carried over, and no more", async () => {
		// October has $550 of its own and $600 carried over.
		expect((await fund("too-much", current, 120_000, 60_000)).ok).toBe(false);
		expect((await fund("own-only", current, 110_000)).ok).toBe(false);
		expect((await fund("with-carry", current, 110_000, 60_000)).ok).toBe(true);
		expect((await walk(current)).at(-1)?.left).toBe(5_000);
	});

	it("a shortfall carried over leaves less to fund a Goal or Cover a Bucket from", async () => {
		expect((await fund("short", current, 10_000, -50_000)).ok).toBe(false);
		await addCover(db, {
			householdId,
			moveId: "cover-short",
			month: current,
			fromBucketId: null,
			toBucketId: "extras",
			amountCents: 10_000,
			freeCarriedInCents: -50_000,
			createdByMemberId: parentId,
		});
		expect(await loadMoves(db, householdId, current)).toHaveLength(1);
	});
});
