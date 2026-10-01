import { type DayKey, type MonthKey, monthState, planForMonth } from "@noodle/domain";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addChild,
	addCommitment,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	deleteTransaction,
	loadBucketUses,
	loadCharges,
	loadPlanRecords,
	loadSpending,
	loadTransactionsPage,
	type SplitInput,
	setAllowance,
	setBaseline,
	splitTransaction,
	updateTransaction,
} from "./index";
import { bucketLeftSql } from "./moves";
import { setCarriesOver } from "./plan";
import { loadRolledOver } from "./rollover";
import { testDb } from "./test-db";

const householdId = "household";
const parentId = "parent";
const month = "2026-09";
const viewer = { householdId, memberId: parentId };

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
	await setBaseline(db, { householdId, memberId: parentId, month, amountCents: 900_000 });
	for (const [bucketId, color, allowanceCents] of [
		["groceries", 1, 120_000],
		["hockey", 2, 40_000],
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
		commitmentId: "daycare",
		name: "Daycare",
		month,
		amountCents: 60_000,
		cadence: "monthly",
		dueDate: "2026-09-04",
	});
	await addChild(db, { householdId, memberId: "leo", name: "Leo", color: 3 });
	await addChild(db, { householdId, memberId: "maya", name: "Maya", color: 4 });
	// A $250 Costco trip, Quick Added into Groceries For Maya.
	await addQuickAdd(db, {
		householdId,
		transactionId: "costco",
		bucketId: "groceries",
		date: "2026-09-12",
		amountCents: 25_000,
		note: "Costco",
		forMemberIds: ["maya"],
		createdByMemberId: parentId,
	});
});

const split = (
	id: string,
	amountCents: number,
	assignment: SplitInput["assignment"],
	...forMemberIds: string[]
): SplitInput => ({ id, amountCents, assignment, forMemberIds });

const costcoSplits = [
	split("s1", 18_000, { bucketId: "groceries" }),
	split("s2", 7_000, { bucketId: "hockey" }, "leo"),
];

const splitCostco = (splits = costcoSplits, amountCents = 25_000) =>
	splitTransaction(db, {
		householdId,
		memberId: parentId,
		transactionId: "costco",
		amountCents,
		note: "Costco",
		splits,
	});

const page = (query: { bucketId?: string; forMember?: string } = {}) =>
	loadTransactionsPage(db, viewer, { month, limit: 50, ...query });

const count = async (table: string) => {
	const [row] = await db.all<{ n: number }>(sql.raw(`select count(*) as n from ${table}`));
	return (row as unknown as [number])[0];
};

describe("splitting a Transaction", () => {
	it("spends each Split from its own Bucket, For its own Members, instead of the whole", async () => {
		expect(await splitCostco()).toEqual({ ok: true });
		const spending = await loadSpending(db, viewer, month);
		expect(spending).toEqual([
			{ id: "costco", bucketId: "groceries", amount: 18_000, date: "2026-09-12", for: [] },
			{ id: "costco", bucketId: "hockey", amount: 7_000, date: "2026-09-12", for: ["leo"] },
		]);
		const { transactions } = await page();
		expect(transactions[0]).toMatchObject({
			bucketId: null,
			commitmentId: null,
			for: [],
			splits: [
				{ id: "s1", amountCents: 18_000, bucketId: "groceries", commitmentId: null, for: [] },
				{ id: "s2", amountCents: 7_000, bucketId: "hockey", commitmentId: null, for: ["leo"] },
			],
		});
	});

	it("is idempotent: a retry lands the same Splits once", async () => {
		await splitCostco();
		expect(await splitCostco()).toEqual({ ok: true });
		expect(await count("splits")).toBe(2);
		expect(await count("split_for")).toBe(1);
	});

	it("replaces earlier Splits, and their For, with new ones", async () => {
		await splitCostco();
		expect(
			await splitCostco(
				[
					split("s3", 10_000, { bucketId: "groceries" }, "maya"),
					split("s4", 10_000, { bucketId: "hockey" }, "leo", "maya"),
					split("s5", 6_000, { commitmentId: "daycare" }),
				],
				26_000,
			),
		).toEqual({ ok: true });
		expect((await page()).transactions[0]?.splits.map((s) => s.id)).toEqual(["s3", "s4", "s5"]);
		expect(await count("split_for")).toBe(3);
		expect(await loadCharges(db, viewer, month)).toEqual([
			{ id: "costco", commitmentId: "daycare", amount: 6_000, date: "2026-09-12" },
		]);
	});

	it("counts Splits paying the same Commitment as one charge of it", async () => {
		await splitCostco([
			split("s1", 20_000, { commitmentId: "daycare" }, "leo"),
			split("s2", 5_000, { commitmentId: "daycare" }, "maya"),
		]);
		expect(await loadCharges(db, viewer, month)).toEqual([
			{ id: "costco", commitmentId: "daycare", amount: 25_000, date: "2026-09-12" },
		]);
		expect(await loadSpending(db, viewer, month)).toEqual([]);
	});

	it("refuses Splits that don't add up to the amount, changing nothing", async () => {
		expect(await splitCostco([split("s1", 18_000, { bucketId: "groceries" })], 18_000)).toEqual({
			ok: false,
			reason: "splits-unbalanced",
		});
		expect(
			await splitCostco([
				split("s1", 18_000, { bucketId: "groceries" }),
				split("s2", 6_000, { bucketId: "hockey" }),
			]),
		).toEqual({ ok: false, reason: "splits-unbalanced" });
		expect(await count("splits")).toBe(0);
	});

	it("changes nothing when any Split's Bucket isn't in the Plan", async () => {
		await addBucket(db, {
			householdId,
			memberId: parentId,
			bucketId: "later",
			name: "Later",
			color: 5,
			month: "2026-10",
			allowanceCents: 1_000,
		});
		const result = await splitCostco([
			split("s1", 18_000, { bucketId: "groceries" }),
			split("s2", 7_000, { bucketId: "later" }),
		]);
		expect(result).toEqual({ ok: false, reason: "not-in-plan" });
		expect(await count("splits")).toBe(0);
		expect(await loadSpending(db, viewer, month)).toEqual([
			{ id: "costco", bucketId: "groceries", amount: 25_000, date: "2026-09-12", for: ["maya"] },
		]);
	});

	it("never attaches Splits to another Household's Transaction, or its Buckets", async () => {
		await createHouseholdForParent(db, {
			clerkUserId: "other-clerk-user",
			householdId: "other",
			householdName: "Others",
			timeZone: "America/Chicago",
			parentId: "other-parent",
			parentName: "Sam",
		});
		const fromOther = await splitTransaction(db, {
			householdId: "other",
			memberId: "other-parent",
			transactionId: "costco",
			amountCents: 25_000,
			note: "Costco",
			splits: costcoSplits,
		});
		expect(fromOther.ok).toBe(false);
		await addBucket(db, {
			householdId: "other",
			memberId: parentId,
			bucketId: "theirs",
			name: "Theirs",
			color: 1,
			month,
			allowanceCents: 1_000,
		});
		expect(
			(
				await splitCostco([
					split("s1", 18_000, { bucketId: "groceries" }),
					split("s2", 7_000, { bucketId: "theirs" }),
				])
			).ok,
		).toBe(false);
		expect(await count("splits")).toBe(0);
	});
});

