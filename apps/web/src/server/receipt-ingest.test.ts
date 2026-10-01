import {
	addAccount,
	addBucket,
	addChild,
	addPersonalAllowance,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	deleteTransaction,
	findReceiptAddress,
	importStatement,
	loadReceipt,
	setReceiptAddress,
	setTakeHomePay,
} from "@noodle/db";
import { members, receipts, splitFor, splits, transactions } from "@noodle/db/schema";
import { testDb } from "@noodle/db/test-db";
import { beforeEach, describe, expect, it } from "vitest";
import {
	emailReceipt,
	fileReceiptEmail,
	type InboundEmail,
	type ReceiptMessage,
	receiveReceiptEmail,
} from "./receipt-email";
import amazonEml from "./receipt-fixtures/amazon.eml?raw";
import costcoEml from "./receipt-fixtures/costco.eml?raw";
import photoEml from "./receipt-fixtures/photo.eml?raw";
import targetEml from "./receipt-fixtures/target.eml?raw";
import { readReceiptAnswer, stubReceiptReader } from "./receipt-model";

// The Receipt seam, end to end but for the Worker: an email sent to the Household's Receipt
// address is received as the email handler does, what it queues is filed as the ingest Queue's
// consumer does, with the fake model, and what's written is read back as the app reads it.

const householdId = "household";
const month = "2026-09";
const alex = { householdId, memberId: "alex" };
const sam = { householdId, memberId: "sam" };
const now = new Date("2026-09-10T18:30:00Z");
const KEY = "k3y7abc";

let db: Db;
let stored: Map<string, Uint8Array>;
let queue: ReceiptMessage[];
let categorized: string[];
let ids = 0;
const newId = () => `row-${String(++ids).padStart(4, "0")}`;

beforeEach(async () => {
	db = testDb();
	stored = new Map();
	queue = [];
	categorized = [];
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
		["home", "Home"],
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
	await setReceiptAddress(db, { householdId, key: KEY, replace: false });
});

/** Each Parent's verified addresses, as Clerk has them. */
const VERIFIED: Record<string, string[]> = { alex: ["alex@example.com"], sam: ["sam@example.com"] };

/** An email arriving at `to` from `from`, as Email Routing hands it over; records any rejection. */
function inbound(eml: string, from = "alex@example.com", to = `receipts+${KEY}@receipts.test`) {
	const raw = eml.replaceAll("\n", "\r\n");
	const headers = new Headers();
	for (const line of raw.split("\r\n\r\n")[0]?.split("\r\n") ?? []) {
		const colon = line.indexOf(":");
		if (colon > 0) headers.append(line.slice(0, colon), line.slice(colon + 1).trim());
	}
	const email = {
		from,
		to,
		headers,
		raw: new Response(raw).body as ReadableStream<Uint8Array>,
		rejected: null as string | null,
		setReject(reason: string) {
			email.rejected = reason;
		},
	};
	return email;
}

/** Receives an email as the Worker's email handler does. */
async function receive(email: InboundEmail) {
	return receiveReceiptEmail(email, {
		findAddress: (key) => findReceiptAddress(db, key),
		parentWithEmail: async (_householdId, address) =>
			Object.entries(VERIFIED).find(([, emails]) => emails.includes(address))?.[0] ?? null,
		store: async (key, bytes) => {
			stored.set(key, bytes);
		},
		enqueue: async (message) => {
			queue.push(message);
		},
		now,
	});
}

/** Files everything queued, as the ingest Queue's consumer does. */
async function consume() {
	const filed = [];
	for (const message of queue.splice(0)) {
		filed.push(
			await fileReceiptEmail(
				{
					db,
					reader: stubReceiptReader,
					load: async (key) => stored.get(key) ?? null,
					store: async (key, bytes) => {
						stored.set(key, bytes);
					},
					thumbnail: async () => new TextEncoder().encode("webp"),
					newId,
					categorize: async (_viewer, transactionId) => {
						categorized.push(transactionId);
					},
				},
				message,
			),
		);
	}
	return filed;
}

/** Forwards `eml` and files it. */
async function forward(eml: string) {
	await receive(inbound(eml));
	const [filed] = await consume();
	return filed;
}

/** A Transaction's Splits: Bucket, amount, and For, in order of amount. */
async function splitsOf(transactionId: string) {
	const rows = (await db.select().from(splits)).filter((s) => s.transactionId === transactionId);
	const fors = await db.select().from(splitFor);
	return rows
		.map((split) => ({
			bucketId: split.bucketId,
			amountCents: split.amountCents,
			for: fors
				.filter((f) => f.splitId === split.id)
				.map((f) => f.memberId)
				.sort(),
		}))
		.sort((a, b) => b.amountCents - a.amountCents);
}

