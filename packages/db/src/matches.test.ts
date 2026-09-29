import type { DayKey, MonthKey, StatementLine } from "@noodle/domain";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBucket,
	addPersonalAllowance,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	deleteTransaction,
	importStatement,
	loadBucketUses,
	loadMatch,
	loadSpending,
	loadTransactionsPage,
	loadUncategorized,
	matchTransactions,
	setBaseline,
	unmatch,
} from "./index";
import { bucketLeftSql } from "./moves";
import { members } from "./schema";
import { testDb } from "./test-db";

// The ingest seam for Match: statements go in through importStatement, as an upload does, and
// what counts is read back through the same reads the app makes.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const sam = { householdId, memberId: "sam" };
const month: MonthKey = "2026-09";

let db: Db;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;

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
	await db.insert(members).values({
		id: "sam",
		householdId,
		kind: "parent",
		name: "Sam",
		clerkUserId: "clerk-sam",
	});
	await setBaseline(db, { householdId, month, amountCents: 600_000 });
	await addBucket(db, {
		householdId,
		bucketId: "eating",
		name: "Eating out",
		color: 1,
		month,
		allowanceCents: 40_000,
	});
	await addAccount(db, {
		householdId,
		accountId: "card",
		name: "Visa",
		kind: "credit-card",
		balanceCents: 0,
		balanceId: "card-balance",
		createdByMemberId: parentId,
	});
});

const quickAdd = (id: string, date: DayKey, amountCents: number, note: string, by = parentId) =>
	addQuickAdd(db, {
		householdId,
		transactionId: id,
		bucketId: "eating",
		date,
		amountCents,
		note,
		forMemberIds: [],
		createdByMemberId: by,
	});

/** A card statement line for money spent. */
const spent = (date: DayKey, amount: number, description: string): StatementLine => ({
	date,
	amount: -amount,
	description,
	bankId: null,
});

const importLines = (importId: string, lines: StatementLine[]) =>
	importStatement(db, {
		householdId,
		importId,
		accountId: "card",
		source: "csv",
		fileName: null,
		fileKey: null,
		lines,
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: parentId,
		newId,
	});

/** What the month's Eating out spending adds up to, and the Transactions listed. */
async function counted() {
	const spending = await loadSpending(db, viewer, month);
	const listed = await loadTransactionsPage(db, viewer, { month, limit: 50 });
	// The Cover guard's SQL agrees.
	const [left] = await db.values<[number]>(
		sql`select ${bucketLeftSql(householdId, "eating", month)}`,
	);
	return {
		spent: spending.reduce((sum, spend) => sum + spend.amount, 0),
		listed: listed.transactions.map((row) => row.id).sort(),
		left: left?.[0],
	};
}

