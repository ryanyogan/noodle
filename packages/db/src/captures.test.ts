import type { DayKey, MonthKey, StatementLine } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBucket,
	addCapture,
	clearHouseholdRows,
	createCaptureToken,
	createHouseholdForParent,
	type Db,
	deleteTransaction,
	deleteTransactions,
	findCaptureToken,
	importStatement,
	loadCaptureToken,
	loadMatch,
	loadTransactionsPage,
	revokeCaptureToken,
	setTakeHomePay,
} from "./index";
import { captureCards, members, transactions } from "./schema";
import { testDb } from "./test-db";

// The ingest seam for tap to capture: a capture goes in through addCapture, as the ingest Queue's
// consumer writes it, statements through importStatement, and what counts is read back through
// the reads the app makes.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
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
	await setTakeHomePay(db, { householdId, memberId: parentId, month, amountCents: 600_000 });
	await addBucket(db, {
		householdId,
		memberId: parentId,
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
	await createCaptureToken(db, {
		householdId,
		memberId: parentId,
		tokenId: "token",
		tokenHash: "hash",
	});
});

const capture = (
	id: string,
	date: DayKey,
	amountCents: number,
	merchant: string,
	tokenId = "token",
) =>
	addCapture(db, {
		tokenId,
		householdId,
		memberId: parentId,
		transactionId: id,
		date,
		amountCents,
		merchant,
		newId,
	});

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

async function listed() {
	const page = await loadTransactionsPage(db, viewer, { month, limit: 50 });
	return page.transactions.map((row) => ({
		id: row.id,
		amount: row.amountCents,
		bucket: row.bucketId,
	}));
}

describe("tap to capture", () => {
	it("records a capture as the Parent's Quick Add, and its bank copy Matches it: one Transaction", async () => {
		expect(await capture("coffee", "2026-09-10", 575, "Blue Bottle Coffee")).toEqual({
			ok: true,
			added: true,
			matchedMonths: [],
		});
		const result = await importLines("import-1", [
			spent("2026-09-12", 575, "BLUE BOTTLE COFFEE OAKLAND"),
		]);
		expect(result).toMatchObject({ ok: true, matched: 1 });
		expect(await listed()).toEqual([{ id: "coffee", amount: 575, bucket: null }]);
		expect(await loadMatch(db, viewer, "coffee")).toMatchObject({
			kind: "matched",
			automatic: true,
		});
	});

	it("Matches a bank copy that was imported before the capture arrived", async () => {
		await importLines("import-1", [spent("2026-09-11", 575, "BLUE BOTTLE COFFEE OAKLAND")]);
		const result = await capture("coffee", "2026-09-10", 575, "Blue Bottle Coffee");
		expect(result).toMatchObject({ ok: true, matchedMonths: ["2026-09"] });
		expect(await listed()).toEqual([{ id: "coffee", amount: 575, bucket: null }]);
	});

	it("records a capture delivered twice once", async () => {
		await capture("coffee", "2026-09-10", 575, "Blue Bottle Coffee");
		expect(await capture("coffee", "2026-09-10", 575, "Blue Bottle Coffee")).toMatchObject({
			ok: true,
			added: false,
		});
		expect(await listed()).toHaveLength(1);
	});

	it("refuses a capture with a revoked token, and a new token replaces the old", async () => {
		expect(await findCaptureToken(db, "hash")).toMatchObject({
			memberId: parentId,
			timeZone: "America/Chicago",
		});
		await createCaptureToken(db, {
			householdId,
			memberId: parentId,
			tokenId: "token-2",
			tokenHash: "hash-2",
		});
		expect(await findCaptureToken(db, "hash")).toBeNull();
		expect(await capture("coffee", "2026-09-10", 575, "Blue Bottle")).toEqual({
			ok: false,
			reason: "revoked",
		});
		await revokeCaptureToken(db, householdId, parentId);
		expect(await findCaptureToken(db, "hash-2")).toBeNull();
		expect(await loadCaptureToken(db, householdId, parentId)).toBeNull();
		expect(await capture("coffee", "2026-09-10", 575, "Blue Bottle", "token-2")).toEqual({
			ok: false,
			reason: "revoked",
		});
		expect(await listed()).toEqual([]);
	});

	it("makes tokens only for the Household's Parents", async () => {
		await createCaptureToken(db, {
			householdId: "elsewhere",
			memberId: "sam",
			tokenId: "x",
			tokenHash: "x",
		});
		expect(await findCaptureToken(db, "x")).toBeNull();
	});
});

describe("deleting a capture that named a Wallet card", () => {
	const captureWithCard = (id: string) =>
		addCapture(db, {
			tokenId: "token",
			householdId,
			memberId: parentId,
			transactionId: id,
			date: "2026-09-12",
			amountCents: 1_840,
			merchant: "Taqueria",
			card: "Sapphire",
			newId,
		});
	const left = async () => ({
		transactions: (await db.select({ id: transactions.id }).from(transactions)).length,
		cards: (await db.select({ id: captureCards.transactionId }).from(captureCards)).length,
	});

	it("deletes one, and the card it named goes with it", async () => {
		await captureWithCard("tap-1");
		expect(await left()).toEqual({ transactions: 1, cards: 1 });
		await deleteTransaction(db, { householdId, memberId: parentId, transactionId: "tap-1" });
		expect(await left()).toEqual({ transactions: 0, cards: 0 });
	});

	it("deletes many, and the cards they named go with them", async () => {
		await captureWithCard("tap-1");
		await captureWithCard("tap-2");
		expect(await deleteTransactions(db, viewer, { ids: ["tap-1", "tap-2"] })).toEqual({
			deleted: 2,
		});
		expect(await left()).toEqual({ transactions: 0, cards: 0 });
	});

	it("clears them in a Fresh start", async () => {
		await captureWithCard("tap-1");
		await clearHouseholdRows(db, householdId, "fresh-start");
		expect(await left()).toEqual({ transactions: 0, cards: 0 });
	});
});
