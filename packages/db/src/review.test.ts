import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { fileCategorizations, settleCategorization } from "./categorize";
import {
	addAccount,
	addBucket,
	addPersonalAllowance,
	createHouseholdForParent,
	setTakeHomePay,
} from "./index";
import { loadReview, returnToReview } from "./review";
import { applyRule, deleteRule, editRule, listRules, loadRules, saveRule } from "./rules";
import {
	categorizations,
	matches,
	members,
	rules,
	splits,
	transactionFor,
	transactions,
	transfers,
} from "./schema";
import { testDb } from "./test-db";
import { updateTransaction } from "./transactions";

const householdId = "household";
const month = "2026-09";
const alex = { householdId, memberId: "alex" };
const sam = { householdId, memberId: "sam" };

let db: ReturnType<typeof testDb>;
const eqId = (id: string) => eq(transactions.id, id);

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
	await db.insert(members).values([
		{ id: "sam", householdId, kind: "parent", name: "Sam", clerkUserId: "clerk-sam" },
		{ id: "maya", householdId, kind: "child", name: "Maya" },
	]);
	await setTakeHomePay(db, { householdId, memberId: "alex", month, amountCents: 900_000 });
	for (const [bucketId, name] of [
		["groceries", "Groceries"],
		["fun", "Fun"],
	] as const) {
		await addBucket(db, {
			householdId,
			memberId: "alex",
			bucketId,
			name,
			color: 1,
			month,
			allowanceCents: 50_000,
		});
	}
	for (const memberId of ["alex", "sam"]) {
		await addPersonalAllowance(db, {
			householdId,
			memberId,
			bucketId: `${memberId}-pa`,
			name: `${memberId}'s own`,
			color: 2,
			month,
			allowanceCents: 20_000,
		});
	}
	await addAccount(db, {
		householdId,
		accountId: "card",
		name: "Visa",
		kind: "credit-card",
		balanceCents: 0,
		balanceId: "balance-card",
		createdByMemberId: "alex",
	});
});

/** An imported Transaction, unassigned, with what categorization recorded for it (if anything). */
async function imported(
	id: string,
	note: string,
	categorized?: { outcome: "filed" | "review"; bucketId?: string; confidence?: number },
	date = "2026-09-10",
) {
	await db.insert(transactions).values({
		id,
		householdId,
		source: "import",
		date,
		amountCents: 4_200,
		note,
		accountId: "card",
		createdByMemberId: "alex",
	});
	if (categorized) {
		await db.insert(categorizations).values({
			transactionId: id,
			householdId,
			memberId: "alex",
			outcome: categorized.outcome,
			bucketId: categorized.bucketId ?? null,
			confidence: categorized.confidence ?? null,
			merchant: note.toLowerCase(),
		});
	}
}

const reviewIds = async (viewer = alex) =>
	(await loadReview(db, viewer, 50)).items.map((item) => item.id);

describe("the Review queue", () => {
	it("holds unassigned Transactions categorization left for Review, oldest first, with the guess", async () => {
		await imported("t2", "lego store", { outcome: "review", bucketId: "fun", confidence: 0.6 });
		await imported("t1", "corner deli", { outcome: "review" }, "2026-09-02");
		await imported("t3", "costco", { outcome: "filed", bucketId: "groceries" });
		await imported("t4", "never categorized");

		const queue = await loadReview(db, alex, 50);

		expect(queue.total).toBe(2);
		expect(queue.items.map((item) => [item.id, item.guess])).toEqual([
			["t1", null],
			["t2", { bucketId: "fun", name: "Fun", confidence: 0.6 }],
		]);
		expect(queue.items[1]).toMatchObject({
			merchant: "lego store",
			importedFrom: "Visa",
			amountCents: 4_200,
			bucketId: null,
		});
		// The same for either Parent: nothing in it is private.
		expect(await reviewIds(sam)).toEqual(["t1", "t2"]);
	});

	it("counts only what counts: never a Match's bank copy, a Transfer's side, or one split or assigned", async () => {
		for (const id of ["copy", "side", "split", "assigned", "waiting"]) {
			await imported(id, id, { outcome: "review" });
		}
		await db.insert(transactions).values({
			id: "quick",
			householdId,
			source: "quick-add",
			date: "2026-09-10",
			amountCents: 4_200,
			bucketId: "fun",
		});
		await db
			.insert(matches)
			.values({ id: "m", householdId, quickAddId: "quick", importedId: "copy" });
		await db.insert(transfers).values({ id: "x", householdId, outTransactionId: "side" });
		await db.insert(splits).values({
			id: "s",
			householdId,
			transactionId: "split",
			amountCents: 4_200,
			bucketId: "fun",
			position: 0,
		});
		await db.update(transactions).set({ bucketId: "groceries" }).where(eqId("assigned"));

		expect(await reviewIds()).toEqual(["waiting"]);
		expect((await loadReview(db, alex, 50)).total).toBe(1);
	});

	it("never shows another Parent's Personal Allowance, even as a guess", async () => {
		await imported("t1", "sephora", { outcome: "review", bucketId: "alex-pa", confidence: 0.5 });
		await imported("t2", "ulta", { outcome: "review" });
		await db.update(transactions).set({ bucketId: "alex-pa" }).where(eqId("t2"));

		expect((await loadReview(db, sam, 50)).items).toEqual([
			expect.objectContaining({ id: "t1", guess: null }),
		]);
	});

	it("keeps the total while showing at most `limit`", async () => {
		for (const id of ["a", "b", "c"]) await imported(id, id, { outcome: "review" });
		expect(await loadReview(db, alex, 2)).toMatchObject({
			total: 3,
			items: [{ id: "a" }, { id: "b" }],
		});
	});
});

