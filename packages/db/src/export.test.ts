import type { DayKey } from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addIncome,
	addPersonalAllowance,
	addQuickAdd,
	changeMoneyInKind,
	confirmPaidBack,
	createHouseholdForParent,
	type Db,
	loadExportData,
	loadSpending,
	monthsBetween,
	sayOwedBack,
	setTakeHomePay,
	type Viewer,
} from "./index";
import {
	accounts,
	cardPaymentRules,
	income,
	members,
	moneyInPairs,
	moneyInRules,
	transactions,
} from "./schema";
import { testDb } from "./test-db";

// What a Parent's "Download your data" reads (ADR-0028): everything they see in the app, and the
// other Parent's Personal Allowance only as its total each month (ADR-0003).

const householdId = "household";
const month = "2026-09";
const alex: Viewer = { householdId, memberId: "alex" };
const sam: Viewer = { householdId, memberId: "sam" };
let db: Db;

const quickAdd = (
	by: Viewer,
	transactionId: string,
	bucketId: string,
	amountCents: number,
	note: string,
) =>
	addQuickAdd(db, {
		householdId,
		transactionId,
		bucketId,
		date: "2026-09-10" as DayKey,
		amountCents,
		note,
		forMemberIds: [],
		createdByMemberId: by.memberId,
	});

beforeEach(async () => {
	db = testDb();
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
	await setTakeHomePay(db, { householdId, memberId: "alex", month, amountCents: 900_000 });
	await addBucket(db, {
		householdId,
		memberId: "alex",
		bucketId: "groceries",
		name: "Groceries",
		color: 1,
		month,
		allowanceCents: 120_000,
	});
	for (const parent of [alex, sam]) {
		await addPersonalAllowance(db, {
			householdId,
			memberId: parent.memberId,
			bucketId: `${parent.memberId}-pa`,
			name: `${parent.memberId}’s Personal Allowance`,
			color: 2,
			month,
			allowanceCents: 20_000,
		});
	}
	await quickAdd(alex, "gift", "alex-pa", 4_200, "Birthday gift for Sam");
	await quickAdd(alex, "book", "alex-pa", 1_800, "Book");
	await quickAdd(alex, "milk", "groceries", 650, "Milk");
	await quickAdd(sam, "coffee", "sam-pa", 500, "Coffee");
});

const load = (viewer: Viewer) => loadExportData(db, viewer, "2026-09-30" as DayKey, 0);

