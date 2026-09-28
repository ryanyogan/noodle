import { type MonthKey, monthState, planForMonth } from "@noodle/domain";
import { type SQL, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { loadCharges } from "./commitments";
import {
	addBucket,
	addCommitment,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	loadPlanRecords,
	loadRolledOver,
	loadSpending,
	setAllowance,
	setBaseline,
	setRolling,
	updateCommitment,
} from "./index";
import { addCover, bucketLeftSql, freeToSpendSql, loadMoves, undoMove } from "./moves";
import { testDb } from "./test-db";

const householdId = "household";
const parentId = "parent";

let db: Db;

async function seed(db: Db) {
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: "Alex",
	});
	const month = "2026-09";
	await setBaseline(db, { householdId, month, amountCents: 900_000 });
	for (const [bucketId, color, allowanceCents] of [
		["groceries", 1, 120_000],
		["hockey", 2, 40_000],
		["fun", 3, 25_000],
	] as const) {
		await addBucket(db, { householdId, bucketId, name: bucketId, color, month, allowanceCents });
	}
	await addCommitment(db, {
		householdId,
		commitmentId: "mortgage",
		name: "Mortgage",
		month,
		amountCents: 250_000,
		cadence: "monthly",
		dueDate: "2026-09-01",
	});
	await addCommitment(db, {
		householdId,
		commitmentId: "daycare",
		name: "Daycare",
		month,
		amountCents: 60_000,
		cadence: "biweekly",
		dueDate: "2026-09-04",
	});
	await addCommitment(db, {
		householdId,
		commitmentId: "insurance",
		name: "Insurance",
		month,
		amountCents: 90_000,
		cadence: "annual",
		dueDate: "2027-03-01",
	});
}

const quickAdd = (
	transactionId: string,
	bucketId: string,
	amountCents: number,
	date = "2026-09-10",
) =>
	addQuickAdd(db, {
		householdId,
		transactionId,
		bucketId,
		date: date as `${number}-${number}-${number}`,
		amountCents,
		note: null,
		forMemberIds: [],
		createdByMemberId: parentId,
	});

const cover = (
	moveId: string,
	fromBucketId: string | null,
	toBucketId: string,
	amountCents: number,
) =>
	addCover(db, {
		householdId,
		moveId,
		month: "2026-09",
		fromBucketId,
		toBucketId,
		amountCents,
		createdByMemberId: parentId,
	});

const evaluate = async (expression: SQL) =>
	(await db.values<[number | null]>(sql`select ${expression}`))[0]?.[0];

/** The month's state as the app computes it, from the same rows. */
async function domainState(month: MonthKey) {
	const [records, spending, charges, moves] = await Promise.all([
		loadPlanRecords(db, householdId, month),
		loadSpending(db, householdId, month),
		loadCharges(db, householdId, month),
		loadMoves(db, householdId, month),
	]);
	return monthState({
		plan: planForMonth(records, month),
		spending,
		charges,
		moves,
		asOf: `${month}-15`,
	});
}

beforeEach(async () => {
	db = testDb();
	await seed(db);
});

