import { type DayKey, monthState, planForMonth } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addCover,
	addPersonalAllowance,
	addQuickAdd,
	archiveBucket,
	createHouseholdForParent,
	type Db,
	deleteTransaction,
	loadBucketUses,
	loadCharges,
	loadPlanRecords,
	loadSpending,
	loadSpendingEarlierInYear,
	loadTransaction,
	loadTransactionsPage,
	parentsWithPersonalAllowance,
	type SplitInput,
	setAllowance,
	setTakeHomePay,
	splitTransaction,
	updateTransaction,
	type Viewer,
} from "./index";
import { members } from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const month = "2026-09";
const alex: Viewer = { householdId, memberId: "alex" };
const sam: Viewer = { householdId, memberId: "sam" };

let db: Db;

const quickAdd = (
	by: Viewer,
	transactionId: string,
	bucketId: string,
	amountCents: number,
	note: string | null = null,
	date: DayKey = "2026-09-10",
) =>
	addQuickAdd(db, {
		householdId,
		transactionId,
		bucketId,
		date,
		amountCents,
		note,
		forMemberIds: [],
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
	await addBucket(db, {
		householdId,
		memberId: "alex",
		bucketId: "groceries",
		name: "Groceries",
		color: 1,
		month,
		allowanceCents: 120_000,
	});
	for (const [parent, allowanceCents] of [
		[alex, 20_000],
		[sam, 15_000],
	] as const) {
		await addPersonalAllowance(db, {
			householdId,
			memberId: parent.memberId,
			bucketId: `${parent.memberId}-pa`,
			name: `${parent.memberId}’s Personal Allowance`,
			color: 2,
			month,
			allowanceCents,
		});
	}
	await quickAdd(alex, "gift", "alex-pa", 4_200, "Birthday gift for Sam");
	await quickAdd(alex, "book", "alex-pa", 1_800, "Book", "2026-09-12");
	await quickAdd(alex, "milk", "groceries", 650);
	await quickAdd(sam, "coffee", "sam-pa", 500, "Coffee");
});

const transactionIds = async (viewer: Viewer, bucketId?: string) =>
	(await loadTransactionsPage(db, viewer, { month, bucketId, limit: 50 })).transactions.map(
		(t) => t.id,
	);

describe("Personal Allowance privacy: reads", () => {
	it("refuses the other Parent's Personal Allowance Transaction asked for by its ID", async () => {
		// Its own Parent gets it whole; the other Parent gets nothing, as in the list.
		expect(await loadTransaction(db, alex, "gift")).toMatchObject({
			id: "gift",
			amountCents: 4_200,
			note: "Birthday gift for Sam",
			bucketId: "alex-pa",
		});
		expect(await loadTransaction(db, sam, "gift")).toBeNull();
		expect(await loadTransaction(db, alex, "coffee")).toBeNull();
		// A shared Bucket's is both Parents'.
		expect(await loadTransaction(db, sam, "milk")).toMatchObject({ id: "milk", amountCents: 650 });
		// Another Household's, and one that isn't there.
		expect(await loadTransaction(db, { householdId: "other", memberId: "sam" }, "milk")).toBeNull();
		expect(await loadTransaction(db, alex, "nothing")).toBeNull();
	});

	it("gives one split partly into the other Parent's Personal Allowance only its other Splits", async () => {
		await splitTransaction(db, {
			householdId,
			memberId: "alex",
			transactionId: "milk",
			amountCents: 650,
			note: "Milk and a treat",
			splits: [
				{
					id: "milk-shared",
					amountCents: 400,
					assignment: { bucketId: "groceries" },
					forMemberIds: [],
				},
				{
					id: "milk-mine",
					amountCents: 250,
					assignment: { bucketId: "alex-pa" },
					forMemberIds: [],
				},
			],
		});
		const theirs = await loadTransaction(db, sam, "milk");
		expect(theirs).toMatchObject({ amountCents: 400, note: null, partlyPrivate: true });
		expect(theirs?.splits.map((split) => split.id)).toEqual(["milk-shared"]);
		expect(await loadTransaction(db, alex, "milk")).toMatchObject({
			amountCents: 650,
			partlyPrivate: false,
		});
	});

	it("gives the other Parent only a Personal Allowance's total, never its Transactions", async () => {
		const spending = await loadSpending(db, sam, month);
		expect(spending.map((s) => s.id).sort()).toEqual(["coffee", "milk", "private:alex-pa:2026-09"]);
		expect(spending.find((s) => s.bucketId === "alex-pa")).toEqual({
			id: "private:alex-pa:2026-09",
			bucketId: "alex-pa",
			amount: 6_000,
			date: "2026-09-01",
			for: [],
		});
		const serialized = JSON.stringify(spending);
		expect(serialized).not.toContain("gift");
		expect(serialized).not.toContain("2026-09-12");
	});

	it("gives the owner every Transaction in their own Personal Allowance", async () => {
		const spending = await loadSpending(db, alex, month);
		expect(spending.map((s) => s.id).sort()).toEqual([
			"book",
			"gift",
			"milk",
			"private:sam-pa:2026-09",
		]);
	});

	it("leaves both Parents with the same allowance, spent, and left for every Bucket", async () => {
		const plan = planForMonth(await loadPlanRecords(db, householdId, month), month);
		const stateFor = async (viewer: Viewer) =>
			monthState({ plan, spending: await loadSpending(db, viewer, month), asOf: "2026-09-15" })
				.buckets;
		const pick = (buckets: Awaited<ReturnType<typeof stateFor>>) =>
			buckets.map(({ id, owner, allowance, spent, left }) => ({
				id,
				owner,
				allowance,
				spent,
				left,
			}));
		expect(pick(await stateFor(sam))).toEqual(pick(await stateFor(alex)));
		expect(pick(await stateFor(sam))).toContainEqual({
			id: "alex-pa",
			owner: "alex",
			allowance: 20_000,
			spent: 6_000,
			left: 14_000,
		});
	});

	it("keeps earlier months' private spending to totals too", async () => {
		const spending = await loadSpendingEarlierInYear(db, sam, "2026-10");
		expect(spending.filter((s) => s.bucketId === "alex-pa")).toEqual([
			{
				id: "private:alex-pa:2026-09",
				bucketId: "alex-pa",
				amount: 6_000,
				date: "2026-09-01",
				for: [],
			},
		]);
	});

	it("leaves the other Parent's Personal Allowance out of the Transactions list and its filters", async () => {
		expect(await transactionIds(sam)).toEqual(["milk", "coffee"]);
		expect(await transactionIds(sam, "alex-pa")).toEqual([]);
		expect(await transactionIds(alex)).toEqual(["book", "milk", "gift"]);
		expect(await transactionIds(alex, "alex-pa")).toEqual(["book", "gift"]);
	});

	it("leaves the other Parent's Personal Allowance out of Quick Add's likely Buckets", async () => {
		const uses = await loadBucketUses(db, sam, "2026-09-01");
		expect(uses.map((u) => u.bucketId).sort()).toEqual(["groceries", "sam-pa"]);
	});
});