async function importLine(description: string, dollars: number, date = "2026-09-09") {
	const result = await importStatement(db, {
		householdId,
		importId: newId(),
		accountId: "card",
		source: "csv",
		fileName: "statement.csv",
		fileKey: null,
		lines: [
			{ date: date as "2026-09-09", amount: -Math.round(dollars * 100), description, bankId: null },
		],
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: "alex",
		newId,
	});
	expect(result.ok).toBe(true);
	const row = (await db.select().from(transactions)).find((t) => t.note === description);
	return row?.id as string;
}

describe("receiving a Receipt's email", () => {
	it("rejects an address that isn't in use, and queues nothing", async () => {
		const email = inbound(costcoEml, "alex@example.com", "receipts+nope@receipts.test");
		expect(await receive(email)).toBeNull();
		expect(email.rejected).toMatch(/isn’t in use/);
		const plain = inbound(costcoEml, "alex@example.com", "receipts@receipts.test");
		await receive(plain);
		expect(plain.rejected).toMatch(/isn’t in use/);
		expect(queue).toEqual([]);
		expect(stored.size).toBe(0);
	});

	it("rejects a sender who isn't one of the Household's Parents at a verified address", async () => {
		const email = inbound(costcoEml, "stranger@example.com");
		expect(await receive(email)).toBeNull();
		expect(email.rejected).toMatch(/Parents/);
		expect(queue).toEqual([]);
	});

	it("keeps the email and queues it for the Parent who sent it, dated in the Household's day", async () => {
		const email = inbound(
			costcoEml,
			"Alex@Example.com",
			`receipts+${KEY.toUpperCase()}@receipts.test`,
		);
		const queued = await receive(email);
		expect(email.rejected).toBeNull();
		expect(queued).toMatchObject({
			kind: "receipt",
			householdId,
			memberId: "alex",
			received: "2026-09-10",
		});
		expect(stored.has(queued?.fileKey as string)).toBe(true);
		expect(queued?.fileKey).toBe(`receipts/${householdId}/${queued?.receiptId}.eml`);
	});
});

describe("filing a forwarded Receipt", () => {
	it("makes a Quick Add for one with no Transaction yet, and applies its Splits when sure", async () => {
		const filed = await forward(costcoEml);
		expect(filed).toMatchObject({ added: true, quickAdd: true, applied: true });
		const [quickAdd] = await db.select().from(transactions);
		expect(quickAdd).toMatchObject({
			id: filed?.transactionId,
			date: "2026-09-08",
			amountCents: 4971,
			note: "COSTCO WHOLESALE",
			capturedVia: "receipt",
			createdByMemberId: "alex",
		});
		// Milk and bananas; the paper towel less its coupon, and detergent; tax shared out.
		expect(await splitsOf(quickAdd?.id as string)).toEqual([
			{ bucketId: "home", amountCents: 3957, for: [] },
			{ bucketId: "groceries", amountCents: 1014, for: [] },
		]);
		expect(categorized).toEqual([]);
	});

	it("files a redelivered email once", async () => {
		const first = await forward(costcoEml);
		const again = await forward(costcoEml);
		expect(again).toMatchObject({ added: false, transactionId: first?.transactionId });
		expect(await db.select().from(receipts)).toHaveLength(1);
		expect(await db.select().from(transactions)).toHaveLength(1);
		expect(await splitsOf(first?.transactionId as string)).toHaveLength(2);
	});

	it("attaches to the imported Transaction it's for and splits it, For whoever each item was", async () => {
		const imported = await importLine("TARGET 00012345", 41.99);
		const filed = await forward(targetEml);
		expect(filed).toMatchObject({
			added: true,
			quickAdd: false,
			applied: true,
			transactionId: imported,
		});
		expect(await db.select().from(transactions)).toHaveLength(1);
		expect(await splitsOf(imported)).toEqual([
			{ bucketId: "kids", amountCents: 3190, for: ["maya"] },
			{ bucketId: "hockey", amountCents: 584, for: [] },
			{ bucketId: "kids", amountCents: 425, for: [] },
		]);
	});

	it("attaches to a Quick Add a Parent already filed, without changing their Bucket", async () => {
		await addQuickAdd(db, {
			householdId,
			transactionId: "01K000000000000000000QUICK",
			bucketId: "groceries",
			date: "2026-09-09",
			amountCents: 4199,
			note: "Target",
			forMemberIds: [],
			createdByMemberId: "sam",
		});
		const filed = await forward(targetEml);
		expect(filed).toMatchObject({ transactionId: "01K000000000000000000QUICK", applied: false });
		const [row] = await db.select().from(transactions);
		expect(row?.bucketId).toBe("groceries");
		expect(await splitsOf(row?.id as string)).toEqual([]);
		// The Parent who sent it still sees what it proposes.
		const view = await loadReceipt(db, alex, row?.id as string);
		expect(view?.lines.map((line) => line.bucketId)).toEqual(["kids", "hockey", "kids", null]);
	});

	it("files an unsure one's Quick Add as a capture is, and keeps the other Parent's view private", async () => {
		const filed = await forward(amazonEml);
		expect(filed).toMatchObject({ added: true, quickAdd: true, applied: false });
		expect(categorized).toEqual([filed?.transactionId]);
		const mine = await loadReceipt(db, alex, filed?.transactionId as string);
		expect(mine).toMatchObject({ merchant: "Amazon.com order", totalCents: 6349 });
		expect(mine?.lines.map((line) => [line.text, line.bucketId])).toEqual([
			["Echo Dot", null],
			["Alex's Secret Stash gift card", "alex-pa"],
			["Estimated tax", null],
		]);
		const theirs = await loadReceipt(db, sam, filed?.transactionId as string);
		expect(theirs?.lines.map((line) => line.bucketId)).toEqual([null, null, null]);
	});

	it("keeps a Receipt it can't read, unattached, with a thumbnail of its picture", async () => {
		const filed = await forward(photoEml);
		expect(filed).toMatchObject({ added: true, quickAdd: false, transactionId: null });
		const [receipt] = await db.select().from(receipts);
		expect(receipt?.thumbnailKey).toBe(`receipts/${householdId}/${receipt?.id}-thumb.webp`);
		expect(stored.has(receipt?.thumbnailKey as string)).toBe(true);
		expect(await db.select().from(transactions)).toEqual([]);
	});

	it("is left unattached when its Transaction is deleted", async () => {
		const filed = await forward(costcoEml);
		await deleteTransaction(db, { ...alex, transactionId: filed?.transactionId as string });
		const [receipt] = await db.select().from(receipts);
		expect(receipt?.transactionId).toBeNull();
	});
});