describe("loadExportData", () => {
	it("leaves out the other Parent's Personal Allowance, keeping only its total", async () => {
		const forSam = await load(sam);
		expect(forSam.transactions.map((t) => t.id).sort()).toEqual(["coffee", "milk"]);
		expect(JSON.stringify(forSam)).not.toContain("Birthday gift");
		expect(forSam.privateTotals).toEqual([{ bucketId: "alex-pa", month, amountCents: 6_000 }]);

		const forAlex = await load(alex);
		expect(forAlex.transactions.map((t) => t.id).sort()).toEqual(["book", "gift", "milk"]);
		expect(JSON.stringify(forAlex)).not.toContain("Coffee");
		expect(forAlex.privateTotals).toEqual([{ bucketId: "sam-pa", month, amountCents: 500 }]);
	});

	it("re-totals to what the month shows for each Bucket", async () => {
		for (const viewer of [alex, sam]) {
			const data = await load(viewer);
			const totals = new Map<string, number>();
			for (const t of data.transactions)
				totals.set(t.bucketId ?? "", (totals.get(t.bucketId ?? "") ?? 0) + t.amountCents);
			for (const p of data.privateTotals)
				totals.set(p.bucketId, (totals.get(p.bucketId) ?? 0) + p.amountCents);
			const shown = new Map<string, number>();
			for (const s of await loadSpending(db, viewer, month))
				shown.set(s.bucketId ?? "", (shown.get(s.bucketId ?? "") ?? 0) + s.amount);
			expect(totals).toEqual(shown);
		}
	});

	it("takes what was Paid back into the other Parent's Personal Allowance off its total", async () => {
		await sayOwedBack(db, alex, {
			owedBackId: "ob-gift",
			transactionId: "gift",
			who: "Casey",
			amountCents: 1_000 as never,
		});
		await addIncome(db, {
			householdId,
			incomeId: "casey",
			date: "2026-09-20" as DayKey,
			amountCents: 1_000,
			note: "Casey",
			createdByMemberId: "alex",
		});
		await changeMoneyInKind(db, alex, { incomeId: "casey", kind: "paid-back", transferId: "t1" });
		const confirmed = await confirmPaidBack(db, alex, {
			incomeId: "casey",
			matches: [{ id: "m1", owedBackId: "ob-gift", amount: 1_000 as never }],
			today: "2026-09-28" as DayKey,
		});
		expect(confirmed.ok).toBe(true);
		const forSam = await load(sam);
		expect(forSam.privateTotals).toEqual([{ bucketId: "alex-pa", month, amountCents: 5_000 }]);
		expect(forSam.paidBackMatches).toEqual([]);
		const shown = (await loadSpending(db, sam, month))
			.filter((spend) => spend.bucketId === "alex-pa")
			.reduce((sum, spend) => sum + spend.amount, 0);
		expect(shown).toBe(5_000);
	});

	it("carries the Rules for money in, remembered pairs of Accounts and card payments", async () => {
		await db.insert(accounts).values([
			{ id: "checking", householdId, name: "Checking", kind: "checking" },
			{ id: "savings", householdId, name: "Savings", kind: "savings" },
			{ id: "visa", householdId, name: "Visa", kind: "credit-card" },
		] as (typeof accounts.$inferInsert)[]);
		const at = (n: number) => new Date(Date.UTC(2026, 8, n));
		await db.insert(moneyInRules).values([
			{
				id: "pay",
				householdId,
				pattern: "acme payroll",
				kind: "income",
				payMemberId: "sam",
				createdByMemberId: "alex",
				createdAt: at(1),
			},
			// A pair kept before pairs had their own table.
			{
				id: "old",
				householdId,
				pattern: "old transfer",
				kind: "transfer",
				intoAccountId: "checking",
				otherAccountId: "savings",
				createdByMemberId: "sam",
				createdAt: at(2),
			},
			// One said again since: the pair in its own table speaks for it.
			{
				id: "shadowed",
				householdId,
				pattern: "new transfer",
				kind: "transfer",
				intoAccountId: "checking",
				otherAccountId: "visa",
				createdAt: at(3),
			},
		]);
		await db.insert(moneyInPairs).values({
			id: "new",
			householdId,
			pattern: "new transfer",
			intoAccountId: "checking",
			otherAccountId: "savings",
			createdByMemberId: "alex",
			createdAt: at(4),
		});
		await db.insert(cardPaymentRules).values([
			{
				id: "card",
				householdId,
				pattern: "visa payment",
				accountId: "visa",
				createdByMemberId: "sam",
				createdAt: at(5),
			},
			{ id: "card-2", householdId, pattern: "store card", accountId: null, createdAt: at(6) },
		]);
		// Rules for money in are the Household's: both Parents get the same.
		for (const viewer of [alex, sam]) {
			const data = await load(viewer);
			expect(data.moneyInRules).toEqual([
				{
					pattern: "acme payroll",
					kind: "income",
					intoAccount: null,
					otherAccount: null,
					payMemberId: "sam",
					createdBy: "Alex",
					createdAt: at(1).getTime(),
				},
				{
					pattern: "new transfer",
					kind: "transfer",
					intoAccount: "Checking",
					otherAccount: "Savings",
					payMemberId: null,
					createdBy: "Alex",
					createdAt: at(4).getTime(),
				},
				{
					pattern: "old transfer",
					kind: "transfer",
					intoAccount: "Checking",
					otherAccount: "Savings",
					payMemberId: null,
					createdBy: "Sam",
					createdAt: at(2).getTime(),
				},
			]);
			expect(data.cardPaymentRules).toEqual([
				{ pattern: "store card", card: null, createdBy: null, createdAt: at(6).getTime() },
				{ pattern: "visa payment", card: "Visa", createdBy: "Sam", createdAt: at(5).getTime() },
			]);
		}
	});

	it("carries money in, and what the bank took back or lowered after a month ended", async () => {
		await db.insert(accounts).values({
			id: "checking",
			householdId,
			name: "Checking",
			kind: "checking",
		} as typeof accounts.$inferInsert);
		await addIncome(db, {
			householdId,
			incomeId: "pay",
			date: "2026-09-15" as DayKey,
			amountCents: 250_000,
			note: "ACME PAYROLL",
			createdByMemberId: "alex",
		});
		await addIncome(db, {
			householdId,
			incomeId: "back",
			date: "2026-09-02" as DayKey,
			amountCents: 4_000,
			note: "STORE REFUND",
			createdByMemberId: "alex",
		});
		await db
			.update(income)
			.set({ accountId: "checking", bankTookBackOn: "2026-10-03", bankAmountCents: 1_500 })
			.where(eq(income.id, "back"));
		await db
			.update(income)
			.set({ payMemberId: "sam", payDay: "2026-09-16" })
			.where(eq(income.id, "pay"));
		await db
			.update(transactions)
			.set({ bankTookBackOn: "2026-10-04", bankAmountCents: null })
			.where(eq(transactions.id, "milk"));
		const data = await load(sam);
		expect(
			data.moneyIn.map((line) => ({ ...line, kind: undefined, needsReview: undefined })),
		).toEqual([
			{
				id: "back",
				date: "2026-09-02",
				note: "STORE REFUND",
				amountCents: 4_000,
				account: "Checking",
				otherAccount: null,
				payMemberId: null,
				payDay: null,
				bankTookBackOn: "2026-10-03",
				bankAmountCents: 1_500,
			},
			{
				id: "pay",
				date: "2026-09-15",
				note: "ACME PAYROLL",
				amountCents: 250_000,
				account: null,
				otherAccount: null,
				payMemberId: "sam",
				// The Pay day it counts on, kept beside the day it landed.
				payDay: "2026-09-16",
				bankTookBackOn: null,
				bankAmountCents: null,
			},
		]);
		expect(data.moneyIn.map((line) => line.kind)).toEqual(["income", "income"]);
		expect(data.transactions.find((t) => t.id === "milk")).toMatchObject({
			bankTookBackOn: "2026-10-04",
			bankAmount: null,
		});
	});

	it("carries the Plan for each month and the Household's names", async () => {
		const data = await load(alex);
		expect(data.plans.map((p) => p.month)).toEqual(["2026-09"]);
		expect(data.plans[0]?.baseline).toBe(900_000);
		expect(data.plans[0]?.buckets.map((b) => b.name)).toContain("Groceries");
		expect(data.bucketNames.groceries).toBe("Groceries");
		expect(data.household.name).toBe("The Rinks");
	});

	it("counts months across a year", () => {
		expect(monthsBetween("2025-11", "2026-02")).toEqual([
			"2025-11",
			"2025-12",
			"2026-01",
			"2026-02",
		]);
	});
});