describe("the Cover guard's SQL agrees with @noodle/domain", () => {
	beforeEach(async () => {
		await setAllowance(db, {
			householdId,
			bucketId: "groceries",
			month: "2026-10",
			amountCents: 100_000,
		});
		await setBaseline(db, { householdId, month: "2026-12", amountCents: 950_000 });
		// From November, Daycare is due every other Monday, the first on the month's last day.
		await updateCommitment(db, {
			householdId,
			commitmentId: "daycare",
			name: "Daycare",
			month: "2026-11",
			amountCents: 62_000,
			cadence: "biweekly",
			dueDate: "2026-11-30",
		});
		await quickAdd("t1", "groceries", 30_000);
		await quickAdd("t2", "hockey", 45_000);
		await quickAdd("t3", "groceries", 12_000, "2026-10-02");
		await quickAdd("t4", "fun", 1_000, "2026-10-31");
		await cover("m1", "groceries", "hockey", 5_000);
		await cover("m2", null, "fun", 2_000);
	});

	it.each([
		"2026-08",
		"2026-09",
		"2026-10",
		"2026-11",
		"2026-12",
		"2027-01",
		"2027-02",
		"2027-03",
		"2028-02",
	] as const)("in %s", async (month) => {
		const state = await domainState(month);
		expect(await evaluate(freeToSpendSql(householdId, month))).toBe(state.freeToSpend);
		for (const bucket of state.buckets) {
			expect(await evaluate(bucketLeftSql(householdId, bucket.id, month))).toBe(bucket.left);
		}
	});

	it("has nothing left in a Bucket that isn't in the Plan", async () => {
		expect(await evaluate(bucketLeftSql(householdId, "groceries", "2026-08"))).toBeNull();
		expect(await evaluate(bucketLeftSql("another-household", "groceries", "2026-09"))).toBeNull();
	});
});

describe("addCover", () => {
	beforeEach(async () => {
		// Hockey is $50 over; Fun has $20 left.
		await quickAdd("t1", "hockey", 45_000);
		await quickAdd("t2", "fun", 23_000);
	});

	it("appends one Move, which brings the Bucket back to zero", async () => {
		expect(await cover("m1", "groceries", "hockey", 5_000)).toEqual({ ok: true });
		const state = await domainState("2026-09");
		expect(state.buckets.find((b) => b.id === "hockey")?.left).toBe(0);
		expect(state.buckets.find((b) => b.id === "groceries")?.left).toBe(115_000);
		expect(await loadMoves(db, householdId, "2026-09")).toEqual([
			{
				id: "m1",
				fromBucketId: "groceries",
				toBucketId: "hockey",
				amount: 5_000,
				month: "2026-09",
			},
		]);
	});

	it("refuses more than the source Bucket has left", async () => {
		expect(await cover("m1", "fun", "hockey", 2_001)).toEqual({ ok: false, reason: "refused" });
		expect(await cover("m2", "fun", "hockey", 2_000)).toEqual({ ok: true });
		// Fun has nothing left now.
		expect(await cover("m3", "fun", "hockey", 1)).toEqual({ ok: false, reason: "refused" });
		expect(await loadMoves(db, householdId, "2026-09")).toHaveLength(1);
	});

	it("refuses more than Free to Spend has left", async () => {
		// $9,000 Baseline − $3,700 Commitments − $1,850 in Buckets.
		expect(await cover("m1", null, "hockey", 345_001)).toEqual({ ok: false, reason: "refused" });
		expect(await cover("m2", null, "hockey", 340_000)).toEqual({ ok: true });
		expect(await cover("m3", null, "hockey", 5_001)).toEqual({ ok: false, reason: "refused" });
		expect(await cover("m4", null, "hockey", 5_000)).toEqual({ ok: true });
	});

	it("counts spending that lands after an earlier Cover", async () => {
		await cover("m1", "groceries", "hockey", 5_000);
		await quickAdd("t3", "groceries", 110_000);
		expect(await cover("m2", "groceries", "fun", 5_001)).toEqual({ ok: false, reason: "refused" });
		expect(await cover("m3", "groceries", "fun", 5_000)).toEqual({ ok: true });
	});

	it("records a retried Cover once, even if the source has since run out", async () => {
		await cover("m1", "fun", "hockey", 2_000);
		expect(await cover("m1", "fun", "hockey", 2_000)).toEqual({ ok: true });
		expect(await loadMoves(db, householdId, "2026-09")).toHaveLength(1);
	});

	it("refuses Buckets that aren't the Household's or aren't in the Plan", async () => {
		await addBucket(db, {
			householdId,
			bucketId: "later",
			name: "Later",
			color: 4,
			month: "2026-10",
			allowanceCents: 50_000,
		});
		for (const [from, to] of [
			["later", "hockey"],
			["groceries", "later"],
			["groceries", "groceries"],
			["missing", "hockey"],
			["groceries", "missing"],
		] as const) {
			expect(await cover(`m-${from}-${to}`, from, to, 100)).toEqual({
				ok: false,
				reason: "refused",
			});
		}
		expect(await loadMoves(db, householdId, "2026-09")).toEqual([]);
	});
});

