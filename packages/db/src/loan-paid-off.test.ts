import { type DayKey, freeToSpend, type MonthKey, planForMonth } from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	createHouseholdForParent,
	type Db,
	endCommitment,
	loadGoals,
	loadPlanRecords,
	setLoanFacts,
	setTakeHomePay,
	updateAccountBalance,
} from "./index";
import * as s from "./schema";
import { testDb } from "./test-db";

// A loan paid off ends the Commitment that pays it down from the next month, worked out as the
// Plan's records are read (issue 153, phase d): nothing is written, so it comes back when the
// payment is deleted or what's owed is set above $0. And a loan's payment and due day change its
// Commitment's terms with them.

const householdId = "household";
const parentId = "parent";
const month: MonthKey = "2026-10";
const today: DayKey = "2026-10-08";

let db: Db;

/** A $100 loan paid $50 on the 15th, with its Commitment in the Plan from September. */
const addLoan = (accountId = "sofa-plan", owed = 10_000) =>
	addAccount(db, {
		householdId,
		accountId,
		name: accountId,
		kind: "loan",
		balanceCents: owed,
		balanceId: `${accountId}-balance`,
		createdByMemberId: parentId,
		asOf: "2026-09-01",
		loan: { borrowed: 20_000, payment: 5_000, dueDay: 15, endsOn: null },
		commitment: {
			commitmentId: `${accountId}-payment`,
			amountCents: 5_000,
			dueDate: "2026-09-15",
			month: "2026-09",
			today: "2026-09-01",
		},
	});

const pay = (id: string, date: DayKey, amountCents = 5_000, commitmentId = "sofa-plan-payment") =>
	db.insert(s.transactions).values({
		id,
		householdId,
		source: "import",
		date,
		amountCents,
		commitmentId,
	});

const records = (upTo: MonthKey = "2027-01") => loadPlanRecords(db, householdId, upTo);
const commitment = async (id = "sofa-plan-payment") =>
	(await records()).commitments.find((c) => c.id === id);
const planned = async (in_: MonthKey) =>
	planForMonth(await records(), in_).commitments.map((c) => c.id);
const stored = async (id = "sofa-plan-payment") =>
	(await db.select().from(s.commitments).where(eq(s.commitments.id, id)))[0]?.endedFromMonth;

beforeEach(async () => {
	db = await testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk",
		householdId,
		householdName: householdId,
		timeZone: "America/Chicago",
		parentId,
		parentName: parentId,
	});
});

