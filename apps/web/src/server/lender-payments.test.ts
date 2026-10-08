import {
	addAccount,
	addBucket,
	applyRule,
	createHouseholdForParent,
	type Db,
	importStatement,
	loadLoansPaidDown,
	loadSpending,
	markTransfer,
	owedNow,
	saveRule,
	setTakeHomePay,
} from "@noodle/db";
import { categorizations, transactions, transfers } from "@noodle/db/schema";
import { testDb } from "@noodle/db/test-db";
import { type DayKey, merchantKey, type StatementLine } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { type Classifier, memoryMerchants } from "./categorize-model";
import { type CategorizeDeps, categorizeImport } from "./categorize-run";

// A payment to a lender the Household has a loan with (issue 153, phase c), as it arrives: held
// for Review's suggestion, filed by a Rule into the loan whose payment it is, and counted once.

const householdId = "household";
const month = "2026-09";
const today = "2026-09-20" as DayKey;
const alex = { householdId, memberId: "alex" };
const LENDER_LINE = "ZIPLINE.COM PAYMENTS";

let db: Db;
let ids = 0;
const newId = () => `id-${String(++ids).padStart(4, "0")}`;
let merchants: ReturnType<typeof memoryMerchants>;

/** A model that is sure every line belongs in Shopping. */
const sureOfShopping: Classifier = {
	async classify(_buckets, asked) {
		return asked.map((merchant) => ({ key: merchant.key, bucketId: "shopping", confidence: 0.99 }));
	},
};
const deps = (): CategorizeDeps => ({ db, classifier: sureOfShopping, merchants });

const line = (description: string, dollars: number, date = "2026-09-10"): StatementLine => ({
	date: date as DayKey,
	amount: -Math.round(dollars * 100),
	description,
	bankId: null,
});

async function importLines(accountId: string, lines: StatementLine[]) {
	const importId = newId();
	const result = await importStatement(db, {
		householdId,
		importId,
		accountId,
		source: "csv",
		fileName: "statement.csv",
		fileKey: null,
		lines,
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: "alex",
		newId,
	});
	expect(result.ok).toBe(true);
	return importId;
}

const arrive = async (accountId: string, lines: StatementLine[]) =>
	categorizeImport(deps(), alex, await importLines(accountId, lines));

/** Where each line landed, by its amount in cents. */
async function landed() {
	const [rows, decided] = await Promise.all([
		db.select().from(transactions),
		db.select().from(categorizations),
	]);
	return Object.fromEntries(
		rows.map((row) => [
			row.amountCents,
			{
				bucketId: row.bucketId,
				commitmentId: row.commitmentId,
				outcome: decided.find((c) => c.transactionId === row.id)?.outcome ?? null,
				guess: decided.find((c) => c.transactionId === row.id)?.bucketId ?? null,
			},
		]),
	);
}

const loan = (accountId: string, name: string, borrowed: number, payment: number) =>
	addAccount(db, {
		householdId,
		accountId,
		name,
		kind: "loan",
		balanceCents: borrowed,
		balanceId: `balance-${accountId}`,
		createdByMemberId: "alex",
		asOf: "2026-09-01" as DayKey,
		loan: { borrowed, payment, dueDay: 10, endsOn: null },
		commitment: {
			commitmentId: `${accountId}-payment`,
			amountCents: payment,
			dueDate: "2026-09-10" as DayKey,
			month,
			today,
		},
	});

const lenderRule = () =>
	saveRule(db, {
		id: "rule-zipline",
		householdId,
		memberId: "alex",
		pattern: merchantKey(LENDER_LINE),
		bucketId: null,
		commitmentId: "sofa-payment",
	});

beforeEach(async () => {
	db = testDb();
	ids = 0;
	merchants = memoryMerchants();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await setTakeHomePay(db, { householdId, memberId: "alex", month, amountCents: 900_000 });
	await addBucket(db, {
		householdId,
		memberId: "alex",
		bucketId: "shopping",
		name: "Shopping",
		color: 1,
		month,
		allowanceCents: 50_000,
	});
	for (const [accountId, name, kind] of [
		["checking", "Checking", "checking"],
		["card", "Harbor Visa", "credit-card"],
	] as const) {
		await addAccount(db, {
			householdId,
			accountId,
			name,
			kind,
			balanceCents: 0,
			balanceId: `balance-${accountId}`,
			createdByMemberId: "alex",
			...(kind === "credit-card" ? { purchases: "statements" as const } : {}),
		});
	}
	await loan("sofa", "Zipline sofa", 54_000, 4_500);
	await loan("bike", "Zipline bike", 144_000, 12_000);
});

