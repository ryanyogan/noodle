import { type MonthKey, monthState, planForMonth } from "@noodle/domain";
import { eq, type SQL, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { clearHouseholdRows } from "./fresh-start";
import {
	addAccount,
	addBucket,
	addCommitment,
	addGoal,
	createHouseholdForParent,
	type Db,
	fundGoal,
	loadExtraToFree,
	loadFreeCarriedIn,
	loadFreeCarriedInto,
	loadFreeCarryMonths,
	loadFreeToSpendKeepBack,
	loadGoalFunding,
	loadPlanChanges,
	loadPlanRecords,
	setAllowance,
	setFreeToSpendCarry,
	setFreeToSpendKeepBack,
	setTakeHomePay,
} from "./index";
import { addCover, freeToSpendSql, loadMoves } from "./moves";
import * as s from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const parentId = "parent";

let db: Db;

// September 2026: take-home pay $9,000, Buckets $1,850, Mortgage $2,500: $4,650 unassigned.
// A Cover of $20 and Goal funding of $300 come out of it and $100 of Extra income is added,
// so September ends with $4,430 in Free to Spend. October on its own has $4,650.
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
	const month = "2026-09";
	await setTakeHomePay(db, { householdId, memberId: parentId, month, amountCents: 900_000 });
	for (const [bucketId, color, allowanceCents] of [
		["groceries", 1, 120_000],
		["hockey", 2, 40_000],
		["fun", 3, 25_000],
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
	await addCommitment(db, {
		householdId,
		memberId: parentId,
		commitmentId: "mortgage",
		name: "Mortgage",
		month,
		amountCents: 250_000,
		cadence: "monthly",
		dueDate: "2026-09-01",
	});
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
		fromMonth: "2026-09",
		claimId: "claim",
		claimCents: 0,
		createdByMemberId: parentId,
	});
	await addCover(db, {
		householdId,
		moveId: "cover-sep",
		month,
		fromBucketId: null,
		toBucketId: "fun",
		amountCents: 2_000,
		createdByMemberId: parentId,
	});
	await fund("fund-sep", "2026-09", 30_000);
	await extraToFree("extra-sep", "2026-09", 10_000);
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

/** Extra income a Parent added to a month's Free to Spend, as decideExtraIncome writes it. */
const extraToFree = (id: string, month: MonthKey, amountCents: number) =>
	db.insert(s.moves).values({
		id,
		householdId,
		kind: "windfall",
		month,
		fromBucketId: null,
		toBucketId: null,
		toGoalId: null,
		amountCents,
		createdByMemberId: parentId,
	});

const evaluate = async (expression: SQL) =>
	(await db.values<[number | null]>(sql`select ${expression}`))[0]?.[0];

/** The month's state as the app computes it (loadMonth), from the same rows. */
async function domainState(month: MonthKey) {
	const records = await loadPlanRecords(db, householdId, month);
	const [moves, goalFunding, extra, freeCarriedIn] = await Promise.all([
		loadMoves(db, householdId, month),
		loadGoalFunding(db, householdId, month),
		loadExtraToFree(db, householdId, month),
		loadFreeCarriedIn(db, householdId, records, month),
	]);
	return monthState({
		plan: planForMonth(records, month),
		spending: [],
		moves,
		goalFunding,
		extraToFree: extra,
		freeCarriedIn,
		asOf: `${month}-15`,
	});
}

const months = ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"] as const;

describe("with no setting, Free to Spend starts fresh", () => {
	it("loads the Plan's records with no setting, and carries nothing", async () => {
		const records = await loadPlanRecords(db, householdId, "2026-12");
		expect(records.freeCarries).toEqual([]);
		for (const month of months) {
			expect(await loadFreeCarriedIn(db, householdId, records, month)).toBe(0);
			expect(await loadFreeCarriedInto(db, householdId, month)).toBe(0);
		}
	});

	it.each(months)("leaves %s's Free to Spend as it was", async (month) => {
		const state = await domainState(month);
		expect(state.freeCarriedIn).toBe(0);
		expect(await evaluate(freeToSpendSql(householdId, month))).toBe(state.freeToSpend);
	});

	it("has September end with $4,430 and October start with its own $4,650", async () => {
		expect((await domainState("2026-09")).freeToSpend).toBe(443_000);
		expect((await domainState("2026-10")).freeToSpend).toBe(465_000);
	});
});

describe("once Free to Spend builds up", () => {
	beforeEach(async () => {
		await setFreeToSpendCarry(db, { householdId, month: "2026-09", carries: true });
		// November alone plans far more than it has, even with what two months built.
		await setAllowance(db, {
			householdId,
			memberId: parentId,
			bucketId: "groceries",
			month: "2026-11",
			amountCents: 2_000_000,
		});
		await setAllowance(db, {
			householdId,
			memberId: parentId,
			bucketId: "groceries",
			month: "2026-12",
			amountCents: 120_000,
		});
		await fund("fund-oct", "2026-10", 50_000);
	});

	it("carries each month's leftover into the next, and nothing out of one below zero", async () => {
		const carried = async (month: MonthKey) => (await domainState(month)).freeCarriedIn;
		expect(await carried("2026-09")).toBe(0);
		expect(await carried("2026-10")).toBe(443_000);
		// October: $4,650 of its own, $4,430 carried in, $500 to the Goal.
		expect(await carried("2026-11")).toBe(858_000);
		expect((await domainState("2026-11")).freeToSpend).toBeLessThan(0);
		expect(await carried("2026-12")).toBe(0);
		expect(await carried("2027-01")).toBe(465_000);
	});

	it.each(months)("has the guard's SQL agree with @noodle/domain in %s", async (month) => {
		const state = await domainState(month);
		expect(await evaluate(freeToSpendSql(householdId, month, state.freeCarriedIn))).toBe(
			state.freeToSpend,
		);
	});

	it.each(months)(
		"loads the same amount with or without the Plan's records, in %s",
		async (month) => {
			const records = await loadPlanRecords(db, householdId, month);
			expect(await loadFreeCarriedInto(db, householdId, month)).toBe(
				await loadFreeCarriedIn(db, householdId, records, month),
			);
		},
	);

	it("lets Goal funding use carried-in money, and refuses it without", async () => {
		// October has $4,150 of its own left; $8,000 only fits with September's $4,430.
		expect(await fund("too-much", "2026-10", 800_000)).toEqual({ ok: false, reason: "refused" });
		const carriedIn = await loadFreeCarriedInto(db, householdId, "2026-10");
		expect(await fund("fits", "2026-10", 800_000, carriedIn)).toEqual({ ok: true });
		expect(await fund("over", "2026-10", 60_000, carriedIn)).toEqual({
			ok: false,
			reason: "refused",
		});
		expect((await domainState("2026-10")).freeToSpend).toBe(58_000);
	});

	it("lets a Cover from Free to Spend use carried-in money, and refuses it without", async () => {
		const cover = (moveId: string, freeCarriedInCents?: number) =>
			addCover(db, {
				householdId,
				moveId,
				month: "2026-10",
				fromBucketId: null,
				toBucketId: "fun",
				amountCents: 800_000,
				freeCarriedInCents,
				createdByMemberId: parentId,
			});
		expect(await cover("too-much")).toEqual({ ok: false, reason: "refused" });
		expect(await cover("fits", await loadFreeCarriedInto(db, householdId, "2026-10"))).toEqual({
			ok: true,
		});
	});

	it("follows a late change to an ended month", async () => {
		await extraToFree("extra-late", "2026-09", 25_000);
		expect((await domainState("2026-10")).freeCarriedIn).toBe(468_000);
	});

	it("stops from the month it's turned off, and a month's setting can be set again", async () => {
		await setFreeToSpendCarry(db, { householdId, month: "2026-10", carries: false });
		expect(await loadFreeCarriedInto(db, householdId, "2026-10")).toBe(443_000);
		expect(await loadFreeCarriedInto(db, householdId, "2026-11")).toBe(0);
		await setFreeToSpendCarry(db, { householdId, month: "2026-10", carries: true });
		expect(await loadFreeCarriedInto(db, householdId, "2026-11")).toBe(858_000);
		expect(await db.select().from(s.freeToSpendCarry)).toHaveLength(2);
	});

	it("is another Household's own business", async () => {
		expect(await loadFreeCarriedInto(db, "another-household", "2026-10")).toBe(0);
	});
});

describe("the kept-back amount", () => {
	it("is nothing until a Parent sets one, and never below zero", async () => {
		expect(await loadFreeToSpendKeepBack(db, householdId)).toBe(0);
		await setFreeToSpendKeepBack(db, { householdId, amountCents: 10_000 });
		expect(await loadFreeToSpendKeepBack(db, householdId)).toBe(10_000);
		await setFreeToSpendKeepBack(db, { householdId, amountCents: -5 });
		expect(await loadFreeToSpendKeepBack(db, householdId)).toBe(0);
	});

	it("doesn't change Free to Spend", async () => {
		await setFreeToSpendCarry(db, { householdId, month: "2026-09", carries: true });
		await setFreeToSpendKeepBack(db, { householdId, amountCents: 10_000 });
		expect((await domainState("2026-10")).freeCarriedIn).toBe(443_000);
	});
});

describe("a fresh start", () => {
	it("clears the setting and the kept-back amount with the rest of the Plan", async () => {
		await setFreeToSpendCarry(db, { householdId, month: "2026-09", carries: true });
		await setFreeToSpendKeepBack(db, { householdId, amountCents: 10_000 });
		await clearHouseholdRows(db, householdId, "fresh-start");
		expect(
			await db
				.select()
				.from(s.freeToSpendCarry)
				.where(eq(s.freeToSpendCarry.householdId, householdId)),
		).toEqual([]);
		expect(await loadFreeToSpendKeepBack(db, householdId)).toBe(0);
	});
});

describe("the setting in the Plan's history, and the months it built up (issue 113)", () => {
	const viewer = { householdId, memberId: parentId };

	it("logs turning it on once, and turning it off, as Plan changes to Free to Spend", async () => {
		const on = { householdId, memberId: parentId, month: "2026-09" as MonthKey, carries: true };
		await setFreeToSpendCarry(db, on);
		// A retry changes nothing, so it logs nothing.
		await setFreeToSpendCarry(db, on);
		await setFreeToSpendCarry(db, { ...on, month: "2026-10", carries: false });
		const { changes } = await loadPlanChanges(db, viewer, { month: "2026-09" });
		const logged = changes.filter((c) => c.kind === "free-carry");
		expect(logged).toHaveLength(1);
		expect(logged[0]).toMatchObject({
			targetId: "free-to-spend",
			month: "2026-09",
			before: { buildsUp: false },
			after: { buildsUp: true },
		});
		const october = await loadPlanChanges(db, viewer, { month: "2026-10" });
		expect(october.changes.filter((c) => c.kind === "free-carry")).toMatchObject([
			{ before: { buildsUp: true }, after: { buildsUp: false } },
		]);
	});

	it("walks the months from when it was turned on, agreeing with what is carried in", async () => {
		expect(
			await loadFreeCarryMonths(
				db,
				householdId,
				await loadPlanRecords(db, householdId, "2026-11"),
				"2026-11",
			),
		).toEqual([]);
		await setFreeToSpendCarry(db, { householdId, month: "2026-09", carries: true });
		const records = await loadPlanRecords(db, householdId, "2026-11");
		const months = await loadFreeCarryMonths(db, householdId, records, "2026-11");
		expect(months.map((m) => m.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
		expect(months[0]).toMatchObject({ carriedIn: 0, carriedOut: months[1]?.carriedIn });
		expect(months[1]?.carriedOut).toBe(
			await loadFreeCarriedIn(db, householdId, records, "2026-11"),
		);
		expect(months[2]?.carriedIn).toBe(months[1]?.carriedOut);
	});
});