describe("undoMove", () => {
	it("removes the Move, once", async () => {
		await quickAdd("t1", "hockey", 45_000);
		await cover("m1", "groceries", "hockey", 5_000);
		await undoMove(db, { householdId, moveId: "m1", month: "2026-09" });
		await undoMove(db, { householdId, moveId: "m1", month: "2026-09" });
		expect(await loadMoves(db, householdId, "2026-09")).toEqual([]);
		expect((await domainState("2026-09")).buckets.find((b) => b.id === "hockey")?.left).toBe(
			-5_000,
		);
	});

	it("leaves other Households' Moves alone", async () => {
		await cover("m1", null, "hockey", 1_000);
		await undoMove(db, { householdId: "another-household", moveId: "m1", month: "2026-09" });
		expect(await loadMoves(db, householdId, "2026-09")).toHaveLength(1);
	});
});

describe("what rolls over", () => {
	it("carries a Rolling Bucket's September leftover, after Covers, into October and later", async () => {
		await setRolling(db, { householdId, bucketId: "hockey", month: "2026-09", rolling: true });
		await quickAdd("t1", "hockey", 45_000);
		await cover("m1", "fun", "hockey", 2_000);
		await quickAdd("t2", "groceries", 100_000);
		const into = async (month: MonthKey) =>
			loadRolledOver(db, householdId, await loadPlanRecords(db, householdId, month), month);
		expect(await into("2026-09")).toEqual({});
		// Hockey: 40,000 + 2,000 covered − 45,000; Groceries is Fresh-start.
		expect(await into("2026-10")).toEqual({ hockey: -3_000 });
		expect(await into("2026-11")).toEqual({ hockey: 37_000 });
	});

	it("keeps the Cover guard in step with the domain once something has rolled over", async () => {
		await setRolling(db, { householdId, bucketId: "hockey", month: "2026-09", rolling: true });
		await quickAdd("t1", "hockey", 10_000);
		const month = "2026-10";
		const records = await loadPlanRecords(db, householdId, month);
		const carried = await loadRolledOver(db, householdId, records, month);
		const state = monthState({
			plan: planForMonth(records, month),
			spending: [],
			rolledOver: carried,
			asOf: `${month}-15`,
		});
		const hockey = state.buckets.find((b) => b.id === "hockey");
		expect(hockey?.left).toBe(70_000);
		expect(await evaluate(bucketLeftSql(householdId, "hockey", month, carried.hockey))).toBe(
			70_000,
		);
		const coverFromHockey = (moveId: string, amountCents: number) =>
			addCover(db, {
				householdId,
				moveId,
				month,
				fromBucketId: "hockey",
				toBucketId: "fun",
				amountCents,
				fromRolledOverCents: carried.hockey,
				createdByMemberId: parentId,
			});
		expect(await coverFromHockey("m1", 70_001)).toEqual({ ok: false, reason: "refused" });
		expect(await coverFromHockey("m2", 70_000)).toEqual({ ok: true });
	});

	it("sets Rolling only on the Household's own Buckets, replacing the same month's setting", async () => {
		await setRolling(db, {
			householdId: "other",
			bucketId: "hockey",
			month: "2026-09",
			rolling: true,
		});
		await setRolling(db, { householdId, bucketId: "fun", month: "2026-10", rolling: true });
		await setRolling(db, { householdId, bucketId: "fun", month: "2026-10", rolling: false });
		const records = await loadPlanRecords(db, householdId, "2026-12");
		expect(records.rolling).toEqual([{ bucketId: "fun", month: "2026-10", rolling: false }]);
	});
});
