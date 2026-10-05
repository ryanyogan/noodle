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
import { fileWithoutBucket, loadReview, loadReviewToLookAgain, returnToReview } from "./review";
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
import {
	deleteTransaction,
	renameTransaction,
	splitTransaction,
	updateTransaction,
} from "./transactions";

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

	it("never guesses a Bucket that isn't in the Plan of the Transaction's own month", async () => {
		// Learned from October's filings, then guessed for a September line: Confirm could never
		// save it, since a Transaction is only filed in a Bucket of its own month's Plan.
		await addBucket(db, {
			householdId,
			memberId: "alex",
			bucketId: "hippos",
			name: "Hippos",
			color: 3,
			month: "2026-10",
			allowanceCents: 50_000,
		});
		const guess = { outcome: "review", bucketId: "hippos", confidence: 0.9 } as const;
		await imported("september", "duil mortongro", guess, "2026-09-14");
		await imported("october", "duil mortongro", guess, "2026-10-02");

		// What Confirm on the September card would do with such a guess: refused, every time.
		expect(
			await updateTransaction(db, {
				householdId,
				memberId: "alex",
				transactionId: "september",
				amountCents: 4_200,
				assignment: { bucketId: "hippos" },
				note: "duil mortongro",
				forMemberIds: [],
				expectedVersion: 0,
			}),
		).toEqual({ ok: false, reason: "not-in-plan" });

		expect((await loadReview(db, alex, 50)).items).toEqual([
			// Still waiting, with nothing to confirm: the picker offers September's Buckets.
			expect.objectContaining({ id: "september", guess: null }),
			expect.objectContaining({
				id: "october",
				guess: expect.objectContaining({ bucketId: "hippos", name: "Hippos" }),
			}),
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

describe("a card a Parent put back with Undo waits for the Parent (issue 105)", () => {
	const lookedAgain = async (viewer = alex) =>
		(await loadReviewToLookAgain(db, viewer)).map((row) => row.id);
	const putBack = (id: string, merchant: string) =>
		returnToReview(db, alex, { transactionId: id, merchant, guess: null, forMemberIds: [] });
	const mark = async (id: string) =>
		(await db.select().from(categorizations)).find((c) => c.transactionId === id)?.returnedAt;

	async function filedByHand(id: string, note: string) {
		const filed = await updateTransaction(db, {
			householdId,
			memberId: "alex",
			transactionId: id,
			amountCents: 4_200,
			assignment: { bucketId: "fun" },
			note,
			forMemberIds: [],
		});
		expect(filed.ok).toBe(true);
		await settleCategorization(db, householdId, id);
	}

	it("a look again skips it, and still takes the cards no one has decided", async () => {
		await imported("t1", "acme widgets", { outcome: "review" });
		await imported("t2", "acme widgets", { outcome: "review" });
		expect(await lookedAgain()).toEqual(["t1", "t2"]);

		await filedByHand("t1", "acme widgets");
		await putBack("t1", "acme widgets");

		expect(await reviewIds()).toEqual(["t1", "t2"]);
		expect(await lookedAgain()).toEqual(["t2"]);
		expect(await mark("t1")).toBeInstanceOf(Date);
		expect(await mark("t2")).toBeNull();
	});

	it("stays put back when the Undo is sent twice, and when it never left Review", async () => {
		await imported("t1", "acme widgets", { outcome: "review" });
		await putBack("t1", "acme widgets");
		await putBack("t1", "acme widgets");
		expect(await lookedAgain()).toEqual([]);
	});

	it("loses the mark with its row when the Parent files it by hand", async () => {
		await imported("t1", "acme widgets", { outcome: "review" });
		await putBack("t1", "acme widgets");
		await filedByHand("t1", "acme widgets");
		expect(await db.select().from(categorizations)).toEqual([]);
	});

	it("a Rule the Parent makes still files it, and that clears the mark", async () => {
		await imported("t1", "acme widgets", { outcome: "review" });
		await putBack("t1", "acme widgets");
		await saveRule(db, {
			id: "rule-acme",
			householdId,
			memberId: "alex",
			pattern: "Acme Widgets",
			bucketId: "fun",
		});
		expect(await applyRule(db, alex, "rule-acme")).toMatchObject({ filed: 1 });
		const [row] = await db.select().from(transactions).where(eqId("t1"));
		expect(row?.bucketId).toBe("fun");
		expect(await mark("t1")).toBeNull();
	});

	it("a new guess for it (the Parent's own Look again is not one) keeps the mark", async () => {
		await imported("t1", "acme widgets", { outcome: "review" });
		await putBack("t1", "acme widgets");
		await fileCategorizations(db, alex, [
			{
				transactionId: "t1",
				merchant: "acme widgets",
				categorization: { outcome: "review", method: "model", bucketId: "fun", confidence: 0.5 },
			},
		]);
		expect(await mark("t1")).toBeInstanceOf(Date);
		expect(await lookedAgain()).toEqual([]);
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

describe("a Transaction's version: two screens never quietly overwrite each other (#85, ADR-0041)", () => {
	const versionOf = async (id: string) =>
		(await db.select({ version: transactions.version }).from(transactions).where(eqId(id)))[0]
			?.version;
	const edit = (memberId: string, bucketId: string, expectedVersion?: number, note = "costco") =>
		updateTransaction(db, {
			householdId,
			memberId,
			transactionId: "t1",
			amountCents: 4_200,
			assignment: { bucketId },
			note,
			forMemberIds: [],
			expectedVersion,
		});

	it("starts at 0, is read with the list's and Review's rows, and goes up by one with each change", async () => {
		await imported("t1", "costco", { outcome: "review" });
		expect(await versionOf("t1")).toBe(0);
		expect((await loadReview(db, alex, 50)).items[0]?.version).toBe(0);
		expect(await edit("alex", "groceries", 0)).toEqual({ ok: true, version: 1 });
		expect(await edit("alex", "fun", 1)).toEqual({ ok: true, version: 2 });
		expect(await versionOf("t1")).toBe(2);
	});

	it("refuses a change made on a version that has moved on, and leaves the other Parent's change alone", async () => {
		await imported("t1", "costco", { outcome: "review" });
		// Both Parents have it open at version 0. Sam saves first.
		expect(await edit("sam", "fun", 0, "costco run")).toEqual({ ok: true, version: 1 });
		await db.insert(transactionFor).values({ transactionId: "t1", memberId: "maya", householdId });
		expect(await edit("alex", "groceries", 0)).toEqual({ ok: false, reason: "changed-elsewhere" });
		const [row] = await db.select().from(transactions).where(eqId("t1"));
		expect([row?.bucketId, row?.note, row?.version]).toEqual(["fun", "costco run", 1]);
		// Its For is Sam's too: nothing of the refused change was written.
		expect((await db.select().from(transactionFor)).map((f) => f.memberId)).toEqual(["maya"]);
		// On what is there now, Alex's change lands.
		expect(await edit("alex", "groceries", 1)).toEqual({ ok: true, version: 2 });
	});

	it("a retry of a change that already landed is still that change, not a refusal", async () => {
		await imported("t1", "costco", { outcome: "review" });
		expect(await edit("alex", "groceries", 0)).toEqual({ ok: true, version: 1 });
		expect(await edit("alex", "groceries", 0)).toEqual({ ok: true, version: 1 });
		expect(await versionOf("t1")).toBe(1);
	});

	it("still says when it isn't in the Plan, and a writer that names no version is never refused", async () => {
		await imported("t1", "costco", { outcome: "review" });
		expect(await edit("alex", "sam-pa", 0)).toEqual({ ok: false, reason: "not-in-plan" });
		expect(await versionOf("t1")).toBe(0);
		expect(await edit("alex", "fun")).toEqual({ ok: true, version: 1 });
		expect(await edit("alex", "groceries")).toEqual({ ok: true, version: 2 });
	});

	it("guards a split and a delete the same way", async () => {
		await imported("t1", "costco", { outcome: "review" });
		const split = (expectedVersion: number) =>
			splitTransaction(db, {
				householdId,
				memberId: "alex",
				transactionId: "t1",
				amountCents: 4_200,
				note: "costco",
				splits: [
					{ id: "s1", amountCents: 4_000, assignment: { bucketId: "groceries" }, forMemberIds: [] },
					{ id: "s2", amountCents: 200, assignment: { bucketId: "fun" }, forMemberIds: [] },
				],
				expectedVersion,
			});
		expect(await edit("sam", "fun", 0)).toEqual({ ok: true, version: 1 });
		expect(await split(0)).toEqual({ ok: false, reason: "changed-elsewhere" });
		expect(await db.select().from(splits)).toEqual([]);
		expect(await split(1)).toEqual({ ok: true, version: 2 });
		expect(await split(1)).toEqual({ ok: true, version: 2 });

		const remove = (expectedVersion: number) =>
			deleteTransaction(db, { householdId, memberId: "sam", transactionId: "t1", expectedVersion });
		expect(await remove(1)).toEqual({ ok: false, reason: "changed-elsewhere" });
		expect(await versionOf("t1")).toBe(2);
		expect((await db.select().from(splits)).length).toBe(2);
		expect(await remove(2)).toEqual({ ok: true, version: null });
		expect(await versionOf("t1")).toBeUndefined();
		// Deleted already: a retry is not a refusal. A change to what is gone is.
		expect(await remove(2)).toEqual({ ok: true, version: null });
		expect(await edit("alex", "fun", 2)).toEqual({ ok: false, reason: "changed-elsewhere" });
	});

	it("an Undo back into Review is refused once the other Parent has changed it since", async () => {
		await imported("t1", "costco", { outcome: "review" });
		const undo = (expectedVersion: number) =>
			returnToReview(db, alex, {
				transactionId: "t1",
				merchant: "costco",
				guess: null,
				forMemberIds: [],
				expectedVersion,
			});
		expect(await edit("alex", "groceries", 0)).toEqual({ ok: true, version: 1 });
		await settleCategorization(db, householdId, "t1");
		expect(await edit("sam", "fun", 1)).toEqual({ ok: true, version: 2 });
		expect(await undo(1)).toEqual({ ok: false, reason: "changed-elsewhere" });
		expect((await db.select().from(transactions).where(eqId("t1")))[0]?.bucketId).toBe("fun");
		expect(await reviewIds()).toEqual([]);
		// On what is there now it goes back, and again on a retry.
		expect(await undo(2)).toEqual({ ok: true, version: 3 });
		expect(await undo(2)).toEqual({ ok: true, version: 3 });
		expect(await reviewIds()).toEqual(["t1"]);
	});

	it("filing without a Bucket moves the version on, so a card for it on another screen is refused", async () => {
		await imported("t1", "costco", { outcome: "review" });
		await imported("t2", "corner deli", { outcome: "review" });
		expect(await fileWithoutBucket(db, sam, ["t1"])).toEqual({
			filed: ["t1"],
			versions: { t1: 1 },
		});
		expect(await versionOf("t2")).toBe(0);
		expect(await edit("alex", "groceries", 0)).toEqual({ ok: false, reason: "changed-elsewhere" });
		// A second ask files nothing and moves nothing.
		expect(await fileWithoutBucket(db, sam, ["t1"])).toEqual({ filed: [], versions: {} });
		expect(await versionOf("t1")).toBe(1);
	});

	it("a Rule that files it in the background moves the version on and is never refused itself", async () => {
		await imported("t1", "costco", { outcome: "review" });
		const saved = await saveRule(db, {
			id: "r1",
			householdId,
			memberId: "sam",
			pattern: "costco",
			bucketId: "groceries",
			commitmentId: null,
			forMemberIds: [],
		});
		expect(saved.ok).toBe(true);
		await applyRule(db, sam, "r1");
		const [row] = await db.select().from(transactions).where(eqId("t1"));
		expect([row?.bucketId, row?.version]).toEqual(["groceries", 1]);
		// Alex's card for it, still at version 0, no longer writes over what the Rule did.
		expect(await edit("alex", "fun", 0)).toEqual({ ok: false, reason: "changed-elsewhere" });
	});
});

describe("renaming a Transaction without changing anything else (issue 99)", () => {
	const rowOf = async (id: string) => (await db.select().from(transactions).where(eqId(id)))[0];
	const rename = (transactionId: string, name: string, expectedVersion?: number, who = alex) =>
		renameTransaction(db, { ...who, transactionId, name, expectedVersion });

	it("an imported line takes the name and keeps the bank's wording; a retry lands the same", async () => {
		await imported("t1", "COSTCO WHSE #1042");
		expect(await rename("t1", "Big shop", 0)).toEqual({ ok: true, version: 1 });
		// The same request again (a retry after a lost answer): nothing more changes.
		expect(await rename("t1", "Big shop", 0)).toEqual({ ok: true, version: 1 });
		expect(await rowOf("t1")).toMatchObject({
			note: "COSTCO WHSE #1042",
			merchant: "Big shop",
			bucketId: null,
			amountCents: 4_200,
			version: 1,
		});
	});

	it("a by-hand one's name is its note, and its merchant name is left to be worked out again", async () => {
		await db.insert(transactions).values({
			id: "q1",
			householdId,
			source: "quick-add",
			date: "2026-09-10",
			amountCents: 1_500,
			note: "lunch",
			merchant: "Lunch",
			bucketId: "fun",
			createdByMemberId: "alex",
		});
		expect(await rename("q1", "Team lunch", 0)).toEqual({ ok: true, version: 1 });
		expect(await rowOf("q1")).toMatchObject({
			note: "Team lunch",
			merchant: null,
			bucketId: "fun",
			amountCents: 1_500,
		});
	});

	it("keeps a split Transaction's Splits and For", async () => {
		await imported("t1", "costco");
		const split = await splitTransaction(db, {
			...alex,
			transactionId: "t1",
			amountCents: 4_200,
			note: "costco",
			splits: [
				{
					id: "s1",
					amountCents: 3_000,
					assignment: { bucketId: "groceries" },
					forMemberIds: ["maya"],
				},
				{ id: "s2", amountCents: 1_200, assignment: { bucketId: "fun" }, forMemberIds: [] },
			],
			expectedVersion: 0,
		});
		expect(split).toMatchObject({ ok: true });
		expect(await rename("t1", "Costco run", 1)).toEqual({ ok: true, version: 2 });
		expect(await db.select().from(splits)).toHaveLength(2);
		expect(await rowOf("t1")).toMatchObject({ merchant: "Costco run", note: "costco" });
	});

	it("is refused on a version that has moved on, and changes nothing", async () => {
		await imported("t1", "costco");
		expect(await rename("t1", "First", 0)).toEqual({ ok: true, version: 1 });
		expect(await rename("t1", "Second", 0)).toEqual({ ok: false, reason: "changed-elsewhere" });
		expect(await rowOf("t1")).toMatchObject({ merchant: "First", version: 1 });
	});

	it("not another Household's, not in the other Parent's Personal Allowance, not Goal spending", async () => {
		await imported("t1", "costco");
		expect(
			await renameTransaction(db, {
				householdId: "another",
				memberId: "alex",
				transactionId: "t1",
				name: "Theirs",
				expectedVersion: 0,
			}),
		).toMatchObject({ ok: false });
		await db.update(transactions).set({ bucketId: "sam-pa" }).where(eqId("t1"));
		expect(await rename("t1", "Peek", 0)).toEqual({ ok: false, reason: "not-editable" });
		expect(await rename("t1", "Sam's", 0, sam)).toEqual({ ok: true, version: 1 });
		expect(await rowOf("t1")).toMatchObject({ merchant: "Sam's" });
	});
});
