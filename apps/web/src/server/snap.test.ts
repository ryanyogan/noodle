import {
	addAccount,
	addBucket,
	addChild,
	addPersonalAllowance,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	importStatement,
	loadReceipt,
	loadUnfiledReceipt,
	setTakeHomePay,
} from "@noodle/db";
import { matches, members, receipts, transactions } from "@noodle/db/schema";
import { testDb } from "@noodle/db/test-db";
import { beforeEach, describe, expect, it } from "vitest";
import { type PhraseReader, stubPhraseReader } from "./phrase-model";
import { stubReceiptReader } from "./receipt-model";
import { readPhrase, snapReceipt } from "./snap-run";

// Snap and speak, end to end but for the Worker: a Receipt photo is kept and read with the fake
// model, then saved as a Quick Add as the app does; a phrase is read with the fake phrase model.

const householdId = "household";
const month = "2026-09";
const today = "2026-09-10";
const alex = { householdId, memberId: "alex" };
const sam = { householdId, memberId: "sam" };

let db: Db;
let stored: Map<string, Uint8Array>;
let ids = 0;
const newId = () => `row-${String(++ids).padStart(4, "0")}`;

beforeEach(async () => {
	db = testDb();
	stored = new Map();
	ids = 0;
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await db
		.insert(members)
		.values({ id: "sam", householdId, kind: "parent", name: "Sam", clerkUserId: "clerk-sam" });
	await addChild(db, { householdId, memberId: "maya", name: "Maya", color: 3 });
	await setTakeHomePay(db, { householdId, memberId: "alex", month, amountCents: 900_000 });
	for (const [bucketId, name] of [
		["groceries", "Groceries"],
		["eating-out", "Eating out"],
		["kids", "Kids"],
		["hockey", "Hockey"],
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
	await addPersonalAllowance(db, {
		householdId,
		memberId: "alex",
		bucketId: "alex-pa",
		name: "Alex's Secret Stash",
		color: 2,
		month,
		allowanceCents: 20_000,
	});
	await addAccount(db, {
		householdId,
		accountId: "card",
		name: "Visa",
		kind: "credit-card",
		balanceCents: 0,
		balanceId: "card-balance",
		createdByMemberId: "alex",
	});
});

/** A PNG carrying `text` in a tEXt chunk keyed "Receipt", as E2E snaps (the fake reads no CRC). */
function receiptPng(text: string): Uint8Array {
	const latin1 = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
	const chunk = (type: string, data: number[]) => {
		const length = data.length;
		return [
			(length >>> 24) & 255,
			(length >>> 16) & 255,
			(length >>> 8) & 255,
			length & 255,
			...latin1(type),
			...data,
			0,
			0,
			0,
			0,
		];
	};
	return new Uint8Array([
		137,
		80,
		78,
		71,
		13,
		10,
		26,
		10,
		...chunk("tEXt", latin1(`Receipt\0${text}`)),
		...chunk("IEND", []),
	]);
}

const MARKET = "Corner Market\n2026-09-07\nMILK 4.29\nBREAD 3.50\nTOTAL 7.79";
const TARGET =
	"Target\n2026-09-09\nLEGO CITY SET FOR MAYA 29.99\nCRAYONS 3.99\nTAX 2.52\nTOTAL 36.50";

/** Snaps a photo of a Receipt saying `text`, as `viewer`. */
function snap(text: string, viewer = alex, receiptId = "01K0000000000000000RECEIPT") {
	return snapReceipt(
		{
			db,
			reader: stubReceiptReader,
			store: async (key, bytes) => {
				stored.set(key, bytes);
			},
			thumbnail: async () => new TextEncoder().encode("webp"),
			newId,
		},
		viewer,
		{ receiptId, bytes: receiptPng(text), mimeType: "image/png" },
		today,
	);
}

/** Saves the Quick Add a snapped Receipt was drafted into, as the server function does. */
async function save(receiptId: string, bucketId: string, createdByMemberId = "alex") {
	const viewer = { householdId, memberId: createdByMemberId };
	const unfiled = await loadUnfiledReceipt(db, viewer, receiptId);
	return addQuickAdd(db, {
		householdId,
		transactionId: "01K00000000000000000QUICK1",
		bucketId,
		date: unfiled?.date ?? today,
		amountCents: 779,
		note: "Corner Market",
		forMemberIds: [],
		createdByMemberId,
		receipt: unfiled ? { id: receiptId, newId } : undefined,
	});
}

async function importLine(description: string, dollars: number, date: string) {
	const result = await importStatement(db, {
		householdId,
		importId: newId(),
		accountId: "card",
		source: "csv",
		fileName: "statement.csv",
		fileKey: null,
		lines: [
			{ date: date as "2026-09-07", amount: -Math.round(dollars * 100), description, bankId: null },
		],
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: "alex",
		newId,
	});
	expect(result.ok).toBe(true);
}

describe("snapping a Receipt", () => {
	it("keeps and reads one with no Transaction yet, unattached, as a draft to check", async () => {
		const result = await snap(MARKET);
		expect(result).toEqual({
			kind: "draft",
			receiptId: "01K0000000000000000RECEIPT",
			date: "2026-09-07",
			draft: { amountCents: 779, bucketId: "groceries", forMemberIds: [], note: "Corner Market" },
			buckets: 1,
		});
		const [receipt] = await db.select().from(receipts);
		expect(receipt).toMatchObject({
			source: "photo",
			memberId: "alex",
			transactionId: null,
			fileKey: `receipts/${householdId}/01K0000000000000000RECEIPT.png`,
		});
		expect(stored.has(receipt?.fileKey as string)).toBe(true);
		expect(await db.select().from(transactions)).toEqual([]);
		// Snapping it again keeps one Receipt.
		await snap(MARKET);
		expect(await db.select().from(receipts)).toHaveLength(1);
	});

	it("saves as a Quick Add dated as the Receipt is, with it attached", async () => {
		await snap(MARKET);
		expect(await save("01K0000000000000000RECEIPT", "groceries")).toEqual({
			ok: true,
			matchedMonths: [],
		});
		const [quickAdd] = await db.select().from(transactions);
		expect(quickAdd).toMatchObject({ date: "2026-09-07", amountCents: 779, bucketId: "groceries" });
		const view = await loadReceipt(db, alex, quickAdd?.id as string);
		expect(view).toMatchObject({ merchant: "Corner Market", totalCents: 779 });
		expect(await loadUnfiledReceipt(db, alex, "01K0000000000000000RECEIPT")).toBeNull();
	});

	it("Matches a bank copy imported before the Quick Add was saved", async () => {
		await snap(MARKET);
		await importLine("CORNER MARKET 0042", 7.79, "2026-09-08");
		expect(await save("01K0000000000000000RECEIPT", "groceries")).toEqual({
			ok: true,
			matchedMonths: ["2026-09"],
		});
		expect(await db.select().from(matches)).toHaveLength(1);
	});

	it("attaches to a Quick Add already there, without changing its Bucket", async () => {
		await addQuickAdd(db, {
			householdId,
			transactionId: "01K000000000000000000QUICK",
			bucketId: "groceries",
			date: "2026-09-09",
			amountCents: 3650,
			note: "Target",
			forMemberIds: [],
			createdByMemberId: "sam",
		});
		const result = await snap(TARGET);
		expect(result).toMatchObject({
			kind: "attached",
			transaction: { id: "01K000000000000000000QUICK", date: "2026-09-09", amountCents: 3650 },
			applied: false,
		});
		const [receipt] = await db.select().from(receipts);
		expect(receipt?.transactionId).toBe("01K000000000000000000QUICK");
		const [row] = await db.select().from(transactions);
		expect(row?.bucketId).toBe("groceries");
	});

	it("never attaches another Parent's Receipt to a Quick Add", async () => {
		await snap(MARKET);
		expect(await loadUnfiledReceipt(db, sam, "01K0000000000000000RECEIPT")).toBeNull();
		const result = await addQuickAdd(db, {
			householdId,
			transactionId: "01K00000000000000000QUICK1",
			bucketId: "groceries",
			date: "2026-09-07",
			amountCents: 779,
			note: null,
			forMemberIds: [],
			createdByMemberId: "sam",
			receipt: { id: "01K0000000000000000RECEIPT", newId },
		});
		expect(result.ok).toBe(true);
		const [receipt] = await db.select().from(receipts);
		expect(receipt?.transactionId).toBeNull();
	});
});

describe("reading a phrase", () => {
	it("reads the amount, Bucket and note from what was said", async () => {
		const draft = await readPhrase(
			{ db, reader: stubPhraseReader },
			alex,
			"  forty on pizza   after hockey ",
			month,
		);
		expect(draft).toEqual({
			amountCents: 4_000,
			bucketId: "eating-out",
			forMemberIds: [],
			note: "pizza after hockey",
		});
		const forMaya = await readPhrase(
			{ db, reader: stubPhraseReader },
			alex,
			"twelve fifty for Maya lego",
			month,
		);
		expect(forMaya).toMatchObject({ amountCents: 1_250, bucketId: "kids", forMemberIds: ["maya"] });
	});

	it("never offers or takes the other Parent's Personal Allowance", async () => {
		const offered: string[][] = [];
		const pointsAtStash: PhraseReader = {
			async read(_phrase, buckets) {
				offered.push(buckets.map((bucket) => bucket.id));
				return { amount: "40", bucketId: "alex-pa", for: ["sam", "nobody"], note: null };
			},
		};
		const draft = await readPhrase({ db, reader: pointsAtStash }, sam, "40 secret stash", month);
		expect(offered[0]).not.toContain("alex-pa");
		expect(draft).toEqual({ amountCents: 4_000, bucketId: null, forMemberIds: ["sam"], note: "" });
		const mine = await readPhrase({ db, reader: pointsAtStash }, alex, "40 secret stash", month);
		expect(mine.bucketId).toBe("alex-pa");
	});

	it("reads the amount from the phrase when the model's words aren't in it", async () => {
		const madeUp: PhraseReader = {
			async read() {
				return { amount: "$400", bucketId: null, for: [], note: "gas" };
			},
		};
		const draft = await readPhrase({ db, reader: madeUp }, alex, "gas was forty two", month);
		expect(draft.amountCents).toBe(4_200);
	});

	it("reads a phrase as nothing when the model fails, but for its amount", async () => {
		const failing: PhraseReader = {
			async read() {
				throw new Error("model down");
			},
		};
		const draft = await readPhrase({ db, reader: failing }, alex, "nine dollars", month);
		expect(draft).toEqual({ amountCents: 900, bucketId: null, forMemberIds: [], note: "" });
	});
});
