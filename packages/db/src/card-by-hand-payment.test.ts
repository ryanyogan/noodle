import {
	type Cents,
	cardKept,
	cardPaymentIsSpending,
	type DayKey,
	freeToSpend,
	type MonthKey,
	type PurchasesGetIn,
	paymentCase,
	planForMonth,
	type StatementLine,
} from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { followedCards, linkCommitment, loadCharges } from "./commitments";
import { owedNow } from "./goals";
import {
	addAccount,
	addBucket,
	addCommitment,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	fileCardPayment,
	importStatement,
	loadSpending,
	markCardPayment,
} from "./index";
import { loadPlanRecords, setTakeHomePay } from "./plan";
import { commitments, transactions } from "./schema";
import { testDb } from "./test-db";

// Issue 151: a card kept by hand has its purchases in Buckets (Quick Adds on the card). CONTEXT.md
// says paying it is a Transfer naming it. These tests put numbers on what each answer the app
// offers for the payment does to the month: $300 of Groceries on an Apple Card, then a $300
// payment to it from Checking. Take-home pay $5,000, Groceries allowance $600.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const month: MonthKey = "2026-09";
const today: DayKey = "2026-09-20";
const WORDING = "APPLECARD GSBANK PAYMENT 8841";

let db: Db;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;

const line = (date: DayKey, amount: number, description: string): StatementLine => ({
	date,
	amount,
	description,
	bankId: null,
});

/** The Household, its Plan, the card with `purchases` answered (null: never asked), and the month's lines. */
async function household(purchases: PurchasesGetIn | null) {
	db = testDb();
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
		accountId: "checking",
		name: "Checking",
		kind: "checking",
		balanceCents: 0,
		balanceId: "checking-balance",
		createdByMemberId: parentId,
	});
	await addAccount(db, {
		householdId,
		accountId: "apple",
		name: "Apple Card",
		kind: "credit-card",
		balanceCents: 0,
		balanceId: "apple-balance",
		createdByMemberId: parentId,
		asOf: "2026-08-31",
		purchases,
	});
	await setTakeHomePay(db, { householdId, memberId: parentId, month, amountCents: 500_000 });
	await addBucket(db, {
		householdId,
		memberId: parentId,
		bucketId: "groceries",
		name: "Groceries",
		color: 1,
		month,
		allowanceCents: 60_000,
	});
	for (const [id, date, amountCents] of [
		["buy-1", "2026-09-03", 18_000],
		["buy-2", "2026-09-10", 12_000],
	] as const) {
		const added = await addQuickAdd(db, {
			householdId,
			transactionId: id,
			bucketId: "groceries",
			date,
			amountCents,
			note: "Groceries on the card",
			forMemberIds: [],
			createdByMemberId: parentId,
			accountId: "apple",
		});
		expect(added).toMatchObject({ ok: true });
	}
	await importStatement(db, {
		householdId,
		importId: "i-1",
		accountId: "checking",
		source: "csv",
		fileName: null,
		fileKey: null,
		lines: [line("2026-09-15", -30_000, WORDING)],
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: parentId,
		newId,
	});
}

const paymentId = async () =>
	(
		await db
			.select({ id: transactions.id })
			.from(transactions)
			.where(eq(transactions.amountCents, 30_000))
	)
		.map((row) => row.id)
		.find((id) => !id.startsWith("buy")) as string;

/** A Commitment "Apple Card bill" of $300 a month that pays the card down, as Plan → Commitments adds it. */
async function billThatPaysItDown() {
	await addCommitment(db, {
		householdId,
		memberId: parentId,
		commitmentId: "bill",
		name: "Apple Card bill",
		month,
		amountCents: 30_000,
		cadence: "monthly",
		dueDate: "2026-09-15",
	});
	return linkCommitment(db, {
		householdId,
		memberId: parentId,
		commitmentId: "bill",
		accountId: "apple",
		carriedBalance: false,
		month,
		today,
	} as Parameters<typeof linkCommitment>[1]);
}

/** How Review reads the payment (paymentCase), and what "It's a card payment" does with the card. */
async function reading() {
	const followed = new Set(await followedCards(db, householdId, today));
	const plan = planForMonth(await loadPlanRecords(db, householdId, month), month);
	const linked = await db.select().from(commitments);
	const review = paymentCase(
		{ text: WORDING, amountCents: 30_000, from: "Checking" },
		[{ id: "apple", name: "Apple Card", kind: "credit-card", followed: followed.has("apple") }],
		linked.flatMap((c) =>
			c.accountId
				? [
						{
							id: c.id,
							name: c.name,
							accountId: c.accountId,
							amountCents: 30_000,
							carriedBalance: c.carriedBalance ?? false,
						},
					]
				: [],
		),
	);
	return { review: review?.kind ?? null, followed: followed.has("apple"), plan };
}

