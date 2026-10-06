import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	createHouseholdForParent,
	type Db,
	fileTransactions,
	loadTransactionsPage,
	unfileTransactions,
} from "./index";
import {
	accounts,
	categorizations,
	goals,
	members,
	monthCloses,
	refunds,
	splits,
	transactionFor,
	transactions,
	transfers,
} from "./schema";
import { testDb } from "./test-db";

// "File in…" on the Transactions page (issue 99, ADR-0055): many Transactions filed in one Bucket
// at once, what it leaves alone and counts, and its Undo.

const householdId = "household";
const viewer = { householdId, memberId: "alex" };
const month = "2026-09";
const groceries = { bucketId: "groceries" };
const none = {
	split: 0,
	transfer: 0,
	moneyBack: 0,
	goal: 0,
	private: 0,
	changed: 0,
	otherMonth: 0,
};

let db: Db;

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	for (const [bucketId, name, color] of [
		["groceries", "Groceries", 1],
		["fun", "Fun", 2],
	] as const) {
		await addBucket(db, { ...viewer, bucketId, name, color, month, allowanceCents: 50_000 });
	}
});

const add = (id: string, extra: Partial<typeof transactions.$inferInsert> = {}) =>
	db.insert(transactions).values({
		id,
		householdId,
		source: "quick-add",
		date: "2026-09-05",
		amountCents: 1000,
		note: id,
		createdByMemberId: "alex",
		...extra,
	});

const filedIn = async () =>
	Object.fromEntries(
		(
			await db
				.select({
					id: transactions.id,
					bucketId: transactions.bucketId,
					version: transactions.version,
				})
				.from(transactions)
				.orderBy(asc(transactions.id))
		).map((row) => [row.id, `${row.bucketId ?? "-"} v${row.version}`]),
	);

/** a, b plain; f in Fun; s split; t, u a Transfer; m money back; g Goal spending; old in August. */
async function history() {
	await add("a");
	await add("b");
	await add("f", { bucketId: "fun" });
	await add("s");
	await add("t");
	await add("u");
	await add("m", { amountCents: -500 });
	await db
		.insert(accounts)
		.values({ id: "savings", householdId, name: "Savings", kind: "savings" });
	await db.insert(goals).values({
		id: "trip",
		householdId,
		name: "Trip",
		targetCents: 100_000,
		accountId: "savings",
		fromMonth: "2026-08",
	});
	await add("g", { goalId: "trip" });
	await add("old", { date: "2026-08-20" });
	await db.insert(splits).values([
		{ id: "s1", householdId, transactionId: "s", position: 0, amountCents: 600, bucketId: "fun" },
		{ id: "s2", householdId, transactionId: "s", position: 1, amountCents: 400, bucketId: "fun" },
	]);
	await db
		.insert(transfers)
		.values({ id: "x1", householdId, outTransactionId: "t", inTransactionId: "u" });
	await db.insert(monthCloses).values({ id: "mc", householdId, month: "2026-08" });
}

