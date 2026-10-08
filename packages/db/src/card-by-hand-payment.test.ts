import {
	type Cents,
	cardKept,
	cardPaymentIsSpending,
	cardsNowFollowed,
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
import { countingTwice, followedCards, linkCommitment, loadCharges } from "./commitments";
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
import { applyRule } from "./rules";
import { accounts, commitments, transactions } from "./schema";
import { testDb } from "./test-db";

// Issue 151: a card kept by hand has its purchases in Buckets (Quick Adds on the card). CONTEXT.md
// says paying it is a Transfer naming it. These tests put numbers on what each answer the app
// offers for the payment does to the month: $300 of Groceries on an Apple Card, then a $300
// payment to it from Checking. Take-home pay $5,000, Groceries allowance $600. Until issue 151 was
// fixed the app led with filing the payment in a Commitment, which counted the $300 twice (spent
// $600, Free to Spend $4,100). Now such a card is one Noodle follows: the payment is a Transfer.

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
async function household(purchases: PurchasesGetIn | null, buys = true) {
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
	for (const [id, date, amountCents] of buys
		? ([
				["buy-1", "2026-09-03", 18_000],
				["buy-2", "2026-09-10", 12_000],
			] as const)
		: []) {
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
async function billThatPaysItDown(carriedBalance = false) {
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
		carriedBalance,
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
	return {
		review: review?.kind ?? null,
		notFiledIn: review?.kind === "followed" ? (review.commitment ?? null) : null,
		followed: followed.has("apple"),
		plan,
	};
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

const madeCommitments = async () =>
	(await db.select({ id: commitments.id }).from(commitments)).map((row) => row.id);

/** How "It's a card payment" reads the card: whether its payment is filed in the Commitment. */
const chooserFilesInCommitment = async (purchases: PurchasesGetIn | null) =>
	cardPaymentIsSpending(
		cardKept({
			bankConnectionId: null,
			purchases,
			followed: (await followedCards(db, householdId, today)).includes("apple"),
		}),
		true,
	);

for (const purchases of ["hand", null] as const) {
	const said = purchases === "hand" ? "its purchases are added by hand" : "never asked";
	// Only a card answered "by hand" has its lines added to what it owes (ADR-0050); one never asked
	// stays at its typed balance.
	const owedBefore = purchases === "hand" ? 30_000 : 0;
	describe(`A $300 payment to a card kept by hand (${said}) with $300 of its purchases in Groceries`, () => {
		beforeEach(() => household(purchases));

		it("before the payment is answered: spent $300 once", async () => {
			expect(await totals()).toEqual({ ...RIGHT, owed: owedBefore });
		});

		it("marked a Transfer to the card, counts once and the card owes nothing", async () => {
			expect(await transfer()).toMatchObject({ ok: true });
			expect(await totals()).toEqual(RIGHT);
		});

		it("is read by Review as a card Noodle follows: “Payment to … · isn’t spending”, the Transfer first", async () => {
			expect(await reading()).toMatchObject({ review: "followed", followed: true });
		});

		it("“It's a card payment” marks a Transfer, never files it in a Commitment", async () => {
			expect(await chooserFilesInCommitment(purchases)).toBe(false);
		});

		it("can't be paid down by a Commitment, unless it is for a balance being carried", async () => {
			expect(await billThatPaysItDown()).toEqual({ ok: false, reason: "followed" });
			expect(await reading()).toMatchObject({ review: "followed" });
			expect(await billThatPaysItDown(true)).toEqual({ ok: true });
			expect(await reading()).toMatchObject({ review: "commitment" });
			expect(await countingTwice(db, householdId, today)).toEqual([]);
		});

		it("“Make it a Commitment” is refused whole: nothing is made, the $300 still counts once", async () => {
			expect(await makeCommitment()).toMatchObject({ ok: false });
			expect(await madeCommitments()).toEqual([]);
			expect(await totals()).toEqual({ ...RIGHT, owed: owedBefore });
		});

		it("a Commitment linked before the fix: Review no longer files in it, and Plan health names it", async () => {
			await billThatPaysItDown();
			// As it was linked while the app still allowed it.
			await db.update(commitments).set({ accountId: "apple" }).where(eq(commitments.id, "bill"));
			const read = await reading();
			expect(read).toMatchObject({ review: "followed", notFiledIn: "Apple Card bill" });
			expect(await countingTwice(db, householdId, today)).toEqual(["bill"]);
			expect(
				cardsNowFollowed(read.plan.commitments, [
					{ id: "apple", name: "Apple Card", connected: false, followed: read.followed },
				]),
			).toMatchObject([{ kind: "card-followed", commitmentId: "bill", account: "Apple Card" }]);
			// Marked a Transfer, the month's spending is right; the Commitment still takes its $300
			// from Free to Spend until a Parent ends it (Plan health's row).
			expect(await transfer()).toMatchObject({ ok: true });
			expect(await totals()).toEqual({ ...RIGHT, freeToSpend: 410_000 });
		});
	});

	describe(`A Rule stated before the fix files a card's payments in its Commitment; the card is now kept by hand (${said})`, () => {
		beforeEach(async () => {
			// As the app did it before: “Make it a Commitment” made the Commitment and the Rule.
			await household("none");
			expect(await makeCommitment()).toMatchObject({ ok: true, ruleId: "rule-1" });
			await db.update(accounts).set({ purchases }).where(eq(accounts.id, "apple"));
			await importStatement(db, {
				householdId,
				importId: "i-2",
				accountId: "checking",
				source: "csv",
				fileName: null,
				fileKey: null,
				lines: [line("2026-09-18", -4_500, WORDING)],
				closingBalance: null,
				csvMapping: null,
				createdByMemberId: parentId,
				newId,
			});
		});

		it("is no longer applied: the new payment stays out of the Commitment and waits in Review", async () => {
			expect(await countingTwice(db, householdId, today)).toEqual(["made"]);
			expect(await applyRule(db, viewer, "rule-1", { today })).toEqual({
				filed: 0,
				months: [],
				kept: 0,
			});
			const [later] = await db
				.select({ commitmentId: transactions.commitmentId })
				.from(transactions)
				.where(eq(transactions.amountCents, 4_500));
			expect(later?.commitmentId).toBeNull();
			expect(await reading()).toMatchObject({ review: "followed", notFiledIn: "Apple Card" });
		});

		it("leaves the payment already filed, the Commitment and the Rule as they were", async () => {
			await applyRule(db, viewer, "rule-1", { today });
			expect(await madeCommitments()).toEqual(["made"]);
			// Still counted twice until a Parent repairs it: this fix rewrites nothing already filed.
			expect(await totals()).toMatchObject({ commitmentPaid: 30_000, spent: 60_000 });
		});
	});
}

describe("A $300 payment to a card whose purchases never get into Noodle (“they won't”)", () => {
	// Right by design: nothing bought on the card is in a Bucket, so the payment is the spending.
	beforeEach(() => household("none", false));

	it("is read by Review as a card Noodle doesn't follow: “Make it a Commitment” first", async () => {
		expect(await reading()).toMatchObject({ review: "not-followed", followed: false });
	});

	it("“Make it a Commitment” counts the $300 once, as the payment", async () => {
		expect(await totals()).toMatchObject({ spent: 0, freeToSpend: 440_000 });
		expect(await makeCommitment()).toMatchObject({ ok: true });
		expect(await totals()).toMatchObject({
			groceries: 0,
			commitmentPaid: 30_000,
			spent: 30_000,
			freeToSpend: 410_000,
		});
	});

	it("can be paid down by a Commitment, whose payments Review and “It's a card payment” file there, and its Rule files later ones", async () => {
		expect(await billThatPaysItDown()).toEqual({ ok: true });
		expect(await reading()).toMatchObject({ review: "commitment" });
		expect(await chooserFilesInCommitment("none")).toBe(true);
		expect(await countingTwice(db, householdId, today)).toEqual([]);
		expect(await fileInBill()).toMatchObject({ ok: true });
		expect(await totals()).toMatchObject({ commitmentPaid: 30_000, spent: 30_000 });
	});

	it("stays so even with Quick Adds on it: a Parent said its purchases won't get in", async () => {
		await household("none");
		expect(await reading()).toMatchObject({ review: "not-followed", followed: false });
	});
});

describe("A card nobody was asked about, with nothing on it lately", () => {
	beforeEach(() => household(null, false));

	it("is not followed: its payment is the spending, as before", async () => {
		expect(await reading()).toMatchObject({ review: "not-followed", followed: false });
		expect(await billThatPaysItDown()).toEqual({ ok: true });
		expect(await reading()).toMatchObject({ review: "commitment" });
		expect(await chooserFilesInCommitment(null)).toBe(true);
	});

	it("is followed once a purchase is put on it by hand, and not by one older than 60 days", async () => {
		const add = (transactionId: string, date: DayKey) =>
			addQuickAdd(db, {
				householdId,
				transactionId,
				bucketId: "groceries",
				date,
				amountCents: 2_000,
				note: "Groceries on the card",
				forMemberIds: [],
				createdByMemberId: parentId,
				accountId: "apple",
			});
		await add("old", "2026-07-01");
		expect((await reading()).followed).toBe(false);
		await add("new", "2026-09-01");
		expect((await reading()).followed).toBe(true);
	});
});