describe("Match on Import", () => {
	it("Matches a Quick Add's bank copy so the spend counts once, in the Quick Add's Bucket", async () => {
		await quickAdd("dinner", "2026-09-10", 4_250, "Nopa");
		const result = await importLines("import-1", [
			spent("2026-09-12", 4_250, "NOPA SAN FRANCISCO"),
		]);
		expect(result).toMatchObject({ ok: true, matched: 1, import: { matchedCount: 1 } });
		expect(await counted()).toEqual({ spent: 4_250, listed: ["dinner"], left: 40_000 - 4_250 });
		expect(await loadMatch(db, viewer, "dinner")).toMatchObject({
			kind: "matched",
			automatic: true,
			peer: { amountCents: 4_250, date: "2026-09-12", note: "NOPA SAN FRANCISCO", account: "Visa" },
		});
		// The bank copy is no bucket use of its own either.
		expect(await loadBucketUses(db, viewer, "2026-09-01")).toHaveLength(1);
	});

	it("never offers a Quick Add's bank copy to categorization, only the unmatched lines", async () => {
		await quickAdd("dinner", "2026-09-10", 4_250, "Nopa");
		await importLines("import-1", [
			spent("2026-09-12", 4_250, "NOPA SAN FRANCISCO"),
			spent("2026-09-13", 6_100, "COSTCO WHSE #123"),
		]);
		const waiting = await loadUncategorized(db, householdId, "import-1");
		expect(waiting.map((row) => row.note)).toEqual(["COSTCO WHSE #123"]);
	});

	it("leaves a near miss alone: an amount off by a cent, or a date outside the window", async () => {
		await quickAdd("dinner", "2026-09-10", 4_250, "Nopa");
		await quickAdd("coffee", "2026-09-01", 500, "Starbucks");
		const result = await importLines("import-1", [
			spent("2026-09-11", 4_251, "NOPA SAN FRANCISCO"),
			spent("2026-09-07", 500, "STARBUCKS"),
		]);
		expect(result).toMatchObject({ ok: true, matched: 0 });
		const { spent: total, listed } = await counted();
		// Both Quick Adds count; the bank lines are unassigned, in no Bucket.
		expect(total).toBe(4_750);
		expect(listed).toHaveLength(4);
		// The tipped dinner is offered for a manual Match; the late coffee is too far.
		const dinner = await loadMatch(db, viewer, "dinner");
		expect(dinner).toMatchObject({ kind: "unmatched", possible: [{ amountCents: 4_251 }] });
		expect(await loadMatch(db, viewer, "coffee")).toEqual({ kind: "unmatched", possible: [] });
	});

	it("leaves ambiguous candidates for a Parent to Match by hand", async () => {
		await quickAdd("lunch-1", "2026-09-10", 1_500, "lunch");
		await quickAdd("lunch-2", "2026-09-11", 1_500, "lunch");
		const result = await importLines("import-1", [spent("2026-09-12", 1_500, "CHIPOTLE 123")]);
		expect(result).toMatchObject({ ok: true, matched: 0 });
		const bank = (await counted()).listed.find((id) => !id.startsWith("lunch")) as string;
		const view = await loadMatch(db, viewer, bank);
		expect(view).toMatchObject({ kind: "unmatched" });
		expect(view.kind === "unmatched" && view.possible.map((peer) => peer.id).sort()).toEqual([
			"lunch-1",
			"lunch-2",
		]);
		// The Parent picks one; the Match is idempotent by its ID.
		const input = { matchId: "match-1", quickAddId: "lunch-2", importedId: bank };
		expect(await matchTransactions(db, viewer, input)).toEqual({ ok: true, months: [month] });
		expect(await matchTransactions(db, viewer, input)).toEqual({ ok: true, months: [month] });
		expect(await counted()).toMatchObject({ spent: 3_000, listed: ["lunch-1", "lunch-2"] });
		// Neither side can be in a second Match.
		const again = { matchId: "match-2", quickAddId: "lunch-1", importedId: bank };
		expect(await matchTransactions(db, viewer, again)).toEqual({ ok: false, reason: "refused" });
	});

	it("is idempotent: importing the same statement again Matches nothing twice", async () => {
		await quickAdd("dinner", "2026-09-10", 4_250, "Nopa");
		const lines = [spent("2026-09-12", 4_250, "NOPA SAN FRANCISCO")];
		await importLines("import-1", lines);
		// A retry of the same Import, and the same statement uploaded again.
		expect(await importLines("import-1", lines)).toMatchObject({ ok: true, matched: 0 });
		expect(await importLines("import-2", lines)).toMatchObject({
			ok: true,
			matched: 0,
			import: { duplicateCount: 1, matchedCount: 0 },
		});
		expect(await counted()).toMatchObject({ spent: 4_250, listed: ["dinner"] });
	});

	it("never re-Matches a pair a Parent unmatched, even when the statement comes in again", async () => {
		await quickAdd("dinner", "2026-09-10", 4_250, "Nopa");
		const lines = [spent("2026-09-12", 4_250, "NOPA SAN FRANCISCO")];
		await importLines("import-1", lines);
		const view = await loadMatch(db, viewer, "dinner");
		if (view.kind !== "matched") throw new Error("expected a Match");
		expect(await unmatch(db, viewer, view.matchId)).toEqual({ ok: true, months: [month] });
		// The bank copy is back in the list; it's unassigned, so it's in no Bucket.
		expect((await counted()).listed).toHaveLength(2);
		expect(await importLines("import-2", lines)).toMatchObject({ ok: true, matched: 0 });
		expect((await counted()).listed).toHaveLength(2);
		// A Parent may still Match them again by hand.
		const again = { matchId: "match-2", quickAddId: "dinner", importedId: view.peer.id };
		expect(await matchTransactions(db, viewer, again)).toMatchObject({ ok: true });
		expect((await counted()).listed).toEqual(["dinner"]);
	});

	it("lets the bank copy count again when its Quick Add is deleted", async () => {
		await quickAdd("dinner", "2026-09-10", 4_250, "Nopa");
		await importLines("import-1", [spent("2026-09-12", 4_250, "NOPA SAN FRANCISCO")]);
		await deleteTransaction(db, { householdId, memberId: parentId, transactionId: "dinner" });
		expect((await counted()).listed).toHaveLength(1);
	});

	it("keeps a Personal Allowance Quick Add private, and its Match the Parent's alone", async () => {
		await addPersonalAllowance(db, {
			householdId,
			memberId: parentId,
			bucketId: "alex-pa",
			name: "Alex’s Personal Allowance",
			color: 2,
			month,
			allowanceCents: 10_000,
		});
		await addQuickAdd(db, {
			householdId,
			transactionId: "gift",
			bucketId: "alex-pa",
			date: "2026-09-10",
			amountCents: 3_000,
			note: "Gift",
			forMemberIds: [],
			createdByMemberId: parentId,
		});
		await importLines("import-1", [spent("2026-09-11", 3_000, "BOOKSHOP")]);
		// Matched automatically: the bank copy is gone from Sam's list too, and the spending is
		// only in Alex's Personal Allowance total.
		expect((await loadTransactionsPage(db, sam, { month, limit: 50 })).transactions).toEqual([]);
		expect(await loadMatch(db, sam, "gift")).toEqual({ kind: "none" });
		const view = await loadMatch(db, viewer, "gift");
		if (view.kind !== "matched") throw new Error("expected a Match");
		// Sam can't unmatch it.
		expect(await unmatch(db, sam, view.matchId)).toEqual({ ok: false, reason: "refused" });
		expect(await loadMatch(db, viewer, "gift")).toMatchObject({ kind: "matched" });
	});
});