describe("a loan paid off", () => {
	it("leaves its Commitment in the Plan while anything is owed", async () => {
		await addLoan();
		await pay("september", "2026-09-15");
		expect(await commitment()).toMatchObject({ endedFromMonth: null });
		expect((await commitment())?.paidOffOn).toBeUndefined();
		expect(await planned("2026-11")).toEqual(["sofa-plan-payment"]);
	});

	it("ends its Commitment from the month after the last payment, with nothing written", async () => {
		await addLoan();
		await pay("september", "2026-09-15");
		await pay("october", "2026-10-06");
		expect(await commitment()).toMatchObject({
			endedFromMonth: "2026-11",
			paidOffOn: "2026-10-06",
		});
		// The month it was paid off in still plans it, once; no later month does.
		expect(await planned("2026-09")).toEqual(["sofa-plan-payment"]);
		expect(await planned("2026-10")).toEqual(["sofa-plan-payment"]);
		expect(planForMonth(await records(), "2026-10").commitments[0]?.paidOffOn).toBe("2026-10-06");
		expect(await planned("2026-11")).toEqual([]);
		expect(await planned("2027-01")).toEqual([]);
		expect(await stored()).toBeNull();
		expect(
			await db.select().from(s.planChanges).where(eq(s.planChanges.kind, "commitment-end")),
		).toEqual([]);
	});

	it("stops counting in Free to Spend from the next month", async () => {
		await addLoan();
		await setTakeHomePay(db, {
			householdId,
			memberId: parentId,
			month: "2026-09",
			amountCents: 100_000,
		});
		await pay("september", "2026-09-15");
		const before = await records();
		expect(freeToSpend(planForMonth(before, "2026-11"))).toBe(95_000);
		await pay("october", "2026-10-06");
		const after = await records();
		expect(freeToSpend(planForMonth(after, "2026-10"))).toBe(95_000);
		expect(freeToSpend(planForMonth(after, "2026-11"))).toBe(100_000);
	});

	it("plans the Commitment again when the payment that paid it off is deleted or moved", async () => {
		await addLoan();
		await pay("september", "2026-09-15");
		await pay("october", "2026-10-06");
		expect(await planned("2026-11")).toEqual([]);
		// Moved to next month: it is paid off then, and planned through that month.
		await db
			.update(s.transactions)
			.set({ date: "2026-11-03" })
			.where(eq(s.transactions.id, "october"));
		expect(await commitment()).toMatchObject({
			endedFromMonth: "2026-12",
			paidOffOn: "2026-11-03",
		});
		expect(await planned("2026-11")).toEqual(["sofa-plan-payment"]);
		await db.delete(s.transactions).where(eq(s.transactions.id, "october"));
		expect(await commitment()).toMatchObject({ endedFromMonth: null });
		expect(await planned("2027-01")).toEqual(["sofa-plan-payment"]);
	});

	it("plans the Commitment again when what's owed is corrected above $0", async () => {
		await addLoan();
		await pay("october", "2026-10-06", 10_000);
		expect(await planned("2026-11")).toEqual([]);
		await updateAccountBalance(db, {
			householdId,
			balanceId: "corrected",
			accountId: "sofa-plan",
			amountCents: 2_500,
			createdByMemberId: parentId,
			asOf: "2026-10-07",
		});
		expect(await commitment()).toMatchObject({ endedFromMonth: null });
		expect(await planned("2026-11")).toEqual(["sofa-plan-payment"]);
	});

	it("is paid off on the balance's day when a Parent sets what's owed to $0", async () => {
		await addLoan();
		await updateAccountBalance(db, {
			householdId,
			balanceId: "zero",
			accountId: "sofa-plan",
			amountCents: 0,
			createdByMemberId: parentId,
			asOf: "2026-10-07",
		});
		expect(await commitment()).toMatchObject({
			endedFromMonth: "2026-11",
			paidOffOn: "2026-10-07",
		});
	});

	it("takes a payment that is one part of a Split", async () => {
		await addLoan();
		await pay("whole", "2026-09-15");
		await db.insert(s.transactions).values({
			id: "mixed",
			householdId,
			source: "import",
			date: "2026-10-06",
			amountCents: 8_000,
		});
		await db.insert(s.splits).values({
			id: "mixed-loan",
			position: 0,
			householdId,
			transactionId: "mixed",
			amountCents: 5_000,
			commitmentId: "sofa-plan-payment",
		});
		expect(await commitment()).toMatchObject({
			endedFromMonth: "2026-11",
			paidOffOn: "2026-10-06",
		});
		// The same agrees with what's owed, which reads $0.
		const goals = await loadGoals(db, { householdId, memberId: parentId });
		expect(goals.accounts.find((a) => a.id === "sofa-plan")?.owed).toBe(0);
	});

	it("keeps a Parent's own earlier end, and never moves the end they stored", async () => {
		await addLoan();
		await endCommitment(db, {
			householdId,
			memberId: parentId,
			commitmentId: "sofa-plan-payment",
			month: "2026-10",
		});
		await pay("september", "2026-09-15", 10_000);
		expect(await commitment()).toMatchObject({
			endedFromMonth: "2026-10",
			paidOffOn: "2026-09-15",
		});
		expect(await stored()).toBe("2026-10");
	});

	it("reads a Parent's later end as the pay-off's, and gives it back when the payment goes", async () => {
		await addLoan();
		await endCommitment(db, {
			householdId,
			memberId: parentId,
			commitmentId: "sofa-plan-payment",
			month: "2027-03",
		});
		await pay("october", "2026-10-06", 10_000);
		expect(await commitment()).toMatchObject({ endedFromMonth: "2026-11" });
		await db.delete(s.transactions).where(eq(s.transactions.id, "october"));
		expect(await commitment()).toMatchObject({ endedFromMonth: "2027-03" });
	});

	it("leaves another loan's Commitment, and a credit card's, alone", async () => {
		await addLoan();
		await addLoan("bike-plan");
		await addAccount(db, {
			householdId,
			accountId: "store-card",
			name: "store-card",
			kind: "credit-card",
			purchases: "none",
			balanceCents: 0,
			balanceId: "store-card-balance",
			createdByMemberId: parentId,
			asOf: "2026-09-01",
			commitment: {
				commitmentId: "store-card-payment",
				amountCents: 2_000,
				dueDate: "2026-09-20",
				month: "2026-09",
				today: "2026-09-01",
			},
		});
		await pay("october", "2026-10-06", 10_000);
		expect((await planned("2026-11")).sort()).toEqual(["bike-plan-payment", "store-card-payment"]);
	});
});