describe("filing many Transactions at once", () => {
	it("files what one Bucket can take whole, and counts what it leaves", async () => {
		await history();
		await db.insert(categorizations).values({
			transactionId: "f",
			householdId,
			outcome: "filed",
			method: "rule",
			merchant: "f",
		} as never);
		const result = await fileTransactions(db, viewer, {
			selection: { ids: ["a", "b", "f", "s", "t", "u", "m", "g", "old"] },
			month,
			assignment: groceries,
		});
		expect(result).toEqual({
			ok: true,
			filed: 3,
			already: 0,
			skipped: { ...none, split: 1, transfer: 2, moneyBack: 1, goal: 1, otherMonth: 1 },
			undo: [
				{ id: "a", bucketId: null, commitmentId: null, version: 1 },
				{ id: "b", bucketId: null, commitmentId: null, version: 1 },
				{ id: "f", bucketId: "fun", commitmentId: null, version: 1 },
			],
		});
		expect(await filedIn()).toEqual({
			a: "groceries v1",
			b: "groceries v1",
			f: "groceries v1",
			g: "- v0",
			m: "- v0",
			old: "- v0",
			s: "- v0",
			t: "- v0",
			u: "- v0",
		});
		// Filed by a Parent now: no longer categorization's to change.
		expect(await db.select().from(categorizations)).toEqual([]);
		// The Split's parts are as they were.
		expect((await db.select().from(splits)).map((row) => row.bucketId)).toEqual(["fun", "fun"]);
	});

	it("money back linked as a Refund is left too", async () => {
		await add("a");
		await add("r", { amountCents: 300 });
		await db
			.insert(refunds)
			.values({ id: "r1", householdId, refundTransactionId: "r", originalTransactionId: "a" });
		const result = await fileTransactions(db, viewer, {
			selection: { ids: ["a", "r"] },
			month,
			assignment: groceries,
		});
		expect(result.ok && [result.filed, result.skipped.moneyBack]).toEqual([1, 1]);
	});

	it("leaves a row that has moved on from the version the screen showed", async () => {
		await add("a");
		await add("b", { version: 4 });
		const result = await fileTransactions(db, viewer, {
			selection: { ids: ["a", "b"] },
			month,
			assignment: groceries,
			versions: { a: 0, b: 3 },
		});
		expect(result.ok && [result.filed, result.skipped]).toEqual([1, { ...none, changed: 1 }]);
		expect(await filedIn()).toEqual({ a: "groceries v1", b: "- v4" });
	});

	it("is safe to run twice: what is already there is not touched", async () => {
		await add("a");
		const input = {
			selection: { ids: ["a"] },
			month,
			assignment: groceries,
			versions: { a: 0 },
		} as const;
		await fileTransactions(db, viewer, { ...input, selection: { ids: ["a"] } });
		const again = await fileTransactions(db, viewer, { ...input, selection: { ids: ["a"] } });
		expect(again).toEqual({ ok: true, filed: 0, already: 1, skipped: none, undo: [] });
		expect(await filedIn()).toEqual({ a: "groceries v1" });
	});

	it("takes everything the list's filters match, as the list shows it", async () => {
		await history();
		const all = { month, search: "a" } as const;
		const listed = (
			await loadTransactionsPage(db, viewer, { month, search: "a", limit: 50 })
		).transactions.map((row) => row.id);
		expect(listed.sort()).toEqual(["a"]);
		const result = await fileTransactions(db, viewer, {
			selection: { all: { month }, except: ["b"] },
			month,
			assignment: groceries,
		});
		// Everything in September but b: a and f filed, the rest counted. August's is not selected.
		expect(result.ok && [result.filed, result.skipped]).toEqual([
			2,
			{ ...none, split: 1, transfer: 2, moneyBack: 1, goal: 1 },
		]);
		const searched = await fileTransactions(db, viewer, {
			selection: { all },
			month,
			assignment: { bucketId: "fun" },
		});
		expect(searched.ok && searched.undo.map((row) => row.id)).toEqual(listed);
	});

	it("only inside one month, and a closed month is filed like any other", async () => {
		await history();
		const more = await fileTransactions(db, viewer, {
			selection: { all: { month, andEarlier: true } },
			month,
			assignment: groceries,
		});
		expect(more).toEqual({ ok: false, reason: "more-than-a-month" });
		expect(
			await fileTransactions(db, viewer, {
				selection: { all: { month: "2026-08" } },
				month,
				assignment: groceries,
			}),
		).toEqual({ ok: false, reason: "more-than-a-month" });
		// Groceries began in September: it is not in August's Plan.
		expect(
			await fileTransactions(db, viewer, {
				selection: { ids: ["old"] },
				month: "2026-08",
				assignment: groceries,
			}),
		).toEqual({ ok: false, reason: "not-in-plan" });
		await addBucket(db, {
			...viewer,
			bucketId: "early",
			name: "Early",
			color: 3,
			month: "2026-08",
			allowanceCents: 1000,
		});
		const closed = await fileTransactions(db, viewer, {
			selection: { ids: ["old"] },
			month: "2026-08",
			assignment: { bucketId: "early" },
		});
		expect(closed.ok && closed.filed).toBe(1);
	});

	it("another Household's Transactions and Buckets are refused", async () => {
		await add("a");
		await createHouseholdForParent(db, {
			clerkUserId: "clerk-other",
			householdId: "other",
			householdName: "The Others",
			timeZone: "America/Chicago",
			parentId: "sam",
			parentName: "Sam",
		});
		const other = { householdId: "other", memberId: "sam" };
		expect(
			await fileTransactions(db, other, {
				selection: { ids: ["a"] },
				month,
				assignment: groceries,
			}),
		).toEqual({ ok: false, reason: "not-in-plan" });
		await addBucket(db, {
			...other,
			bucketId: "theirs",
			name: "Theirs",
			color: 1,
			month,
			allowanceCents: 1000,
		});
		expect(
			await fileTransactions(db, other, {
				selection: { all: { month } },
				month,
				assignment: { bucketId: "theirs" },
			}),
		).toEqual({ ok: true, filed: 0, already: 0, skipped: none, undo: [] });
		expect(
			await fileTransactions(db, viewer, {
				selection: { ids: ["a"] },
				month,
				assignment: { bucketId: "theirs" },
			}),
		).toEqual({ ok: false, reason: "not-in-plan" });
		expect(await filedIn()).toEqual({ a: "- v0" });
	});

	it("Undo puts each back where it was, unless it has changed since", async () => {
		await history();
		const result = await fileTransactions(db, viewer, {
			selection: { ids: ["a", "b", "f"] },
			month,
			assignment: groceries,
		});
		if (!result.ok) throw new Error("not filed");
		// b is changed on another screen before Undo.
		await db.update(transactions).set({ version: 2 }).where(eq(transactions.id, "b"));
		expect(await unfileTransactions(db, viewer, result.undo)).toEqual({ restored: 2 });
		const now = await filedIn();
		expect([now.a, now.b, now.f]).toEqual(["- v2", "groceries v2", "fun v2"]);
		// A second Undo, and another Household's, change nothing.
		expect(await unfileTransactions(db, viewer, result.undo)).toEqual({ restored: 0 });
		expect(
			await unfileTransactions(db, { householdId: "nobody", memberId: "x" }, [
				{ id: "a", bucketId: "groceries", commitmentId: null, version: 2 },
			]),
		).toEqual({ restored: 0 });
		// Nor can it put one in a Bucket that isn't the Household's.
		expect(
			await unfileTransactions(db, viewer, [
				{ id: "a", bucketId: "no-such-bucket", commitmentId: null, version: 2 },
			]),
		).toEqual({ restored: 0 });
	});
	// For as well as the assignment (issue 138): the same path, and the same Undo.
	describe("with For", () => {
		const forOf = async () => {
			const rows = await db
				.select()
				.from(transactionFor)
				.orderBy(asc(transactionFor.transactionId), asc(transactionFor.memberId));
			const by: Record<string, string[]> = {};
			for (const row of rows)
				by[row.transactionId] = [...(by[row.transactionId] ?? []), row.memberId];
			return by;
		};
		beforeEach(async () => {
			await db.insert(members).values([
				{ id: "mia", householdId, kind: "child", name: "Mia" },
				{ id: "leo", householdId, kind: "child", name: "Leo" },
			]);
			await add("a");
			await add("b");
			await add("g", { bucketId: "groceries" });
			await add("s");
			await db.insert(splits).values([
				{
					id: "s1",
					householdId,
					transactionId: "s",
					position: 0,
					bucketId: "fun",
					amountCents: 400,
				},
				{
					id: "s2",
					householdId,
					transactionId: "s",
					position: 1,
					bucketId: "groceries",
					amountCents: 600,
				},
			]);
			await db.insert(transactionFor).values([
				{ transactionId: "b", memberId: "leo", householdId },
				{ transactionId: "s", memberId: "leo", householdId },
			]);
		});

		it("leaves For as it is unless one is given", async () => {
			await fileTransactions(db, viewer, {
				selection: { ids: ["a", "b"] },
				month,
				assignment: groceries,
			});
			expect(await forOf()).toEqual({ b: ["leo"], s: ["leo"] });
		});

		it("sets For on what it files, also one already in the Bucket, and never on what it leaves", async () => {
			const result = await fileTransactions(db, viewer, {
				selection: { ids: ["a", "b", "g", "s"] },
				month,
				assignment: groceries,
				forMemberIds: ["mia"],
			});
			expect(result).toMatchObject({
				ok: true,
				filed: 3,
				already: 0,
				skipped: { ...none, split: 1 },
			});
			expect(await forOf()).toEqual({ a: ["mia"], b: ["mia"], g: ["mia"], s: ["leo"] });
			expect(await filedIn()).toMatchObject({
				a: "groceries v1",
				b: "groceries v1",
				g: "groceries v1",
			});
			// Again: all three are there with that For already.
			expect(
				await fileTransactions(db, viewer, {
					selection: { ids: ["a", "b", "g"] },
					month,
					assignment: groceries,
					forMemberIds: ["mia"],
				}),
			).toMatchObject({ ok: true, filed: 0, already: 3 });
			// Everyone is a For too: it clears the Members.
			await fileTransactions(db, viewer, {
				selection: { ids: ["a"] },
				month,
				assignment: groceries,
				forMemberIds: [],
			});
			expect((await forOf()).a).toBeUndefined();
		});

		it("takes only the Household's Members", async () => {
			await createHouseholdForParent(db, {
				clerkUserId: "clerk-other",
				householdId: "other",
				householdName: "The Others",
				timeZone: "America/Chicago",
				parentId: "sam",
				parentName: "Sam",
			});
			await fileTransactions(db, viewer, {
				selection: { ids: ["a"] },
				month,
				assignment: groceries,
				forMemberIds: ["sam", "mia"],
			});
			expect((await forOf()).a).toEqual(["mia"]);
		});

		it("Undo puts For back with the Bucket, unless it has changed since", async () => {
			const result = await fileTransactions(db, viewer, {
				selection: { ids: ["a", "b", "g"] },
				month,
				assignment: groceries,
				forMemberIds: ["mia", "leo"],
			});
			if (!result.ok) throw new Error("not filed");
			expect(result.undo).toEqual([
				{ id: "a", bucketId: null, commitmentId: null, version: 1, for: [] },
				{ id: "b", bucketId: null, commitmentId: null, version: 1, for: ["leo"] },
				{ id: "g", bucketId: "groceries", commitmentId: null, version: 1, for: [] },
			]);
			// g is changed on another screen before Undo: its Bucket and its For stay.
			await db.update(transactions).set({ version: 2 }).where(eq(transactions.id, "g"));
			expect(await unfileTransactions(db, viewer, result.undo)).toEqual({ restored: 2 });
			expect(await forOf()).toEqual({ b: ["leo"], g: ["leo", "mia"], s: ["leo"] });
			expect(await filedIn()).toMatchObject({ a: "- v2", b: "- v2", g: "groceries v2" });
			// A second Undo changes nothing, For included.
			await db.insert(transactionFor).values({ transactionId: "a", memberId: "mia", householdId });
			expect(await unfileTransactions(db, viewer, result.undo)).toEqual({ restored: 0 });
			expect((await forOf()).a).toEqual(["mia"]);
		});
	});
});
