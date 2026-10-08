import { type DayKey, merchantKey } from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBucket,
	addChild,
	addPersonalAllowance,
	applyRule,
	createHouseholdForParent,
	type Db,
	fileCategorizations,
	listRules,
	loadReview,
	loadRules,
	removeChild,
	saveRule,
	setTakeHomePay,
} from "./index";
import { categorizations, members, transactionFor, transactions } from "./schema";
import { testDb } from "./test-db";

// For is quicker to set (issue 155): a Rule sets For as well as the Bucket, on arrival and when it
// is applied to what waits, less any Member who has left; and Review offers who a merchant's
// earlier Transactions were For, only from what the Parent looking may read (ADR-0003).

const householdId = "household";
const month = "2026-09";
const today = "2026-09-20" as DayKey;
const alex = { householdId, memberId: "alex" };
const sam = { householdId, memberId: "sam" };

let db: Db;
let next = 0;

/** A statement line of the Household's card, unassigned; `waits`: in Review, for a Parent. */
async function line(note: string, options: { waits?: boolean; date?: string; in?: string } = {}) {
	const id = `line-${String(next++).padStart(3, "0")}`;
	const household = options.in ?? householdId;
	await db.insert(transactions).values({
		id,
		householdId: household,
		source: "import",
		date: options.date ?? "2026-09-12",
		amountCents: 4_200 + next,
		note,
		accountId: household === householdId ? "card" : "other-card",
		createdByMemberId: household === householdId ? "alex" : "robin",
	});
	if (options.waits) {
		await db.insert(categorizations).values({
			transactionId: id,
			householdId: household,
			memberId: household === householdId ? "alex" : "robin",
			outcome: "review",
			method: "none",
			merchant: merchantKey(note),
		});
	}
	return id;
}

/** Files `id` in `bucketId` For `forMemberIds`, as a Parent's Confirm leaves it. */
async function filed(id: string, bucketId: string, forMemberIds: string[]) {
	await db.update(transactions).set({ bucketId }).where(eq(transactions.id, id));
	await db.delete(categorizations).where(eq(categorizations.transactionId, id));
	if (forMemberIds.length > 0)
		await db
			.insert(transactionFor)
			.values(forMemberIds.map((memberId) => ({ transactionId: id, memberId, householdId })));
}

const forOf = async (id: string) =>
	(await db.select().from(transactionFor).where(eq(transactionFor.transactionId, id)))
		.map((row) => row.memberId)
		.sort();

const bucketOf = async (id: string) =>
	(await db.select().from(transactions).where(eq(transactions.id, id)))[0]?.bucketId;

/** A line arriving: what the Rules of the Parent who imported it make of it, as an Import does. */
async function arrives(viewer: typeof alex, id: string, note: string) {
	const merchant = merchantKey(note);
	const rule = (await loadRules(db, viewer)).find((r) =>
		` ${merchant} `.includes(` ${r.pattern} `),
	);
	if (!rule) throw new Error(`no Rule for ${merchant}`);
	await fileCategorizations(
		db,
		viewer,
		[
			{
				transactionId: id,
				merchant,
				ruleId: rule.id,
				categorization: {
					outcome: "filed",
					method: "rule",
					bucketId: rule.bucketId,
					commitmentId: rule.commitmentId,
					confidence: 1,
					for: rule.for,
				},
			},
		],
		today,
	);
}

const rule = (id: string, pattern: string, bucketId: string, forMemberIds: string[], by = "alex") =>
	saveRule(db, { id, householdId, memberId: by, pattern, bucketId, forMemberIds });

const likelyOf = async (viewer: typeof alex, id: string) =>
	(await loadReview(db, viewer, 100)).items.find((item) => item.id === id)?.likelyFor;