describe("reading a Receipt's email", () => {
	it("reads an attached PDF first, then an attached picture (not an inline one), then its text", async () => {
		const photo = await emailReceipt(new TextEncoder().encode(photoEml.replaceAll("\n", "\r\n")));
		expect(photo.input).toMatchObject({ kind: "image", mimeType: "image/jpeg" });
		expect(new TextDecoder().decode(photo.picture?.bytes)).toBe("receipt");
		const withPdf = photoEml.replace(
			"--b2--",
			'--b2\nContent-Type: application/pdf\nContent-Disposition: attachment; filename="order.pdf"\nContent-Transfer-Encoding: base64\n\nJVBERg==\n--b2--',
		);
		const pdf = await emailReceipt(new TextEncoder().encode(withPdf.replaceAll("\n", "\r\n")));
		expect(pdf.input).toMatchObject({ kind: "pdf", name: "order.pdf" });
		const html = await emailReceipt(new TextEncoder().encode(amazonEml));
		expect(html.input).toMatchObject({ kind: "text" });
		expect(html.input.kind === "text" && html.input.text).toContain("Order Total: $63.49");
	});
});

describe("reading the model's answer", () => {
	const buckets = [
		{ id: "groceries", name: "Groceries" },
		{ id: "home", name: "Home" },
	];
	const people = [{ id: "maya", name: "Maya" }];

	it("maps codes to IDs and drops what isn't offered or isn't a line", () => {
		const answer = `Here you go:\n\`\`\`json\n${JSON.stringify({
			merchant: "Costco",
			date: "2026-09-08",
			total: "49.71",
			lines: [
				{
					text: "Milk",
					kind: "item",
					amount: "7.49",
					bucket: "b1",
					confidence: 0.9,
					for: ["p1", "p7"],
				},
				{ text: "Mystery", kind: "item", amount: "2.00", bucket: "b9", confidence: 0.9, for: [] },
				{ text: "Tax", kind: "tax", amount: "3.25", bucket: null, confidence: 0, for: [] },
				{ text: "", kind: "item", amount: "1.00" },
				{ text: "Odd", kind: "refund", amount: "1.00" },
			],
		})}\n\`\`\``;
		expect(readReceiptAnswer(answer, buckets, people)).toEqual({
			merchant: "Costco",
			date: "2026-09-08",
			total: "49.71",
			lines: [
				{
					text: "Milk",
					kind: "item",
					amount: "7.49",
					bucketId: "groceries",
					confidence: 0.9,
					for: ["maya"],
				},
				{ text: "Mystery", kind: "item", amount: "2.00", bucketId: null, confidence: 0, for: [] },
				{ text: "Tax", kind: "tax", amount: "3.25", bucketId: null, confidence: 0, for: [] },
			],
		});
	});

	it("reads an answer that isn't JSON as nothing", () => {
		expect(readReceiptAnswer("Sorry, I can't read that.", buckets, people)).toEqual({
			merchant: null,
			date: null,
			total: null,
			lines: [],
		});
	});
});
