import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { fileCategorizations, settleCategorization } from "./categorize";
import { addCommitment } from "./commitments";
import {
	addAccount,
	addBucket,
	addPersonalAllowance,
	createHouseholdForParent,
	setTakeHomePay,
} from "./index";
import { fileWithoutBucket, loadReview, returnToReview } from "./review";
import { applyRule, deleteRule, editRule, listRules, loadRules, saveRule } from "./rules";
import {
	categorizations,
	commitments,
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
			["t2", { bucketId: "fun", name: "Fun", confidence: 0.6, method: null, reason: null }],
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
				guess: { bucketId: "fun", name: "Fun", confidence: 0.6, method: null, reason: null },
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
				commitmentId: null,
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

describe("Rules into a Commitment", () => {
	beforeEach(async () => {
		for (const [commitmentId, name, from] of [
			["netflix", "Netflix", month],
			["gym", "Gym", "2026-10"],
		] as const) {
			await addCommitment(db, {
				householdId,
				memberId: "alex",
				commitmentId,
				name,
				month: from,
				amountCents: 1_599,
				cadence: "monthly",
				dueDate: `${from}-15`,
			});
		}
	});

	it("is the Household's: both Parents see it, and moving a Personal Allowance Rule to one shares it", async () => {
		const saved = await saveRule(db, {
			id: "r1",
			householdId,
			memberId: "alex",
			pattern: "netflix.com",
			commitmentId: "netflix",
		});
		expect(saved).toEqual({ ok: true, ruleId: "r1", private: false });
		expect(await listRules(db, sam)).toEqual([
			expect.objectContaining({
				id: "r1",
				bucketId: null,
				commitmentId: "netflix",
				bucketName: "Netflix",
				private: false,
			}),
		]);

		await saveRule(db, {
			id: "mine",
			householdId,
			memberId: "alex",
			pattern: "spotify",
			bucketId: "alex-pa",
		});
		expect((await listRules(db, sam)).map((r) => r.id)).toEqual(["r1"]);
		const toCommitment = { ruleId: "mine", pattern: "spotify", forMemberIds: [] };
		expect(
			await editRule(db, alex, { ...toCommitment, bucketId: null, commitmentId: "netflix" }),
		).toMatchObject({ ok: true });
		expect((await listRules(db, sam)).map((r) => r.id).sort()).toEqual(["mine", "r1"]);
		// And back into Alex's own: private to Alex again.
		expect(
			await editRule(db, alex, { ...toCommitment, bucketId: "alex-pa", commitmentId: null }),
		).toMatchObject({ ok: true });
		expect((await listRules(db, sam)).map((r) => r.id)).toEqual(["r1"]);
		const [mine] = await db.select().from(rules).where(eq(rules.id, "mine"));
		expect(mine).toMatchObject({ ownerMemberId: "alex", commitmentId: null, bucketId: "alex-pa" });
	});

	it("refuses another Household's Commitment, or one that has ended", async () => {
		await createHouseholdForParent(db, {
			clerkUserId: "clerk-other",
			householdId: "other",
			householdName: "Others",
			timeZone: "America/Chicago",
			parentId: "other-parent",
			parentName: "Pat",
		});
		await addCommitment(db, {
			householdId: "other",
			memberId: "other-parent",
			commitmentId: "theirs",
			name: "Theirs",
			month,
			amountCents: 1_000,
			cadence: "monthly",
			dueDate: "2026-09-01",
		});
		const rule = { householdId, memberId: "alex", pattern: "x" };
		expect(await saveRule(db, { ...rule, id: "a", commitmentId: "theirs" })).toEqual({ ok: false });
		await db
			.update(commitments)
			.set({ endedFromMonth: month })
			.where(eq(commitments.id, "netflix"));
		expect(await saveRule(db, { ...rule, id: "b", commitmentId: "netflix" })).toEqual({
			ok: false,
		});
		expect(await db.select().from(rules)).toEqual([]);
	});

	it("files a matching import to the Commitment, counting the match", async () => {
		await saveRule(db, {
			id: "r1",
			householdId,
			memberId: "alex",
			pattern: "netflix",
			commitmentId: "netflix",
		});
		await imported("t1", "NETFLIX.COM");
		const decision = {
			transactionId: "t1",
			merchant: "netflix.com",
			ruleId: "r1",
			categorization: {
				outcome: "filed" as const,
				method: "rule" as const,
				bucketId: null,
				commitmentId: "netflix",
				confidence: 1,
				for: [],
			},
		};
		await fileCategorizations(db, alex, [decision]);

		const [row] = await db.select().from(transactions).where(eqId("t1"));
		expect(row).toMatchObject({ bucketId: null, commitmentId: "netflix" });
		const [decided] = await db.select().from(categorizations);
		expect(decided).toMatchObject({ outcome: "filed", method: "rule", commitmentId: "netflix" });
		expect(await reviewIds()).toEqual([]);
		expect((await listRules(db, alex))[0]?.matched).toBe(1);
	});

	it("applies to what's unassigned, but not before the Commitment is in the Plan", async () => {
		await saveRule(db, {
			id: "r1",
			householdId,
			memberId: "alex",
			pattern: "netflix",
			commitmentId: "netflix",
		});
		await saveRule(db, {
			id: "r2",
			householdId,
			memberId: "alex",
			pattern: "gym",
			commitmentId: "gym",
		});
		await imported("t1", "Netflix.com", { outcome: "review", bucketId: "fun", confidence: 0.4 });
		await imported("t2", "GYM 24");

		expect(await applyRule(db, sam, "r1")).toEqual({ filed: 1, months: ["2026-09"] });
		// The Gym is planned from October, so September's charge waits in Review.
		expect(await applyRule(db, alex, "r2")).toEqual({ filed: 0, months: [] });
		const rows = await db.select().from(transactions);
		expect(Object.fromEntries(rows.map((r) => [r.id, r.commitmentId]))).toEqual({
			t1: "netflix",
			t2: null,
		});
		expect(await reviewIds()).toEqual(["t2"]);
		expect((await listRules(db, alex)).find((r) => r.id === "r1")?.matched).toBe(1);
	});
});

describe("filing without a Bucket (#82)", () => {
	it("a bank Transaction from a month before the Plan has no Bucket it can be filed in", async () => {
		// August: the Plan starts in September, so nothing is assignable there. This is why the card
		// could only be skipped.
		await imported("old", "acme widgets", { outcome: "review" }, "2026-08-15");
		const result = await updateTransaction(db, {
			householdId,
			memberId: "alex",
			transactionId: "old",
			amountCents: 4_200,
			assignment: { bucketId: "groceries" },
			note: "acme widgets",
			forMemberIds: [],
		});
		expect(result.ok).toBe(false);
		expect(await reviewIds()).toEqual(["old"]);
	});

	it("takes them out of Review, still unassigned, and the count goes down", async () => {
		await imported("old", "acme widgets", { outcome: "review" }, "2026-08-15");
		await imported("older", "corner deli", { outcome: "review" }, "2025-12-02");
		await imported("now", "lego store", { outcome: "review", bucketId: "fun", confidence: 0.6 });
		expect((await loadReview(db, alex, 50)).total).toBe(3);

		expect((await fileWithoutBucket(db, alex, ["old"])).filed).toEqual(["old"]);
		expect((await loadReview(db, alex, 50)).total).toBe(2);
		// Either Parent may, as with any card.
		expect((await fileWithoutBucket(db, sam, ["older", "now"])).filed.sort()).toEqual([
			"now",
			"older",
		]);
		expect((await loadReview(db, alex, 50)).total).toBe(0);

		const rows = await db.select().from(transactions);
		expect(rows.map((row) => [row.bucketId, row.commitmentId, row.goalId])).toEqual([
			[null, null, null],
			[null, null, null],
			[null, null, null],
		]);
		// Again: nothing left to file.
		expect((await fileWithoutBucket(db, alex, ["old", "older"])).filed).toEqual([]);
	});

	it("leaves alone what isn't waiting, and another Household's", async () => {
		await imported("filed", "costco", { outcome: "filed", bucketId: "groceries" });
		await imported("old", "acme widgets", { outcome: "review" }, "2026-08-15");
		const stranger = { householdId: "other", memberId: "nobody" };
		expect((await fileWithoutBucket(db, stranger, ["old"])).filed).toEqual([]);
		expect((await fileWithoutBucket(db, alex, ["filed", "missing"])).filed).toEqual([]);
		expect(await db.select().from(categorizations)).toHaveLength(2);
		expect(await reviewIds()).toEqual(["old"]);
	});

	it("can be undone: the card goes back to Review", async () => {
		await imported("old", "acme widgets", { outcome: "review" }, "2026-08-15");
		await fileWithoutBucket(db, alex, ["old"]);
		await returnToReview(db, alex, {
			transactionId: "old",
			merchant: "acme widgets",
			guess: null,
			forMemberIds: [],
		});
		expect(await reviewIds()).toEqual(["old"]);
	});
});