beforeEach(async () => {
	db = testDb();
	next = 0;
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
		["sports", 1],
		["food", 3],
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

describe("a Rule sets For as well as the Bucket", () => {
	it("files a line that arrives For the Rule's Member, or its several", async () => {
		await rule("swim", "riverside swim", "sports", ["maya"]);
		await rule("pizza", "corner pizza", "food", ["maya", "leo"]);
		const swim = await line("RIVERSIDE SWIM CLUB #12");
		const pizza = await line("CORNER PIZZA");
		await arrives(alex, swim, "RIVERSIDE SWIM CLUB #12");
		await arrives(alex, pizza, "CORNER PIZZA");
		expect(await bucketOf(swim)).toBe("sports");
		expect(await forOf(swim)).toEqual(["maya"]);
		expect(await bucketOf(pizza)).toBe("food");
		expect(await forOf(pizza)).toEqual(["leo", "maya"]);
	});

	it("leaves For alone when the Rule has none, and when the line is already For someone", async () => {
		await rule("market", "corner market", "food", []);
		await rule("swim", "riverside swim", "sports", ["maya"]);
		const plain = await line("CORNER MARKET");
		const said = await line("CORNER MARKET");
		const already = await line("RIVERSIDE SWIM CLUB");
		await db.insert(transactionFor).values([
			{ transactionId: said, memberId: "leo", householdId },
			{ transactionId: already, memberId: "leo", householdId },
		]);
		for (const [id, note] of [
			[plain, "CORNER MARKET"],
			[said, "CORNER MARKET"],
			[already, "RIVERSIDE SWIM CLUB"],
		] as const)
			await arrives(alex, id, note);
		expect(await bucketOf(plain)).toBe("food");
		expect(await forOf(plain)).toEqual([]);
		expect(await forOf(said)).toEqual(["leo"]);
		expect(await bucketOf(already)).toBe("sports");
		expect(await forOf(already)).toEqual(["leo"]);
	});

	it("applied to what waits, sets For on each it files and leaves the others' alone", async () => {
		const swim = await line("RIVERSIDE SWIM CLUB", { waits: true });
		const never = await line("RIVERSIDE SWIM CLUB #7");
		const already = await line("RIVERSIDE SWIM CLUB", { waits: true });
		const other = await line("CORNER MARKET", { waits: true });
		await db
			.insert(transactionFor)
			.values({ transactionId: already, memberId: "leo", householdId });
		await rule("swim", "riverside swim", "sports", ["maya", "sam"]);
		expect(await applyRule(db, alex, "swim", { today })).toEqual({
			filed: 3,
			months: [month],
			kept: 0,
		});
		expect(await forOf(swim)).toEqual(["maya", "sam"]);
		expect(await forOf(never)).toEqual(["maya", "sam"]);
		expect(await forOf(already)).toEqual(["leo"]);
		expect(await bucketOf(other)).toBeNull();
		expect(await forOf(other)).toEqual([]);

		// With no For, the Rule files and says nothing of who.
		await rule("market", "corner market", "food", []);
		await applyRule(db, alex, "market", { today });
		expect(await bucketOf(other)).toBe("food");
		expect(await forOf(other)).toEqual([]);
	});

	it("goes on filing once a Member it names has left: without them, For the rest", async () => {
		await rule("swim", "riverside swim", "sports", ["maya", "leo"]);
		await rule("pizza", "corner pizza", "food", ["leo"]);
		await removeChild(db, { householdId, memberId: "leo" });

		const swim = await line("RIVERSIDE SWIM CLUB");
		await arrives(alex, swim, "RIVERSIDE SWIM CLUB");
		expect(await bucketOf(swim)).toBe("sports");
		expect(await forOf(swim)).toEqual(["maya"]);

		// Applied to what waits, the same; a Rule For them alone files For Everyone.
		const waiting = await line("RIVERSIDE SWIM CLUB", { waits: true });
		const pizza = await line("CORNER PIZZA", { waits: true });
		expect((await applyRule(db, alex, "swim", { today })).filed).toBe(1);
		expect((await applyRule(db, alex, "pizza", { today })).filed).toBe(1);
		expect(await forOf(waiting)).toEqual(["maya"]);
		expect(await bucketOf(pizza)).toBe("food");
		expect(await forOf(pizza)).toEqual([]);

		// The Rules screen names who is left, and a Rule can't be saved For someone who has gone.
		const listed = await listRules(db, alex);
		expect(listed.find((r) => r.id === "swim")?.for).toEqual(["maya"]);
		expect(listed.find((r) => r.id === "pizza")?.for).toEqual([]);
		await rule("gym", "hilltop gym", "sports", ["leo", "maya"]);
		expect((await loadRules(db, alex)).find((r) => r.id === "gym")?.for).toEqual(["maya"]);

		// Even a decision that still names them (made before they left) doesn't file For them.
		const late = await line("HILLTOP GYM");
		await fileCategorizations(
			db,
			alex,
			[
				{
					transactionId: late,
					merchant: "hilltop gym",
					ruleId: "gym",
					categorization: {
						outcome: "filed",
						method: "rule",
						bucketId: "sports",
						commitmentId: null,
						confidence: 1,
						for: ["leo", "maya"],
					},
				},
			],
			today,
		);
		expect(await forOf(late)).toEqual(["maya"]);
	});

	it("never names another Household's Member", async () => {
		await createHouseholdForParent(db, {
			clerkUserId: "clerk-robin",
			householdId: "other",
			householdName: "The Docks",
			timeZone: "America/Chicago",
			parentId: "robin",
			parentName: "Robin",
		});
		await addChild(db, { householdId: "other", memberId: "ivy", name: "Ivy", color: 1 });
		await rule("swim", "riverside swim", "sports", ["ivy", "maya"]);
		expect((await loadRules(db, alex)).find((r) => r.id === "swim")?.for).toEqual(["maya"]);
		const swim = await line("RIVERSIDE SWIM CLUB", { waits: true });
		await applyRule(db, alex, "swim", { today });
		expect(await forOf(swim)).toEqual(["maya"]);
		expect(await loadRules(db, { householdId: "other", memberId: "robin" })).toEqual([]);
	});
});

describe("Review offers who a merchant's earlier Transactions were For", () => {
	it("after two filed For the same person, and not after one", async () => {
		await filed(await line("RIVERSIDE SWIM CLUB #3", { date: "2026-09-02" }), "sports", ["maya"]);
		const card = await line("RIVERSIDE SWIM CLUB #9", { waits: true });
		expect(await likelyOf(alex, card)).toBeUndefined();
		await filed(await line("RIVERSIDE SWIM CLUB", { date: "2026-09-05" }), "sports", ["maya"]);
		expect(await likelyOf(alex, card)).toEqual(["maya"]);
		// Offered only: nothing is saved until a Parent files the card.
		expect(await forOf(card)).toEqual([]);
		// The other Parent is offered the same: neither of these is anyone's alone.
		expect(await likelyOf(sam, card)).toEqual(["maya"]);
	});

	it("names several people when each one was For the same several", async () => {
		for (const date of ["2026-09-02", "2026-09-05"])
			await filed(await line("CORNER PIZZA", { date }), "food", ["maya", "leo"]);
		expect(await likelyOf(alex, await line("CORNER PIZZA", { waits: true }))).toEqual([
			"leo",
			"maya",
		]);
	});

	it("offers nobody when they differ, were For Everyone, or the card is For someone already", async () => {
		await filed(await line("CORNER PIZZA", { date: "2026-09-02" }), "food", ["maya"]);
		await filed(await line("CORNER PIZZA", { date: "2026-09-03" }), "food", ["leo"]);
		await filed(await line("CORNER MARKET", { date: "2026-09-02" }), "food", []);
		await filed(await line("CORNER MARKET", { date: "2026-09-03" }), "food", []);
		await filed(await line("HILLTOP GYM", { date: "2026-09-02" }), "sports", ["maya"]);
		await filed(await line("HILLTOP GYM", { date: "2026-09-03" }), "sports", ["maya"]);
		await filed(await line("HILLTOP GYM", { date: "2026-09-04" }), "sports", []);
		expect(await likelyOf(alex, await line("CORNER PIZZA", { waits: true }))).toBeUndefined();
		expect(await likelyOf(alex, await line("CORNER MARKET", { waits: true }))).toBeUndefined();
		expect(await likelyOf(alex, await line("HILLTOP GYM", { waits: true }))).toBeUndefined();

		await filed(await line("RIVERSIDE SWIM CLUB", { date: "2026-09-02" }), "sports", ["maya"]);
		await filed(await line("RIVERSIDE SWIM CLUB", { date: "2026-09-03" }), "sports", ["maya"]);
		const said = await line("RIVERSIDE SWIM CLUB", { waits: true });
		await db.insert(transactionFor).values({ transactionId: said, memberId: "leo", householdId });
		expect(await likelyOf(alex, said)).toBeUndefined();
		// Another merchant's history says nothing of this one's.
		expect(await likelyOf(alex, await line("RIVERSIDE BAKERY", { waits: true }))).toBeUndefined();
	});

	it("leaves out a Member who has left, and keeps the rest", async () => {
		for (const date of ["2026-09-02", "2026-09-05"]) {
			await filed(await line("CORNER PIZZA", { date }), "food", ["maya", "leo"]);
			await filed(await line("HILLTOP GYM", { date }), "sports", ["leo"]);
		}
		await removeChild(db, { householdId, memberId: "leo" });
		expect(await likelyOf(alex, await line("CORNER PIZZA", { waits: true }))).toEqual(["maya"]);
		expect(await likelyOf(alex, await line("HILLTOP GYM", { waits: true }))).toBeUndefined();
	});

	it("never goes by what the other Parent spent in their Personal Allowance", async () => {
		// Sam's own: two at a toy shop, For Maya, in Sam's Personal Allowance.
		for (const date of ["2026-09-02", "2026-09-05"])
			await filed(await line("HARBOR TOY SHOP", { date }), "sam-pa", ["maya"]);
		const card = await line("HARBOR TOY SHOP", { waits: true });
		// Alex's card says nothing: an offer would tell Alex what Sam bought, and for whom.
		expect(await likelyOf(alex, card)).toBeUndefined();
		expect(await likelyOf(sam, card)).toEqual(["maya"]);

		// One Alex can see doesn't make two with Sam's hidden ones.
		await filed(await line("HARBOR TOY SHOP", { date: "2026-09-08" }), "food", ["maya"]);
		expect(await likelyOf(alex, card)).toBeUndefined();
		// And Sam's hidden ones For someone else don't unsettle what Alex sees.
		await filed(await line("HARBOR TOY SHOP", { date: "2026-09-09" }), "food", ["maya"]);
		await filed(await line("HARBOR TOY SHOP", { date: "2026-09-10" }), "sam-pa", ["leo"]);
		expect(await likelyOf(alex, card)).toEqual(["maya"]);
		expect(await likelyOf(sam, card)).toBeUndefined();

		// Sam's Rule into their Personal Allowance, For Maya, is Sam's alone too.
		await rule("toys", "harbor toy", "sam-pa", ["maya"], "sam");
		expect(await loadRules(db, alex)).toEqual([]);
		expect((await loadRules(db, sam)).map((r) => [r.id, r.for])).toEqual([["toys", ["maya"]]]);
	});

	it("never goes by another Household's Transactions", async () => {
		await createHouseholdForParent(db, {
			clerkUserId: "clerk-robin",
			householdId: "other",
			householdName: "The Docks",
			timeZone: "America/Chicago",
			parentId: "robin",
			parentName: "Robin",
		});
		await addChild(db, { householdId: "other", memberId: "ivy", name: "Ivy", color: 1 });
		await addAccount(db, {
			householdId: "other",
			accountId: "other-card",
			name: "Visa",
			kind: "credit-card",
			balanceCents: 0,
			balanceId: "balance-other",
			createdByMemberId: "robin",
		});
		await addBucket(db, {
			householdId: "other",
			memberId: "robin",
			bucketId: "other-sports",
			name: "sports",
			color: 1,
			month,
			allowanceCents: 50_000,
		});
		for (const date of ["2026-09-02", "2026-09-05"]) {
			const id = await line("RIVERSIDE SWIM CLUB", { date, in: "other" });
			await db
				.update(transactions)
				.set({ bucketId: "other-sports" })
				.where(eq(transactions.id, id));
			await db
				.insert(transactionFor)
				.values({ transactionId: id, memberId: "ivy", householdId: "other" });
		}
		expect(
			await likelyOf(alex, await line("RIVERSIDE SWIM CLUB", { waits: true })),
		).toBeUndefined();
	});
});
