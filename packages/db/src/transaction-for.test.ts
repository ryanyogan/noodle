import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addChild,
	addPersonalAllowance,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	loadTransaction,
	setTakeHomePay,
	setTransactionFor,
	splitTransaction,
} from "./index";
import { members, splitFor, transactionFor, transactions } from "./schema";
import { testDb } from "./test-db";

// Who a Transaction is For, changed alone (issue 141): on a row with no Bucket, and on a split
// one, without touching what it is assigned to.

const householdId = "household";
const month = "2026-09";
const alex = { householdId, memberId: "alex" };
const sam = { householdId, memberId: "sam" };

let db: Db;

const quickAdd = (
	by: typeof alex,
	transactionId: string,
	bucketId: string,
	forMemberIds: string[],
) =>
	addQuickAdd(db, {
		householdId,
		transactionId,
		bucketId,
		date: "2026-09-12",
		amountCents: 25_000,
		note: transactionId,
		forMemberIds,
		createdByMemberId: by.memberId,
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
	await setTakeHomePay(db, { householdId, memberId: "alex", month, amountCents: 900_000 });
	for (const [bucketId, color] of [
		["groceries", 1],
		["hockey", 3],
	] as const)
		await addBucket(db, {
			householdId,
			memberId: "alex",
			bucketId,
			name: bucketId,
			color,
			month,
			allowanceCents: 120_000,
		});
	for (const parent of [alex, sam])
		await addPersonalAllowance(db, {
			householdId,
			memberId: parent.memberId,
			bucketId: `${parent.memberId}-pa`,
			name: `${parent.memberId}’s Personal Allowance`,
			color: 2,
			month,
			allowanceCents: 20_000,
		});
	await addChild(db, { householdId, memberId: "leo", name: "Leo", color: 3 });
	await addChild(db, { householdId, memberId: "maya", name: "Maya", color: 4 });
	// An unassigned line, as the bank's sync leaves one.
	await quickAdd(alex, "costco", "groceries", []);
	await db
		.update(transactions)
		.set({ bucketId: null, version: 3 })
		.where(eq(transactions.id, "costco"));
});

const split = (id: string, bucketId: string, ...forMemberIds: string[]) => ({
	id,
	amountCents: 12_500,
	assignment: { bucketId },
	forMemberIds,
});

const splitCostco = (by: typeof alex, ...parts: ReturnType<typeof split>[]) =>
	splitTransaction(db, {
		householdId,
		memberId: by.memberId,
		transactionId: "costco",
		amountCents: 25_000,
		note: "costco",
		splits: parts,
	});

const row = (viewer = alex) => loadTransaction(db, viewer, "costco");

