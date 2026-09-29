import {
	addAccount,
	addCapture,
	createCaptureToken,
	createHouseholdForParent,
	type Db,
	findCaptureToken,
	importStatement,
	loadTransactionsPage,
	revokeCaptureToken,
} from "@noodle/db";
import { testDb } from "@noodle/db/test-db";
import { beforeEach, describe, expect, it } from "vitest";
import { type CaptureMessage, hashCaptureToken, newCaptureToken, receiveCapture } from "./capture";

// The ingest seam for tap to capture, end to end but for the Worker: the Shortcut's request goes
// to the endpoint, what it puts on the ingest Queue is consumed as the Worker does (addCapture),
// and what's listed is read back as the app reads it.

const householdId = "household";
const parentId = "parent";
const now = new Date("2026-09-10T18:30:00Z");

let db: Db;
let token: string;
let queue: CaptureMessage[];
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;

beforeEach(async () => {
	db = testDb();
	queue = [];
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: "Alex",
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
	token = newCaptureToken();
	await createCaptureToken(db, {
		householdId,
		memberId: parentId,
		tokenId: "token",
		tokenHash: await hashCaptureToken(token),
	});
});

/** The Shortcut's request, as its Get Contents of URL action sends it. */
function post(body: unknown, bearer: string | null = token) {
	return receiveCapture(
		new Request("https://noodle.test/api/capture", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
			},
			body: typeof body === "string" ? body : JSON.stringify(body),
		}),
		{
			findToken: (hash) => findCaptureToken(db, hash),
			enqueue: async (message) => {
				queue.push(message);
			},
			now,
		},
	);
}

/** Consumes everything on the ingest Queue, as the Worker's consumer does. */
async function consume() {
	for (const message of queue.splice(0)) await addCapture(db, { ...message, newId });
}

async function listed() {
	const page = await loadTransactionsPage(
		db,
		{ householdId, memberId: parentId },
		{ month: "2026-09", limit: 50 },
	);
	return page.transactions.map((row) => ({
		date: row.date,
		amount: row.amountCents,
		note: row.note,
	}));
}

const payment = {
	merchant: "Blue Bottle Coffee",
	amount: "$5.75",
	at: "2026-09-10T13:29:58-05:00",
};

describe("the capture endpoint", () => {
	it("queues a capture and answers at once; then its bank copy Matches it: one Transaction", async () => {
		const response = await post(payment);
		expect(response.status).toBe(202);
		expect(queue).toHaveLength(1);
		await consume();
		expect(await listed()).toEqual([
			{ date: "2026-09-10", amount: 575, note: "Blue Bottle Coffee" },
		]);

		await importStatement(db, {
			householdId,
			importId: "import-1",
			accountId: "card",
			source: "csv",
			fileName: null,
			fileKey: null,
			lines: [
				{ date: "2026-09-12", amount: -575, description: "BLUE BOTTLE COFFEE", bankId: null },
			],
			closingBalance: null,
			csvMapping: null,
			createdByMemberId: parentId,
			newId,
		});
		expect(await listed()).toHaveLength(1);
	});

	it("records a capture sent twice, and so queued twice, once", async () => {
		expect((await post(payment)).status).toBe(202);
		expect((await post(payment)).status).toBe(202);
		expect(queue).toHaveLength(2);
		await consume();
		expect(await listed()).toHaveLength(1);
		// A second payment at the same merchant, for the same amount, is its own.
		await post({ ...payment, at: "2026-09-10T15:02:11-05:00" });
		await consume();
		expect(await listed()).toHaveLength(2);
	});

	it("accepts the Shortcut's own ID for the payment instead of a time", async () => {
		await post({ merchant: "Safeway", amount: 42.1, id: "payment-1" });
		await post({ merchant: "Safeway", amount: 42.1, id: "payment-1" });
		await consume();
		expect(await listed()).toEqual([{ date: "2026-09-10", amount: 4_210, note: "Safeway" }]);
	});

	it("refuses a missing, unknown, or revoked token with 401, and queues nothing", async () => {
		expect((await post(payment, null)).status).toBe(401);
		expect((await post(payment, "noodle_not-a-token")).status).toBe(401);
		await revokeCaptureToken(db, householdId, parentId);
		const response = await post(payment);
		expect(response.status).toBe(401);
		expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
		expect(queue).toEqual([]);
	});

	it("drops a capture queued before its token was revoked", async () => {
		await post(payment);
		await revokeCaptureToken(db, householdId, parentId);
		await consume();
		expect(await listed()).toEqual([]);
	});

	it("refuses what isn't a merchant and an amount spent with 400", async () => {
		for (const body of [
			"not json",
			{ amount: "$5.75" },
			{ merchant: "  ", amount: "$5.75" },
			{ merchant: "Blue Bottle" },
			{ merchant: "Blue Bottle", amount: "five" },
			{ merchant: "Blue Bottle", amount: "-$5.75" },
		]) {
			expect((await post(body)).status).toBe(400);
		}
		expect(queue).toEqual([]);
	});
});
