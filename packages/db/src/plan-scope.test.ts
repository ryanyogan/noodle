import { type MonthKey, planForMonth } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addCommitment,
	addPersonalAllowance,
	createHouseholdForParent,
	type Db,
	loadPlanRecords,
	setAllowance,
	setTakeHomePay,
	updateCommitment,
} from "./index";
import { members } from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const month = "2026-09";

let db: Db;

const planFor = async (m: MonthKey) => planForMonth(await loadPlanRecords(db, householdId, m), m);

const allowances = async (bucketId: string, months: MonthKey[]) =>
	Promise.all(
		months.map(async (m) => (await planFor(m)).buckets.find((b) => b.id === bucketId)?.allowance),
	);

const allowance = (memberId: string, bucketId: string, m: MonthKey, amountCents: number) =>
	setAllowance(db, { householdId, memberId, bucketId, month: m, amountCents, scope: "just" });

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await db.insert(members).values({
		id: "sam",
		householdId,
		kind: "parent",
		name: "Sam",
		clerkUserId: "clerk-sam",
	});
	await setTakeHomePay(db, { householdId, memberId: "alex", month, amountCents: 900_000 });
	await addBucket(db, {
		householdId,
		memberId: "alex",
		bucketId: "groceries",
		name: "Groceries",
		color: 1,
		month,
		allowanceCents: 120_000,
	});
	await addPersonalAllowance(db, {
		householdId,
		memberId: "alex",
		bucketId: "alex-pa",
		name: "Alex’s Personal Allowance",
		color: 2,
		month,
		allowanceCents: 20_000,
	});
	await addCommitment(db, {
		householdId,
		memberId: "alex",
		commitmentId: "daycare",
		name: "Daycare",
		month,
		amountCents: 60_000,
		cadence: "monthly",
		dueDate: "2026-09-05",
	});
});

describe("Just <Month>: a change to the Plan for one month", () => {
	it("puts the next month back to the allowance in force before", async () => {
		await allowance("alex", "groceries", "2026-10", 150_000);
		expect(await allowances("groceries", ["2026-09", "2026-10", "2026-11", "2026-12"])).toEqual([
			120_000, 150_000, 120_000, 120_000,
		]);
	});

	it("keeps the next month's own allowance", async () => {
		await setAllowance(db, {
			householdId,
			memberId: "alex",
			bucketId: "groceries",
			month: "2026-11",
			amountCents: 90_000,
		});
		await allowance("alex", "groceries", "2026-10", 150_000);
		expect(await allowances("groceries", ["2026-10", "2026-11", "2026-12"])).toEqual([
			150_000, 90_000, 90_000,
		]);
	});

	it("changes the month's own allowance, and is the same when retried", async () => {
		await allowance("alex", "groceries", month, 100_000);
		await allowance("alex", "groceries", month, 100_000);
		expect(await allowances("groceries", ["2026-09", "2026-10"])).toEqual([100_000, 120_000]);
	});

	it("leaves later months as they were", async () => {
		await setAllowance(db, {
			householdId,
			memberId: "alex",
			bucketId: "groceries",
			month: "2026-12",
			amountCents: 80_000,
		});
		await allowance("alex", "groceries", "2026-10", 150_000);
		expect(await allowances("groceries", ["2026-11", "2026-12", "2027-01"])).toEqual([
			120_000, 80_000, 80_000,
		]);
	});

	it("refuses the other Parent's Personal Allowance, this month and next", async () => {
		await allowance("sam", "alex-pa", "2026-10", 0);
		const records = await loadPlanRecords(db, householdId, "2026-12");
		expect(records.allowances.filter((a) => a.bucketId === "alex-pa")).toEqual([
			{ bucketId: "alex-pa", month, amount: 20_000 },
		]);
		await allowance("alex", "alex-pa", "2026-10", 0);
		expect(await allowances("alex-pa", ["2026-10", "2026-11"])).toEqual([0, 20_000]);
	});

	it("puts the next month back to take-home pay in force before", async () => {
		await setTakeHomePay(db, {
			householdId,
			memberId: "alex",
			month: "2026-10",
			amountCents: 1_000_000,
			scope: "just",
		});
		expect(
			await Promise.all(
				(["2026-10", "2026-11"] as const).map(async (m) => (await planFor(m)).baseline),
			),
		).toEqual([1_000_000, 900_000]);
	});

	it("puts the next month back to a Commitment's terms in force before", async () => {
		await updateCommitment(db, {
			householdId,
			memberId: "alex",
			commitmentId: "daycare",
			name: "Daycare and camp",
			month: "2026-10",
			amountCents: 90_000,
			cadence: "monthly",
			dueDate: "2026-10-10",
			scope: "just",
		});
		const [october, november] = await Promise.all(
			(["2026-10", "2026-11"] as const).map(async (m) => (await planFor(m)).commitments),
		);
		expect(october).toEqual([
			{
				id: "daycare",
				name: "Daycare and camp",
				amount: 90_000,
				cadence: "monthly",
				dueDate: "2026-10-10",
			},
		]);
		expect(november).toEqual([
			{
				id: "daycare",
				name: "Daycare and camp",
				amount: 60_000,
				cadence: "monthly",
				dueDate: "2026-09-05",
			},
		]);
	});

	it("refuses another Household's Commitment", async () => {
		await updateCommitment(db, {
			householdId: "elsewhere",
			memberId: "alex",
			commitmentId: "daycare",
			name: "Taken",
			month: "2026-10",
			amountCents: 1,
			cadence: "monthly",
			dueDate: "2026-10-10",
			scope: "just",
		});
		const records = await loadPlanRecords(db, householdId, "2026-12");
		expect(records.commitmentTerms.map((t) => t.month)).toEqual([month]);
	});
});