describe("a loan's payment and due day", () => {
	const facts = { borrowed: 20_000, payment: 6_500, dueDay: 22, endsOn: null };
	const plan = { memberId: parentId, month, today };
	const termsOf = async (in_: MonthKey) =>
		planForMonth(await records(), in_).commitments.find((c) => c.id === "sofa-plan-payment");

	it("change its Commitment's terms from this month on, as one Plan change", async () => {
		await addLoan();
		const result = await setLoanFacts(db, { householdId, accountId: "sofa-plan", ...facts, plan });
		expect(result).toEqual({
			ok: true,
			commitment: { id: "sofa-plan-payment", name: "sofa-plan", amountCents: 6_500, dueDay: 22 },
		});
		expect(await termsOf("2026-09")).toMatchObject({ amount: 5_000, dueDate: "2026-09-15" });
		expect(await termsOf("2026-10")).toMatchObject({ amount: 6_500, dueDate: "2026-10-22" });
		expect(await termsOf("2026-12")).toMatchObject({ amount: 6_500, cadence: "monthly" });
		const changes = await db
			.select()
			.from(s.planChanges)
			.where(eq(s.planChanges.kind, "commitment-terms"));
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ targetId: "sofa-plan-payment", memberId: parentId });
	});

	it("leave the terms alone when they already say the same, or nothing was said", async () => {
		await addLoan();
		const same = { borrowed: 30_000, payment: 5_000, dueDay: 15, endsOn: null };
		expect(await setLoanFacts(db, { householdId, accountId: "sofa-plan", ...same, plan })).toEqual({
			ok: true,
		});
		const unsaid = { borrowed: null, payment: null, dueDay: null, endsOn: null };
		expect(
			await setLoanFacts(db, { householdId, accountId: "sofa-plan", ...unsaid, plan }),
		).toEqual({
			ok: true,
		});
		expect(await termsOf("2026-10")).toMatchObject({ amount: 5_000, dueDate: "2026-09-15" });
		expect(
			await db.select().from(s.planChanges).where(eq(s.planChanges.kind, "commitment-terms")),
		).toEqual([]);
	});

	it("change only the payment when the due day stays, keeping the due date", async () => {
		await addLoan();
		await setLoanFacts(db, { householdId, accountId: "sofa-plan", ...facts, dueDay: 15, plan });
		expect(await termsOf("2026-10")).toMatchObject({ amount: 6_500, dueDate: "2026-09-15" });
	});

	it("leave a Commitment a Parent ended, and another Household's loan, alone", async () => {
		await addLoan();
		await endCommitment(db, {
			householdId,
			memberId: parentId,
			commitmentId: "sofa-plan-payment",
			month: "2026-10",
		});
		expect(await setLoanFacts(db, { householdId, accountId: "sofa-plan", ...facts, plan })).toEqual(
			{
				ok: true,
			},
		);
		expect(await termsOf("2026-09")).toMatchObject({ amount: 5_000 });
		expect(
			await setLoanFacts(db, { householdId: "other", accountId: "sofa-plan", ...facts, plan }),
		).toEqual({ ok: false });
	});
});
