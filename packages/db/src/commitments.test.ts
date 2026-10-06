import { comingUp, matchCharges, planForMonth } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addCommitment,
	addCommitmentPayment,
	addPersonalAllowance,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	loadChargesBetween,
	loadPlanRecords,
	loadSuggestionInputs,
	splitTransaction,
	updateCommitment,
	type Viewer,
} from "./index";
import { members } from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const alex: Viewer = { householdId, memberId: "alex" };
const sam: Viewer = { householdId, memberId: "sam" };

let db: Db;

const pay = (transactionId: string, commitmentId: string, amountCents: number, date: string) =>
	addCommitmentPayment(db, {
		householdId,
		transactionId,
		commitmentId,
		date: date as `${number}-${number}-${number}`,
		amountCents,
		createdByMemberId: "alex",
	});

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
	await addCommitment(db, {
		householdId,
		memberId: "alex",
		commitmentId: "daycare",
		name: "Daycare",
		month: "2026-09",
		amountCents: 60_000,
		cadence: "biweekly",
		dueDate: "2026-09-04",
	});
	await addCommitment(db, {
		householdId,
		memberId: "alex",
		commitmentId: "insurance",
		name: "Car insurance",
		month: "2026-09",
		amountCents: 114_000,
		cadence: "annual",
		dueDate: "2026-10-15",
	});
});

describe("a Commitment whose amount is about", () => {
	const power = {
		householdId,
		memberId: "alex",
		commitmentId: "power",
		name: "Power",
		month: "2026-09",
		amountCents: 16_000,
		cadence: "monthly",
		dueDate: "2026-09-12",
	} as const;
	const about = async (id: string) =>
		(await loadPlanRecords(db, householdId, "2026-10")).commitments.find((c) => c.id === id)?.about;

	it("is the same each time unless said, and about when a Parent says so", async () => {
		await addCommitment(db, { ...power, about: true });
		expect(await about("power")).toBe(true);
		expect(await about("daycare")).toBe(false);
		expect(
			planForMonth(await loadPlanRecords(db, householdId, "2026-10"), "2026-10").commitments.map(
				(c) => [c.id, c.about],
			),
		).toEqual(
			expect.arrayContaining([
				["power", true],
				["daycare", undefined],
			]),
		);
	});

	it("changes only when an edit says which, in every month", async () => {
		await addCommitment(db, power);
		await updateCommitment(db, { ...power, month: "2026-10", amountCents: 17_000, about: true });
		expect(await about("power")).toBe(true);
		// A save that doesn't say (a new amount from a Suggestion) leaves it about.
		await updateCommitment(db, { ...power, month: "2026-10", amountCents: 18_000 });
		expect(await about("power")).toBe(true);
		await updateCommitment(db, { ...power, month: "2026-10", amountCents: 18_000, about: false });
		expect(await about("power")).toBe(false);
	});

	it("is told to the suggestion run", async () => {
		await addCommitment(db, { ...power, about: true });
		const inputs = await loadSuggestionInputs(db, householdId, "2025-09-01", "2026-10");
		expect(inputs.commitments.map((c) => [c.id, c.about])).toEqual(
			expect.arrayContaining([
				["power", true],
				["daycare", false],
			]),
		);
	});
});

describe("Commitment charges over a range of days", () => {
	it("loads every charge from one day to another, across months, by date", async () => {
		await pay("t1", "daycare", 60_000, "2026-09-18");
		await pay("t2", "daycare", 60_000, "2026-10-02");
		await pay("t3", "insurance", 114_000, "2026-10-14");
		await pay("t4", "daycare", 60_000, "2026-10-16");
		const charges = await loadChargesBetween(db, alex, "2026-09-18", "2026-10-15");
		expect(charges.map((c) => [c.id, c.commitmentId, c.date])).toEqual([
			["t1", "daycare", "2026-09-18"],
			["t2", "daycare", "2026-10-02"],
			["t3", "insurance", "2026-10-14"],
		]);
	});

	it("feeds Coming up and each charge's on-time status", async () => {
		await pay("t1", "daycare", 60_000, "2026-10-01");
		await pay("t2", "daycare", 30_000, "2026-10-16");
		await pay("t3", "insurance", 114_000, "2026-10-20");
		const records = await loadPlanRecords(db, householdId, "2027-09");
		const charges = await loadChargesBetween(db, alex, "2026-09-01", "2026-10-31");
		expect(
			comingUp(records, charges, "2026-10-01", 30).map((d) => [d.date, d.name, d.status]),
		).toEqual([
			["2026-10-02", "Daycare", "paid"],
			["2026-10-15", "Car insurance", "paid"],
			["2026-10-16", "Daycare", "partly-paid"],
			["2026-10-30", "Daycare", "due"],
		]);
		expect(
			matchCharges(records, "insurance", charges).map((c) => [c.date, c.dueDate, c.onTime]),
		).toEqual([["2026-10-20", "2026-10-15", false]]);
	});

	it("shows the other Parent a charge in a Transaction partly in a Personal Allowance, without the private part", async () => {
		await addBucket(db, {
			householdId,
			memberId: "alex",
			bucketId: "groceries",
			name: "Groceries",
			color: 1,
			month: "2026-09",
			allowanceCents: 100_000,
		});
		await addPersonalAllowance(db, {
			householdId,
			memberId: "alex",
			bucketId: "alex-pa",
			name: "Alex’s Personal Allowance",
			color: 2,
			month: "2026-09",
			allowanceCents: 20_000,
		});
		await addQuickAdd(db, {
			householdId,
			transactionId: "mixed",
			bucketId: "groceries",
			date: "2026-09-18",
			amountCents: 65_000,
			note: "Daycare and a gift",
			forMemberIds: [],
			createdByMemberId: "alex",
		});
		await splitTransaction(db, {
			householdId,
			memberId: "alex",
			transactionId: "mixed",
			amountCents: 65_000,
			note: "Daycare and a gift",
			splits: [
				{
					id: "s1",
					amountCents: 60_000,
					assignment: { commitmentId: "daycare" },
					forMemberIds: [],
				},
				{ id: "s2", amountCents: 5_000, assignment: { bucketId: "alex-pa" }, forMemberIds: [] },
			],
		});
		// Sam sees the Daycare charge, and nothing of the Personal Allowance part or the note.
		const own = await loadChargesBetween(db, alex, "2026-09-01", "2026-09-30");
		const seen = await loadChargesBetween(db, sam, "2026-09-01", "2026-09-30");
		expect(own).toEqual([
			{ id: "mixed", commitmentId: "daycare", amount: 60_000, date: "2026-09-18" },
		]);
		expect(seen).toEqual(own);
		expect(JSON.stringify(seen)).not.toContain("gift");
	});
});