describe("a payment to a lender the Household has a loan with, as it arrives", () => {
	it("reads the Household's loans with the Commitments that pay them down", async () => {
		expect(await loadLoansPaidDown(db, householdId)).toMatchObject([
			{
				accountId: "bike",
				name: "Zipline bike",
				commitmentId: "bike-payment",
				paymentCents: 12_000,
			},
			{
				accountId: "sofa",
				name: "Zipline sofa",
				commitmentId: "sofa-payment",
				paymentCents: 4_500,
			},
		]);
	});

	it("waits in Review with no Bucket, however sure the model is", async () => {
		const result = await arrive("card", [line(LENDER_LINE, 45), line("HARBORVIEW OUTFITTERS", 30)]);
		expect(result).toMatchObject({ filed: 1, review: 1 });
		expect(await landed()).toMatchObject({
			4500: { bucketId: null, commitmentId: null, outcome: "review", guess: null },
			3000: { bucketId: "shopping", outcome: "filed" },
		});
	});

	it("is filed by the lender's Rule in the loan whose payment it is, and asks about any other", async () => {
		await lenderRule();
		await arrive("card", [
			line(LENDER_LINE, 45),
			line(LENDER_LINE, 120, "2026-09-11"),
			line(LENDER_LINE, 60, "2026-09-12"),
		]);
		expect(await landed()).toMatchObject({
			4500: { commitmentId: "sofa-payment", bucketId: null, outcome: "filed" },
			12000: { commitmentId: "bike-payment", bucketId: null, outcome: "filed" },
			6000: { commitmentId: null, bucketId: null, outcome: "review", guess: null },
		});
	});

	it("is filed the same way when the Rule is applied to what waits", async () => {
		await arrive("card", [line(LENDER_LINE, 120), line(LENDER_LINE, 60, "2026-09-12")]);
		await lenderRule();
		expect(await applyRule(db, alex, "rule-zipline", { today })).toMatchObject({ filed: 1 });
		expect(await landed()).toMatchObject({
			12000: { commitmentId: "bike-payment", bucketId: null },
			6000: { commitmentId: null, bucketId: null },
		});
	});

	it("counts once: a Commitment's payment and no Bucket's, with the card's own payment a Transfer", async () => {
		await lenderRule();
		// The loan's payment is a purchase on the card; the card is then paid from checking.
		await arrive("card", [line(LENDER_LINE, 45)]);
		await arrive("checking", [line("HARBOR VISA CARD ONLINE PAYMENT", 45, "2026-09-15")]);
		const rows = await db.select().from(transactions);
		const cardPayment = rows.find((row) => row.accountId === "checking");
		expect(cardPayment).toMatchObject({ bucketId: null, commitmentId: null });
		expect(
			await markTransfer(db, alex, {
				transferId: "transfer-card",
				transactionId: cardPayment?.id as string,
				cardPayment: { accountId: "card" },
				today,
			}),
		).toMatchObject({ ok: true });

		// Nothing in a Bucket, the one payment in the sofa's Commitment, and the Transfer nowhere.
		expect(await loadSpending(db, alex, month)).toEqual([]);
		const after = await db.select().from(transactions);
		expect(
			after
				.filter((row) => row.commitmentId !== null)
				.map((row) => [row.commitmentId, row.amountCents]),
		).toEqual([["sofa-payment", 4_500]]);
		expect(after.filter((row) => row.bucketId !== null)).toEqual([]);
		expect(await db.select().from(transfers)).toHaveLength(1);
		// What's owed on the loan it paid goes down by the payment, once; the other loan's doesn't.
		expect(await owedNow(db, { householdId, accountId: "sofa" })).toBe(54_000 - 4_500);
		expect(await owedNow(db, { householdId, accountId: "bike" })).toBe(144_000);
	});
});