/** The month as the app totals it. */
async function totals() {
	const plan = planForMonth(await loadPlanRecords(db, householdId, month), month);
	const sum = (rows: { amount: Cents }[]) => rows.reduce((total, row) => total + row.amount, 0);
	const groceries = sum(await loadSpending(db, viewer, month));
	const paid = sum(await loadCharges(db, viewer, month));
	return {
		groceries,
		commitmentPaid: paid,
		spent: groceries + paid,
		freeToSpend: freeToSpend(plan),
		owed: await owedNow(db, { householdId, accountId: "apple" }),
	};
}

/** What the Household really spent, and what the Plan should leave: $300 once. */
const RIGHT = {
	groceries: 30_000,
	commitmentPaid: 0,
	spent: 30_000,
	freeToSpend: 440_000,
	owed: 0,
};

const transfer = async () =>
	markCardPayment(db, viewer, {
		transferId: "transfer-1",
		transactionId: await paymentId(),
		cardAccountId: "apple",
		ruleId: "rule-1",
		today,
	});

const makeCommitment = async () =>
	fileCardPayment(db, viewer, {
		transactionId: await paymentId(),
		commitmentId: "made",
		ruleId: "rule-1",
		today,
		create: {
			name: "Apple Card",
			month,
			amountCents: 30_000,
			dueDate: "2026-09-15",
			paysDown: "apple",
		},
	});

const fileInBill = async () =>
	fileCardPayment(db, viewer, {
		transactionId: await paymentId(),
		commitmentId: "bill",
		ruleId: "rule-1",
		today,
	});

for (const purchases of ["hand", null] as const) {
	const said = purchases === "hand" ? "its purchases are added by hand" : "never asked";
	// Only a card answered "by hand" has its lines added to what it owes (ADR-0050); one never asked
	// stays at its typed balance, so a payment filed in a Commitment takes it below $0.
	const owedBefore = purchases === "hand" ? 30_000 : 0;
	const owedAfterCommitment = owedBefore - 30_000;
	describe(`A $300 payment to a card kept by hand (${said}) with $300 of its purchases in Groceries`, () => {
		beforeEach(() => household(purchases));

		it("before the payment is answered: spent $300 once", async () => {
			expect(await totals()).toEqual({ ...RIGHT, owed: owedBefore });
		});

		it("marked a Transfer to the card, counts once and the card owes nothing", async () => {
			expect(await transfer()).toMatchObject({ ok: true });
			expect(await totals()).toEqual(RIGHT);
		});

		it("is read by Review as a card Noodle can't see into: its main button is “Make it a Commitment”", async () => {
			expect(await reading()).toMatchObject({ review: "not-followed", followed: false });
		});

		it("is read by Review as its Commitment's payment once one pays the card down, and the link is allowed", async () => {
			expect(await billThatPaysItDown()).toEqual({ ok: true });
			expect(await reading()).toMatchObject({ review: "commitment" });
			expect(cardPaymentIsSpending(cardKept({ bankConnectionId: null, purchases }), true)).toBe(
				true,
			);
		});

		// The fault (issue 151): each of these is what the app leads with, and each counts the $300 twice.
		it.fails("“Make it a Commitment” counts the $300 once", async () => {
			expect(await makeCommitment()).toMatchObject({ ok: true });
			expect(await totals()).toEqual(RIGHT);
		});

		it.fails("Confirm, with a Commitment that pays the card down, counts the $300 once", async () => {
			await billThatPaysItDown();
			expect(await fileInBill()).toMatchObject({ ok: true });
			expect(await totals()).toEqual(RIGHT);
		});

		it("“Make it a Commitment” today: spent $600 for $300 of shopping, Free to Spend $300 low", async () => {
			expect(await makeCommitment()).toMatchObject({ ok: true });
			expect(await totals()).toEqual({
				groceries: 30_000,
				commitmentPaid: 30_000,
				spent: 60_000,
				freeToSpend: 410_000,
				owed: owedAfterCommitment,
			});
		});

		it("Confirm into the Commitment today: spent $600 for $300 of shopping, Free to Spend $300 low", async () => {
			await billThatPaysItDown();
			expect((await totals()).freeToSpend).toBe(410_000);
			expect(await fileInBill()).toMatchObject({ ok: true });
			expect(await totals()).toEqual({
				groceries: 30_000,
				commitmentPaid: 30_000,
				spent: 60_000,
				freeToSpend: 410_000,
				owed: owedAfterCommitment,
			});
		});
	});
}
