import { type MonthKey, monthState, planForMonth } from "@noodle/domain";
import { type SQL, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { setAsideSql } from "./goals";
import {
	addAccount,
	addBucket,
	addGoal,
	addIncome,
	addPersonalAllowance,
	addQuickAdd,
	archiveGoal,
	closeMonth,
	createHouseholdForParent,
	type Db,
	listHouseholds,
	loadMonthClose,
	loadPlanRecords,
	loadSpending,
	loadSweeps,
	setBaseline,
	setRolling,
} from "./index";
import { freeToSpendSql } from "./moves";
import { testDb } from "./test-db";

const householdId = "household";
const parentId = "parent";
const month: MonthKey = "2026-09";

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
	for (const [bucketId, allowanceCents] of [
		["groceries", 120_000],
		["hockey", 40_000],
	] as const) {
		await addBucket(db, {
			householdId,
			memberId: parentId,
			bucketId,
			name: bucketId,
			color: 1,
			month,
			allowanceCents,
		});
	}
	await setRolling(db, {
		householdId,
		memberId: parentId,
		bucketId: "hockey",
		month,
		rolling: true,
	});
	await addPersonalAllowance(db, {
		householdId,
		bucketId: "alex",
		name: "Alex",
		color: 2,
		month,
		allowanceCents: 10_000,
		memberId: parentId,
	});
	await addQuickAdd(db, {
		householdId,
		transactionId: "costco",
		bucketId: "groceries",
		date: "2026-09-12",
		amountCents: 100_000,
		note: null,
		forMemberIds: [],
		createdByMemberId: parentId,
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
	for (const goalId of ["rainy-day", "trip"]) {
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
	// $500 beyond the Baseline.
	await addIncome(db, {
		householdId,
		incomeId: "pay",
		date: "2026-09-01",
		amountCents: 650_000,
		note: null,
		createdByMemberId: parentId,
	});
});

const scalar = async (expression: SQL) =>
	(await db.values<[number | null]>(sql`select ${expression}`))[0]?.[0];

const sweep = (moveId: string, bucketId: string, amountCents: number, goalId = "rainy-day") => ({
	moveId,
	bucketId,
	goalId,
	amountCents,
	rolledOverCents: 0,
});

const close = (
	closeId: string,
	decision: {
		sweeps?: ReturnType<typeof sweep>[];
		windfall?: { moveId: string; goalId: string; amountCents: number }[];
	},
	decidedByMemberId: string | null = parentId,
) =>
	closeMonth(db, {
		householdId,
		closeId,
		month,
		decidedByMemberId,
		sweeps: decision.sweeps ?? [],
		windfall: decision.windfall ?? [],
	});

describe("closeMonth", () => {
	it("Sweeps leftovers and sends the Windfall to Goals, atomically with the close", async () => {
		const free = await scalar(freeToSpendSql(householdId, month));
		expect(
			await close("close", {
				sweeps: [sweep("s1", "groceries", 20_000)],
				windfall: [{ moveId: "w1", goalId: "trip", amountCents: 50_000 }],
			}),
		).toEqual({ ok: true });
		expect(await loadMonthClose(db, householdId, month)).toEqual({ decidedBy: parentId });
		expect(await loadSweeps(db, householdId, month)).toEqual([
			{ id: "s1", bucketId: "groceries", goalId: "rainy-day", amount: 20_000, month },
		]);
		expect(await scalar(setAsideSql(householdId, "rainy-day"))).toBe(20_000);
		expect(await scalar(setAsideSql(householdId, "trip"))).toBe(50_000);
		// Sweeps come out of the Bucket, never Free to Spend.
		expect(await scalar(freeToSpendSql(householdId, month))).toBe(free);
		const records = await loadPlanRecords(db, householdId, month);
		const state = monthState({
			plan: planForMonth(records, month),
			spending: await loadSpending(db, { householdId, memberId: parentId }, month),
			sweeps: await loadSweeps(db, householdId, month),
			asOf: "2026-09-30",
		});
		expect(state.buckets.find((b) => b.id === "groceries")?.left).toBe(0);
	});

	it("is idempotent per close, and closes a month once: defaults can't follow a decision", async () => {
		const decision = { sweeps: [sweep("s1", "groceries", 20_000)] };
		expect(await close("close", decision)).toEqual({ ok: true });
		expect(await close("close", decision)).toEqual({ ok: true });
		expect(
			await close("defaults", { sweeps: [sweep("s2", "groceries", 20_000, "trip")] }, null),
		).toEqual({ ok: false, reason: "already-closed" });
		expect(await loadSweeps(db, householdId, month)).toHaveLength(1);
		expect(await loadMonthClose(db, householdId, month)).toEqual({ decidedBy: parentId });
	});

	it("closes with nothing moved when the decision is to leave it all", async () => {
		expect(await close("defaults", {}, null)).toEqual({ ok: true });
		expect(await loadMonthClose(db, householdId, month)).toEqual({ decidedBy: null });
	});

	it("skips Sweeps its guards refuse, but still closes", async () => {
		await archiveGoal(db, { householdId, goalId: "trip" });
		expect(
			await close("close", {
				sweeps: [
					// More than is left, a Rolling Bucket, a Personal Allowance, an archived Goal.
					sweep("s1", "groceries", 20_001),
					sweep("s2", "hockey", 1_000),
					sweep("s3", "alex", 1_000),
					sweep("s4", "groceries", 1_000, "trip"),
				],
				windfall: [{ moveId: "w1", goalId: "rainy-day", amountCents: 50_001 }],
			}),
		).toEqual({ ok: true });
		expect(await loadSweeps(db, householdId, month)).toEqual([]);
		expect(await scalar(setAsideSql(householdId, "rainy-day"))).toBe(0);
	});

	it("Sweeps in turn: together they can't take more than the leftover", async () => {
		await close("close", {
			sweeps: [sweep("s1", "groceries", 15_000), sweep("s2", "groceries", 15_000, "trip")],
		});
		expect((await loadSweeps(db, householdId, month)).map((s) => s.id)).toEqual(["s1"]);
	});
});

describe("listHouseholds", () => {
	it("lists every Household with its time zone", async () => {
		expect(await listHouseholds(db)).toEqual([{ id: householdId, timeZone: "America/Chicago" }]);
	});
});
