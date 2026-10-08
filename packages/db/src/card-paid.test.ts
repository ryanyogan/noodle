import { type DayKey, paidToCards, type StatementLine } from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addCommitment,
	addCommitmentPayment,
	createHouseholdForParent,
	type Db,
	importStatement,
	linkCommitment,
	loadGoals,
	markCardPayment,
	unmarkTransfer,
} from "./index";
import * as s from "./schema";
import { testDb } from "./test-db";

// What was paid to each card in a month (issue 150): the payments marked as a Transfer naming the
// card, plus the payments filed in a Commitment that pays it down, by the day each counts on. It
// is read from what a card's page already lists as its Payments (loadGoals' `sent` and `payments`).

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };

let db: Db;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;

const account = (
	accountId: string,
	kind: "credit-card" | "checking",
	purchases?: "statements" | "hand",
) =>
	addAccount(db, {
		householdId,
		accountId,
		name: accountId,
		kind,
		balanceCents: null,
		balanceId: `${accountId}-none`,
		createdByMemberId: parentId,
		purchases,
	});

const spent = (date: DayKey, amount: number, description: string): StatementLine => ({
	date,
	amount: -amount,
	description,
	bankId: null,
});

/** A line out of checking, marked as a Transfer naming the card; the Transfer's id is `transferId`. */
async function sent(transferId: string, card: string, date: DayKey, amount: number, words: string) {
	await importStatement(db, {
		householdId,
		importId: `import-${transferId}`,
		accountId: "checking",
		source: "csv",
		fileName: null,
		fileKey: null,
		lines: [spent(date, amount, words)],
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: parentId,
		newId,
	});
	const [line] = await db
		.select({ id: s.transactions.id })
		.from(s.transactions)
		.where(eq(s.transactions.note, words));
	const marked = await markCardPayment(db, viewer, {
		transferId,
		transactionId: line?.id ?? "",
		cardAccountId: card,
		ruleId: `rule-${transferId}`,
	});
	expect(marked.ok).toBe(true);
}

const pay = (transactionId: string, amountCents: number, date: DayKey) =>
	addCommitmentPayment(db, {
		householdId,
		transactionId,
		commitmentId: "apple-bill",
		date,
		amountCents,
		createdByMemberId: parentId,
	});

const paidIn = async (month: "2026-08" | "2026-09" | "2026-10") =>
	Object.fromEntries(paidToCards(await loadGoals(db, viewer), month));

beforeEach(async () => {
	db = testDb();
	nextId = 0;
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: "Alex",
	});
	await account("checking", "checking");
	await account("chase", "credit-card", "statements");
	await account("apple", "credit-card", "hand");
	await addCommitment(db, {
		householdId,
		memberId: parentId,
		commitmentId: "apple-bill",
		name: "Apple Card bill",
		month: "2026-08",
		amountCents: 30_000,
		cadence: "monthly",
		dueDate: "2026-08-15",
	});
	await linkCommitment(db, {
		householdId,
		memberId: parentId,
		commitmentId: "apple-bill",
		accountId: "apple",
		carriedBalance: false,
		month: "2026-08",
		today: "2026-08-01",
	});
});

describe("what was paid to each card in a month", () => {
	it("adds the Transfers naming the card and the payments filed in a Commitment that pays it down", async () => {
		await sent("t1", "chase", "2026-09-10", 40_000, "CHASE CRD AUTOPAY SEPT");
		await sent("t2", "apple", "2026-09-12", 5_000, "APPLECARD GSBANK EXTRA");
		await pay("p1", 30_000, "2026-09-15");
		expect(await paidIn("2026-09")).toEqual({ chase: 40_000, apple: 35_000 });
	});

	it("keeps to the month: the last day of the one before and the first of the next are left out", async () => {
		await sent("t0", "chase", "2026-08-31", 10_000, "CHASE CRD AUTOPAY AUG");
		await sent("t1", "chase", "2026-09-01", 40_000, "CHASE CRD AUTOPAY FIRST");
		await sent("t2", "chase", "2026-09-30", 5_000, "CHASE CRD AUTOPAY LAST");
		await sent("t3", "chase", "2026-10-01", 7_000, "CHASE CRD AUTOPAY OCT");
		await pay("p0", 30_000, "2026-08-31");
		await pay("p1", 30_000, "2026-09-30");
		await pay("p2", 30_000, "2026-10-01");
		expect(await paidIn("2026-09")).toEqual({ chase: 45_000, apple: 30_000 });
		expect(await paidIn("2026-08")).toEqual({ chase: 10_000, apple: 30_000 });
		expect(await paidIn("2026-10")).toEqual({ chase: 7_000, apple: 30_000 });
	});

	it("leaves out a Transfer that was unmarked, and a card nothing was paid to", async () => {
		await sent("t1", "chase", "2026-09-10", 40_000, "CHASE CRD AUTOPAY ONE");
		await sent("t2", "chase", "2026-09-20", 5_000, "CHASE CRD AUTOPAY TWO");
		await unmarkTransfer(db, viewer, "t1");
		expect(await paidIn("2026-09")).toEqual({ chase: 5_000 });
	});
});