describe("setTransactionFor", () => {
	it("says who an unassigned Transaction is For and leaves it unassigned", async () => {
		const result = await setTransactionFor(db, {
			...alex,
			transactionId: "costco",
			forMemberIds: ["maya", "leo"],
			expectedVersion: 3,
		});
		expect(result).toEqual({ ok: true, version: 4 });
		const after = await row();
		expect(after).toMatchObject({ bucketId: null, commitmentId: null, version: 4 });
		expect(after?.for.sort()).toEqual(["leo", "maya"]);
	});

	it("goes back to Everyone, and keeps the Bucket of a filed one", async () => {
		await quickAdd(alex, "milk", "groceries", ["maya"]);
		const result = await setTransactionFor(db, {
			...alex,
			transactionId: "milk",
			forMemberIds: [],
			expectedVersion: 0,
		});
		expect(result).toEqual({ ok: true, version: 1 });
		const after = await loadTransaction(db, alex, "milk");
		expect(after).toMatchObject({ bucketId: "groceries", for: [], amountCents: 25_000 });
	});

	it("is left alone when it was changed elsewhere, and a repeat of one that landed is saved", async () => {
		const stale = await setTransactionFor(db, {
			...alex,
			transactionId: "costco",
			forMemberIds: ["maya"],
			expectedVersion: 2,
		});
		expect(stale).toEqual({ ok: false, reason: "changed-elsewhere" });
		expect((await row())?.for).toEqual([]);

		const change = { ...alex, transactionId: "costco", forMemberIds: ["maya"], expectedVersion: 3 };
		expect(await setTransactionFor(db, change)).toEqual({ ok: true, version: 4 });
		expect(await setTransactionFor(db, change)).toEqual({ ok: true, version: 4 });
		expect((await row())?.version).toBe(4);

		// Another change took it to the same version with another For: not this change.
		const other = { ...change, forMemberIds: ["leo"] };
		expect(await setTransactionFor(db, other)).toEqual({ ok: false, reason: "changed-elsewhere" });
		expect((await row())?.for).toEqual(["maya"]);
	});

	it("ignores a Member who isn't the Household's", async () => {
		await setTransactionFor(db, {
			...alex,
			transactionId: "costco",
			forMemberIds: ["maya", "stranger"],
		});
		expect((await row())?.for).toEqual(["maya"]);
	});

	it("sets For on every Split when they have none or the same", async () => {
		await splitCostco(alex, split("s1", "groceries"), split("s2", "hockey", "leo"));
		const before = await row();
		const result = await setTransactionFor(db, {
			...alex,
			transactionId: "costco",
			forMemberIds: ["maya"],
			expectedVersion: before?.version,
		});
		expect(result).toMatchObject({ ok: true });
		const after = await row();
		expect(after?.splits.map((part) => [part.id, part.bucketId, part.for])).toEqual([
			["s1", "groceries", ["maya"]],
			["s2", "hockey", ["maya"]],
		]);
		// A split Transaction is For only through its Splits.
		expect(await db.select().from(transactionFor)).toEqual([]);

		await setTransactionFor(db, { ...alex, transactionId: "costco", forMemberIds: [] });
		expect(await db.select().from(splitFor)).toEqual([]);
	});

	it("refuses a split one whose Splits are For different people", async () => {
		await splitCostco(alex, split("s1", "groceries", "maya"), split("s2", "hockey", "leo"));
		const result = await setTransactionFor(db, {
			...alex,
			transactionId: "costco",
			forMemberIds: ["maya"],
		});
		expect(result).toEqual({ ok: false, reason: "for-differs" });
		expect((await row())?.splits.map((part) => part.for)).toEqual([["maya"], ["leo"]]);
	});

	for (const [owner, other] of [
		[alex, sam],
		[sam, alex],
	] as const) {
		it(`never touches what is in ${owner.memberId}'s Personal Allowance for ${other.memberId}`, async () => {
			await quickAdd(owner, "gift", `${owner.memberId}-pa`, []);
			const whole = await setTransactionFor(db, {
				...other,
				transactionId: "gift",
				forMemberIds: ["maya"],
				expectedVersion: 0,
			});
			expect(whole).toEqual({ ok: false, reason: "not-editable" });

			// And not through a Split of a mixed one.
			await splitTransaction(db, {
				householdId,
				memberId: owner.memberId,
				transactionId: "costco",
				amountCents: 25_000,
				note: "costco",
				splits: [split("s1", "groceries"), split("s2", `${owner.memberId}-pa`)],
			});
			const mixed = await setTransactionFor(db, {
				...other,
				transactionId: "costco",
				forMemberIds: ["maya"],
			});
			expect(mixed).toEqual({ ok: false, reason: "not-editable" });
			expect(await db.select().from(transactionFor)).toEqual([]);
			expect(await db.select().from(splitFor)).toEqual([]);

			// Its own Parent can.
			const mine = await setTransactionFor(db, {
				...owner,
				transactionId: "gift",
				forMemberIds: ["maya"],
				expectedVersion: 0,
			});
			expect(mine).toEqual({ ok: true, version: 1 });
		});
	}

	it("refuses Goal spending, another Household's, and one that is gone", async () => {
		expect(
			await setTransactionFor(db, {
				householdId: "elsewhere",
				memberId: "alex",
				transactionId: "costco",
				forMemberIds: ["maya"],
			}),
		).toEqual({ ok: false, reason: "not-editable" });
		expect(
			await setTransactionFor(db, { ...alex, transactionId: "nothing", forMemberIds: [] }),
		).toEqual({ ok: false, reason: "not-editable" });
	});
});