describe("removing Splits", () => {
	it("returns the Transaction to a single assignment and For", async () => {
		await splitCostco();
		expect(
			await updateTransaction(db, {
				householdId,
				memberId: parentId,
				transactionId: "costco",
				amountCents: 25_000,
				assignment: { bucketId: "hockey" },
				note: "Costco",
				forMemberIds: ["leo"],
			}),
		).toEqual({ ok: true });
		expect(await count("splits")).toBe(0);
		expect(await count("split_for")).toBe(0);
		expect(await loadSpending(db, viewer, month)).toEqual([
			{ id: "costco", bucketId: "hockey", amount: 25_000, date: "2026-09-12", for: ["leo"] },
		]);
	});

	it("goes with the Transaction when it's deleted", async () => {
		await splitCostco();
		await deleteTransaction(db, { householdId, memberId: parentId, transactionId: "costco" });
		expect(await count("splits")).toBe(0);
		expect(await count("split_for")).toBe(0);
		expect(await count("transactions")).toBe(0);
	});
});

describe("the Transactions list's filters match Splits", () => {
	beforeEach(async () => {
		await splitCostco();
		await addQuickAdd(db, {
			householdId,
			transactionId: "rink",
			bucketId: "hockey",
			date: "2026-09-10" as DayKey,
			amountCents: 4_000,
			note: null,
			forMemberIds: [],
			createdByMemberId: parentId,
		});
	});

	const ids = async (query: { bucketId?: string; forMember?: string }) =>
		(await page(query)).transactions.map((t) => t.id);

	it.each([
		[{ bucketId: "groceries" }, ["costco"]],
		[{ bucketId: "hockey" }, ["costco", "rink"]],
		[{ forMember: "leo" }, ["costco"]],
		[{ forMember: "maya" }, []],
		[{ forMember: "everyone" }, ["costco", "rink"]],
		// Both must hold for one Split: Costco's Hockey Split is For Leo, not everyone.
		[{ bucketId: "hockey", forMember: "leo" }, ["costco"]],
		[{ bucketId: "hockey", forMember: "everyone" }, ["rink"]],
		[{ bucketId: "groceries", forMember: "leo" }, []],
	])("%j", async (query, expected) => {
		expect(await ids(query)).toEqual(expected);
	});
});

describe("Splits everywhere spending is summed", () => {
	it("keeps the Cover guard in step with the month's state", async () => {
		await splitCostco();
		const records = await loadPlanRecords(db, householdId, month);
		const state = monthState({
			plan: planForMonth(records, month),
			spending: await loadSpending(db, viewer, month),
			rolledOver: {},
			asOf: "2026-09-15",
		});
		const [row] = await db.all(sql`select ${bucketLeftSql(householdId, "hockey", month)} as left`);
		const hockey = state.buckets.find((b) => b.id === "hockey");
		expect(hockey?.left).toBe(33_000);
		expect((row as unknown as [number])[0]).toBe(33_000);
	});

	it("rolls a Rolling Bucket's leftover over after its Splits", async () => {
		await setCarriesOver(db, {
			householdId,
			memberId: parentId,
			bucketId: "hockey",
			month,
			rolling: true,
		});
		await splitCostco();
		const next: MonthKey = "2026-10";
		await setAllowance(db, {
			householdId,
			memberId: parentId,
			bucketId: "hockey",
			month: next,
			amountCents: 40_000,
		});
		const records = await loadPlanRecords(db, householdId, next);
		expect(await loadRolledOver(db, householdId, records, next)).toEqual({ hockey: 33_000 });
	});

	it("counts each Split in a Bucket as a use of it", async () => {
		await splitCostco();
		const uses = await loadBucketUses(db, viewer, "2026-09-01");
		expect(uses.map((use) => use.bucketId).sort()).toEqual(["groceries", "hockey"]);
	});
});