describe("clearing Review", () => {
	it("settles a confirmed Transaction out of Review, and an undo puts it back as it was", async () => {
		await imported("t1", "lego store", { outcome: "review", bucketId: "fun", confidence: 0.6 });
		const confirmed = await updateTransaction(db, {
			householdId,
			memberId: "sam",
			transactionId: "t1",
			amountCents: 4_200,
			assignment: { bucketId: "fun" },
			note: "lego store",
			forMemberIds: ["maya"],
		});
		expect(confirmed.ok).toBe(true);
		await settleCategorization(db, householdId, "t1");
		expect(await reviewIds()).toEqual([]);

		await returnToReview(db, sam, {
			transactionId: "t1",
			merchant: "lego store",
			guess: { bucketId: "fun", confidence: 0.6 },
			forMemberIds: [],
		});

		expect((await loadReview(db, alex, 50)).items).toEqual([
			expect.objectContaining({
				id: "t1",
				for: [],
				guess: { bucketId: "fun", name: "Fun", confidence: 0.6 },
			}),
		]);
		expect(await db.select().from(transactionFor)).toEqual([]);
	});

	it("won't undo into Review what the other Parent filed in their Personal Allowance, or keep it as a guess", async () => {
		await imported("t1", "sephora");
		await db.update(transactions).set({ bucketId: "alex-pa" }).where(eqId("t1"));
		await returnToReview(db, sam, {
			transactionId: "t1",
			merchant: "sephora",
			guess: { bucketId: "alex-pa", confidence: 1 },
			forMemberIds: [],
		});
		const [row] = await db.select().from(transactions).where(eqId("t1"));
		expect(row?.bucketId).toBe("alex-pa");
		expect(await db.select().from(categorizations)).toEqual([]);

		await imported("t2", "ulta");
		await returnToReview(db, alex, {
			transactionId: "t2",
			merchant: "ulta",
			guess: { bucketId: "alex-pa", confidence: 1 },
			forMemberIds: [],
		});
		expect((await loadReview(db, alex, 50)).items).toEqual([
			expect.objectContaining({ id: "t2", guess: null }),
		]);
	});
});