describe("Personal Allowance privacy: writes", () => {
	it("takes Quick Adds only from its own Parent", async () => {
		expect(await quickAdd(sam, "sneaky", "alex-pa", 100)).toEqual({
			ok: false,
			reason: "bucket-not-in-plan",
		});
		expect(await quickAdd(alex, "lunch", "alex-pa", 1_200)).toEqual({
			ok: true,
			matchedMonths: [],
		});
	});

	it("lets its owner move a Transaction into and out of it", async () => {
		const move = (bucketId: string) =>
			updateTransaction(db, {
				householdId,
				memberId: "alex",
				transactionId: "milk",
				amountCents: 650,
				assignment: { bucketId },
				note: null,
				forMemberIds: [],
			});
		expect(await move("alex-pa")).toMatchObject({ ok: true });
		expect(await transactionIds(sam)).toEqual(["coffee"]);
		expect(await move("groceries")).toMatchObject({ ok: true });
		expect(await transactionIds(sam)).toEqual(["milk", "coffee"]);
	});

	it("never lets the other Parent assign to it, or edit or delete what's in it", async () => {
		const edit = (transactionId: string, bucketId: string, amountCents: number, note: string) =>
			updateTransaction(db, {
				householdId,
				memberId: "sam",
				transactionId,
				amountCents,
				assignment: { bucketId },
				note,
				forMemberIds: ["sam"],
			});
		expect(await edit("coffee", "alex-pa", 500, "Coffee")).toEqual({
			ok: false,
			reason: "not-in-plan",
		});
		// Even with the values it already has, so nothing (not its For) can change.
		expect(await edit("gift", "alex-pa", 4_200, "Birthday gift for Sam")).toEqual({
			ok: false,
			reason: "not-in-plan",
		});
		expect(await edit("gift", "groceries", 1, "Found it")).toEqual({
			ok: false,
			reason: "not-in-plan",
		});
		await deleteTransaction(db, { householdId, memberId: "sam", transactionId: "gift" });
		const own = await loadTransactionsPage(db, alex, { month, bucketId: "alex-pa", limit: 50 });
		expect(own.transactions).toContainEqual(
			expect.objectContaining({ id: "gift", amountCents: 4_200, for: [] }),
		);
	});

	it("is set only by its own Parent, and stays in the Plan", async () => {
		await setAllowance(db, {
			householdId,
			memberId: "sam",
			bucketId: "alex-pa",
			month,
			amountCents: 0,
		});
		await archiveBucket(db, { householdId, memberId: "alex", bucketId: "alex-pa", month });
		await setAllowance(db, {
			householdId,
			memberId: "alex",
			bucketId: "alex-pa",
			month,
			amountCents: 25_000,
		});
		const plan = planForMonth(await loadPlanRecords(db, householdId, month), month);
		expect(plan.buckets.find((b) => b.id === "alex-pa")?.allowance).toBe(25_000);
	});

	it("is one per Parent", async () => {
		await addPersonalAllowance(db, {
			householdId,
			memberId: "alex",
			bucketId: "alex-pa-2",
			name: "Another",
			color: 3,
			month,
			allowanceCents: 1_000,
		});
		const plan = planForMonth(await loadPlanRecords(db, householdId, month), month);
		expect(plan.buckets.filter((b) => b.owner === "alex").map((b) => b.id)).toEqual(["alex-pa"]);
	});

	it("is Covered, and Covered from, only by its own Parent", async () => {
		const cover = (by: string, fromBucketId: string | null, toBucketId: string) =>
			addCover(db, {
				householdId,
				moveId: `${by}-${fromBucketId}-${toBucketId}`,
				month,
				fromBucketId,
				toBucketId,
				amountCents: 100,
				createdByMemberId: by,
			});
		expect(await cover("sam", null, "alex-pa")).toEqual({ ok: false, reason: "refused" });
		expect(await cover("sam", "alex-pa", "groceries")).toEqual({ ok: false, reason: "refused" });
		expect(await cover("alex", "alex-pa", "groceries")).toMatchObject({ ok: true });
	});
});