describe("Rules", () => {
	it("saves a Rule For some Members, replacing the same pattern's Rule", async () => {
		const first = await saveRule(db, {
			id: "r1",
			householdId,
			memberId: "alex",
			pattern: "LEGO STORE #12",
			bucketId: "groceries",
		});
		const again = await saveRule(db, {
			id: "r2",
			householdId,
			memberId: "sam",
			pattern: "lego store",
			bucketId: "fun",
			forMemberIds: ["maya", "not-a-member"],
		});

		expect(first).toEqual({ ok: true, ruleId: "r1", private: false });
		expect(again).toEqual({ ok: true, ruleId: "r1", private: false });
		expect(await listRules(db, alex)).toEqual([
			{
				id: "r1",
				pattern: "lego store",
				bucketId: "fun",
				bucketName: "Fun",
				for: ["maya"],
				private: false,
				createdBy: "Sam",
				matched: 0,
			},
		]);
	});

	it("keeps a Rule into a Parent's own Personal Allowance private to them", async () => {
		const mine = await saveRule(db, {
			id: "r1",
			householdId,
			memberId: "alex",
			pattern: "amazon",
			bucketId: "alex-pa",
		});
		expect(mine).toMatchObject({ ok: true, private: true });
		// Sam's Household Rule for the same merchant is a separate Rule, and changes nothing of Alex's.
		await saveRule(db, {
			id: "r2",
			householdId,
			memberId: "sam",
			pattern: "amazon",
			bucketId: "fun",
		});
		// Sam can't state one into Alex's Personal Allowance.
		expect(
			await saveRule(db, {
				id: "r3",
				householdId,
				memberId: "sam",
				pattern: "etsy",
				bucketId: "alex-pa",
			}),
		).toEqual({ ok: false });

		expect((await listRules(db, sam)).map((r) => r.id)).toEqual(["r2"]);
		expect((await loadRules(db, sam)).map((r) => r.id)).toEqual(["r2"]);
		expect((await loadRules(db, alex)).map((r) => [r.id, r.bucketId, r.private]).sort()).toEqual([
			["r1", "alex-pa", true],
			["r2", "fun", false],
		]);

		// Nor change or delete it, even by its ID.
		expect(
			await editRule(db, sam, {
				ruleId: "r1",
				pattern: "amazon",
				bucketId: "fun",
				forMemberIds: [],
			}),
		).toEqual({ ok: false, reason: "not-found" });
		await deleteRule(db, sam, "r1");
		expect((await db.select().from(rules)).map((r) => r.id).sort()).toEqual(["r1", "r2"]);
	});

	it("edits a Rule's pattern, Bucket and For, refusing a second Rule for the same pattern", async () => {
		await saveRule(db, {
			id: "r1",
			householdId,
			memberId: "alex",
			pattern: "lego",
			bucketId: "fun",
		});
		await saveRule(db, {
			id: "r2",
			householdId,
			memberId: "alex",
			pattern: "deli",
			bucketId: "groceries",
		});

		expect(
			await editRule(db, sam, {
				ruleId: "r1",
				pattern: "Lego Store",
				bucketId: "groceries",
				forMemberIds: ["maya"],
			}),
		).toEqual({ ok: true, private: false });
		expect(
			await editRule(db, sam, {
				ruleId: "r1",
				pattern: "deli",
				bucketId: "groceries",
				forMemberIds: [],
			}),
		).toEqual({ ok: false, reason: "duplicate" });
		// Into Sam's own Personal Allowance, it's Sam's alone.
		expect(
			await editRule(db, sam, {
				ruleId: "r2",
				pattern: "deli",
				bucketId: "sam-pa",
				forMemberIds: [],
			}),
		).toEqual({ ok: true, private: true });

		expect((await listRules(db, alex)).map((r) => [r.id, r.pattern, r.bucketId, r.for])).toEqual([
			["r1", "lego store", "groceries", ["maya"]],
		]);
		await deleteRule(db, alex, "r1");
		expect(await listRules(db, alex)).toEqual([]);
		expect(await db.select().from(transactionFor)).toEqual([]);
	});

	it("files by a Rule For its Members, counting what it matched once", async () => {
		await saveRule(db, {
			id: "r1",
			householdId,
			memberId: "alex",
			pattern: "lego",
			bucketId: "fun",
			forMemberIds: ["maya", "alex"],
		});
		await imported("t1", "lego store");
		await imported("t2", "lego store");
		const [rule] = await loadRules(db, alex);
		const decisions = ["t1", "t2"].map((transactionId) => ({
			transactionId,
			merchant: "lego store",
			ruleId: "r1",
			categorization: {
				outcome: "filed" as const,
				method: "rule" as const,
				bucketId: "fun",
				confidence: 1,
				for: rule?.for,
			},
		}));
		await fileCategorizations(db, alex, decisions);
		await fileCategorizations(db, alex, decisions);

		const forRows = await db.select().from(transactionFor);
		expect(forRows.map((f) => `${f.transactionId}:${f.memberId}`).sort()).toEqual([
			"t1:alex",
			"t1:maya",
			"t2:alex",
			"t2:maya",
		]);
		expect((await listRules(db, alex))[0]?.matched).toBe(2);
	});

	it("applies a Rule to what's unassigned, from Review or never categorized, for its own Parent only", async () => {
		await saveRule(db, {
			id: "r1",
			householdId,
			memberId: "alex",
			pattern: "lego",
			bucketId: "fun",
			forMemberIds: ["maya"],
		});
		await saveRule(db, {
			id: "mine",
			householdId,
			memberId: "alex",
			pattern: "sephora",
			bucketId: "alex-pa",
		});
		await imported("t1", "LEGO STORE #4", {
			outcome: "review",
			bucketId: "groceries",
			confidence: 0.4,
		});
		await imported("t2", "Lego Store", undefined, "2026-08-30");
		await imported("t3", "legoland");
		await imported("t4", "sephora");

		expect(await applyRule(db, alex, "r1")).toEqual({ filed: 1, months: ["2026-09"] });
		// Sam can't apply Alex's private Rule.
		expect(await applyRule(db, sam, "mine")).toEqual({ filed: 0, months: [] });

		const rows = await db.select().from(transactions);
		expect(Object.fromEntries(rows.map((r) => [r.id, r.bucketId]))).toEqual({
			t1: "fun",
			// August isn't planned, so it can't be filed there.
			t2: null,
			t3: null,
			t4: null,
		});
		// What the Rule couldn't file waits in Review instead.
		expect(await reviewIds()).toEqual(["t2"]);
		const [decided] = await db.select().from(categorizations);
		expect(decided).toMatchObject({ transactionId: "t1", outcome: "filed", method: "rule" });
		expect(await db.select().from(transactionFor)).toEqual([
			expect.objectContaining({ transactionId: "t1", memberId: "maya" }),
		]);
		expect((await listRules(db, alex)).find((r) => r.id === "r1")?.matched).toBe(1);
	});
});