describe("Personal Allowance privacy: Splits", () => {
	const part = (
		id: string,
		amountCents: number,
		bucketId: string,
		...forMemberIds: string[]
	): SplitInput => ({ id, amountCents, assignment: { bucketId }, forMemberIds });
	const split = (by: Viewer, transactionId: string, splits: SplitInput[], note: string | null) =>
		splitTransaction(db, {
			householdId,
			memberId: by.memberId,
			transactionId,
			amountCents: splits.reduce((sum, s) => sum + s.amountCents, 0),
			note,
			splits,
		});
	const page = async (viewer: Viewer) =>
		(await loadTransactionsPage(db, viewer, { month, limit: 50 })).transactions;

	// A $100 Target run: $30 of it a gift in Alex's Personal Allowance, $70 groceries.
	beforeEach(async () => {
		await quickAdd(alex, "target", "groceries", 10_000, "Target: gift for Sam", "2026-09-14");
		expect(
			await split(
				alex,
				"target",
				[part("target-gift", 3_000, "alex-pa"), part("target-food", 7_000, "groceries", "sam")],
				"Target: gift for Sam",
			),
		).toMatchObject({ ok: true });
	});

	it("folds a Split in the other Parent's Personal Allowance into its total", async () => {
		const spending = await loadSpending(db, sam, month);
		expect(spending.filter((s) => s.id === "target")).toEqual([
			{ id: "target", bucketId: "groceries", amount: 7_000, date: "2026-09-14", for: ["sam"] },
		]);
		expect(spending.find((s) => s.bucketId === "alex-pa")).toEqual({
			id: "private:alex-pa:2026-09",
			bucketId: "alex-pa",
			amount: 9_000,
			date: "2026-09-01",
			for: [],
		});
		const serialized = JSON.stringify(spending);
		expect(serialized).not.toContain("target-gift");
		expect(serialized).not.toContain("3000");
		// The owner sees both Splits one by one.
		expect(
			(await loadSpending(db, alex, month)).filter((s) => s.id === "target").map((s) => s.amount),
		).toEqual([3_000, 7_000]);
	});

	it("shows the other Parent a mixed Transaction as only its other Splits, with no note", async () => {
		const seen = (await page(sam)).find((t) => t.id === "target");
		expect(seen).toEqual({
			id: "target",
			date: "2026-09-14",
			amountCents: 7_000,
			bucketId: null,
			commitmentId: null,
			goal: null,
			merchantName: null,
			note: null,
			importedFrom: null,
			pending: false,
			matchedIn: null,
			transfer: null,
			refundOf: null,
			autoFiled: null,
			version: 1,
			for: [],
			splits: [
				{
					id: "target-food",
					amountCents: 7_000,
					bucketId: "groceries",
					commitmentId: null,
					goal: null,
					for: ["sam"],
				},
			],
			// Only so Sam's edit sheet doesn't offer changes Sam can't make; nothing of the private part.
			partlyPrivate: true,
		});
		expect(JSON.stringify(await page(sam))).not.toContain("gift");
		expect(await transactionIds(sam, "alex-pa")).toEqual([]);
		expect(await transactionIds(sam, "groceries")).toContain("target");
		const own = (await page(alex)).find((t) => t.id === "target");
		expect(own?.amountCents).toBe(10_000);
		expect(own?.note).toBe("Target: gift for Sam");
		expect(own?.splits.map((s) => s.id)).toEqual(["target-gift", "target-food"]);
		// Alex's own Personal Allowance isn't private from Alex.
		expect(own?.partlyPrivate).toBe(false);
		expect((await page(sam)).filter((t) => t.partlyPrivate).map((t) => t.id)).toEqual(["target"]);
		expect(await transactionIds(alex, "alex-pa")).toContain("target");
	});

	it("hides a Transaction split only into the other Parent's Personal Allowance", async () => {
		await quickAdd(alex, "etsy", "groceries", 5_000, "Etsy", "2026-09-15");
		await split(
			alex,
			"etsy",
			[part("etsy-1", 2_000, "alex-pa"), part("etsy-2", 3_000, "alex-pa")],
			"Etsy",
		);
		expect((await page(sam)).map((t) => t.id)).not.toContain("etsy");
		expect(await loadCharges(db, sam, month)).toEqual([]);
		const uses = await loadBucketUses(db, sam, "2026-09-01");
		expect(uses.some((u) => u.bucketId === "alex-pa")).toBe(false);
		const sept14 = uses.filter((u) => u.date === "2026-09-14");
		// Each use knows the hour it was entered and its merchant, for Quick Add's order (ADR-0031).
		expect(sept14.every((u) => typeof u.hour === "number" && u.hour >= 0 && u.hour < 24)).toBe(
			true,
		);
		expect(sept14.map((u) => u.merchant)).toEqual(["target gift for sam"]);
		expect(sept14.map(({ bucketId, date }) => ({ bucketId, date }))).toEqual([
			{ bucketId: "groceries", date: "2026-09-14" },
		]);
		expect((await loadSpending(db, sam, month)).find((s) => s.bucketId === "alex-pa")?.amount).toBe(
			14_000,
		);
	});

	it("never lets the other Parent split into it, or change or delete a mixed Transaction", async () => {
		expect(
			await split(sam, "milk", [part("m1", 300, "groceries"), part("m2", 350, "alex-pa")], null),
		).toEqual({ ok: false, reason: "not-in-plan" });
		expect((await page(sam)).find((t) => t.id === "milk")?.splits).toEqual([]);
		expect(
			await split(
				sam,
				"target",
				[part("t1", 5_000, "groceries"), part("t2", 2_000, "sam-pa")],
				"Mine now",
			),
		).toEqual({ ok: false, reason: "not-in-plan" });
		expect(
			await updateTransaction(db, {
				householdId,
				memberId: "sam",
				transactionId: "target",
				amountCents: 7_000,
				assignment: { bucketId: "groceries" },
				note: null,
				forMemberIds: [],
			}),
		).toEqual({ ok: false, reason: "not-in-plan" });
		await deleteTransaction(db, { householdId, memberId: "sam", transactionId: "target" });
		const own = (await page(alex)).find((t) => t.id === "target");
		expect(own?.amountCents).toBe(10_000);
		expect(own?.splits.map((s) => s.id)).toEqual(["target-gift", "target-food"]);
		// Alex's own Personal Allowance isn't private from Alex.
		expect(own?.partlyPrivate).toBe(false);
		expect((await page(sam)).filter((t) => t.partlyPrivate).map((t) => t.id)).toEqual(["target"]);
		// Its owner still can.
		await deleteTransaction(db, { householdId, memberId: "alex", transactionId: "target" });
		expect((await page(alex)).map((t) => t.id)).not.toContain("target");
	});
});

describe("Personal Allowance privacy: who has one (#72)", () => {
	it("tells which Parents have one and nothing else, never the amount", async () => {
		const owners = await parentsWithPersonalAllowance(db, householdId);
		expect([...owners].sort()).toEqual(["alex", "sam"]);
		expect(owners.every((owner) => typeof owner === "string")).toBe(true);
		expect(JSON.stringify(owners)).not.toMatch(/15000|20000|Allowance/);
	});

	it("leaves out a Parent who hasn't set one, and other Households' Parents", async () => {
		await createHouseholdForParent(db, {
			clerkUserId: "clerk-pat",
			householdId: "other",
			householdName: "The Others",
			timeZone: "America/Chicago",
			parentId: "pat",
			parentName: "Pat",
		});
		expect(await parentsWithPersonalAllowance(db, "other")).toEqual([]);
		expect(await parentsWithPersonalAllowance(db, householdId)).not.toContain("pat");
	});
});
