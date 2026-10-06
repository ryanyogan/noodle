import type { Cents, DayKey, MonthKey } from "@noodle/domain";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addChild,
	addCommitment,
	addCommitmentPayment,
	addIncome,
	addQuickAdd,
	changeMoneyInKind,
	confirmPaidBack,
	createHouseholdForParent,
	type Db,
	deleteTransaction,
	loadCharges,
	loadIncome,
	loadOwedBack,
	loadPaidBack,
	loadPlanRecords,
	loadSpending,
	loadUnmatchedPaidBack,
	offerPaidBackFor,
	removeOwedBack,
	sayOwedBack,
	setTakeHomePay,
} from "./index";
import { bucketLeftSql } from "./moves";
import { setCarriesOver } from "./plan";
import { loadRolledOver } from "./rollover";
import { owedBack, paidBackMatches } from "./schema";
import { testDb } from "./test-db";

// Paid back and Owed back (issue 132, ADR-0058). The ticket's scenario: tuition of $1,200 in
// September, half owed by Casey; skates $45; the dentist $80; then $700 arrives in October.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const september: MonthKey = "2026-09";
const october: MonthKey = "2026-10";
const today: DayKey = "2026-10-06";

let db: Db;

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
	await setTakeHomePay(db, {
		householdId,
		memberId: parentId,
		month: september,
		amountCents: 900_000,
	});
	for (const [bucketId, color, allowanceCents] of [
		["hockey", 1, 40_000],
		["health", 2, 20_000],
	] as const) {
		await addBucket(db, {
			householdId,
			memberId: parentId,
			bucketId,
			name: bucketId,
			color,
			month: september,
			allowanceCents,
		});
	}
	// Planned at the Household's share: half of $1,200.
	await addCommitment(db, {
		householdId,
		memberId: parentId,
		commitmentId: "tuition",
		name: "Tuition",
		month: september,
		amountCents: 60_000,
		cadence: "monthly",
		dueDate: "2026-09-03",
	});
	await addChild(db, { householdId, memberId: "leo", name: "Leo", color: 3 });
	await addCommitmentPayment(db, {
		householdId,
		transactionId: "tuition-sep",
		commitmentId: "tuition",
		date: "2026-09-03",
		amountCents: 120_000 as Cents,
		createdByMemberId: parentId,
	});
	for (const [transactionId, bucketId, date, amountCents] of [
		["skates", "hockey", "2026-09-14", 4_500],
		["dentist", "health", "2026-09-20", 8_000],
	] as const) {
		await addQuickAdd(db, {
			householdId,
			transactionId,
			bucketId,
			date,
			amountCents: amountCents as Cents,
			note: transactionId,
			forMemberIds: ["leo"],
			createdByMemberId: parentId,
		});
	}
});

/** Casey owes half the tuition, and all of the skates and the dentist. */
async function caseyOwes() {
	await sayOwedBack(db, viewer, {
		owedBackId: "ob-tuition",
		transactionId: "tuition-sep",
		who: "Casey",
	});
	await sayOwedBack(db, viewer, {
		owedBackId: "ob-skates",
		transactionId: "skates",
		who: "Casey",
		amountCents: 4_500 as Cents,
	});
	await sayOwedBack(db, viewer, {
		owedBackId: "ob-dentist",
		transactionId: "dentist",
		who: "Casey",
		amountCents: 8_000 as Cents,
	});
}

/** Money in that a Parent said is Paid back. */
async function paidBack(incomeId: string, date: DayKey, amountCents: number, note = "Zelle") {
	await addIncome(db, {
		householdId,
		incomeId,
		date,
		amountCents: amountCents as Cents,
		note,
		createdByMemberId: parentId,
	});
	const changed = await changeMoneyInKind(db, viewer, {
		incomeId,
		kind: "paid-back",
		transferId: `${incomeId}-transfer`,
	});
	expect(changed.ok).toBe(true);
}

/** The offer for a line, confirmed as offered. */
async function confirmOffer(incomeId: string, asOf: DayKey = today) {
	const offered = await offerPaidBackFor(db, viewer, incomeId);
	if (!offered) throw new Error("no offer");
	return confirmPaidBack(db, viewer, {
		incomeId,
		matches: offered.offer.matches.map((match) => ({ ...match, id: `m-${match.owedBackId}` })),
		today: asOf,
	});
}

const bucketSpent = async (month: MonthKey) =>
	(await loadSpending(db, viewer, month))
		.map((spend) => [spend.bucketId, spend.amount, spend.for] as const)
		.sort();

const charged = async (month: MonthKey) =>
	(await loadCharges(db, viewer, month)).map((charge) => [charge.commitmentId, charge.amount]);

describe("saying someone's paying part of a purchase back", () => {
	it("is half unless said, and reads who and how much", async () => {
		const said = await sayOwedBack(db, viewer, {
			owedBackId: "ob-tuition",
			transactionId: "tuition-sep",
			who: "  Casey ",
		});
		expect(said).toMatchObject({ ok: true, item: { who: "Casey", owed: 60_000, paid: 0 } });
		expect(await loadOwedBack(db, viewer, { transactionId: "tuition-sep" })).toEqual([
			{
				id: "ob-tuition",
				transactionId: "tuition-sep",
				splitId: null,
				date: "2026-09-03",
				who: "Casey",
				memberId: null,
				owed: 60_000,
				paid: 0,
				purchase: null,
				purchaseAmount: 120_000,
				bucketId: null,
				commitmentId: "tuition",
			},
		]);
	});

	it("can be a Child, by their name, and a different amount", async () => {
		const said = await sayOwedBack(db, viewer, {
			owedBackId: "ob-skates",
			transactionId: "skates",
			who: "",
			memberId: "leo",
			amountCents: 2_000 as Cents,
		});
		expect(said).toMatchObject({
			ok: true,
			item: { who: "Leo", memberId: "leo", owed: 2_000, purchase: "skates", bucketId: "hockey" },
		});
	});

	it("is said once a purchase: saying it again changes who and how much", async () => {
		await sayOwedBack(db, viewer, { owedBackId: "one", transactionId: "skates", who: "Casey" });
		const again = await sayOwedBack(db, viewer, {
			owedBackId: "two",
			transactionId: "skates",
			who: "Sam",
			amountCents: 4_500 as Cents,
		});
		expect(again).toMatchObject({ ok: true, item: { id: "one", who: "Sam", owed: 4_500 } });
		expect(await loadOwedBack(db, viewer)).toHaveLength(1);
	});

	it("needs a name, a purchase of the Household's, and no more than the purchase", async () => {
		const say = (input: Partial<Parameters<typeof sayOwedBack>[2]>) =>
			sayOwedBack(db, viewer, {
				owedBackId: "ob",
				transactionId: "skates",
				who: "Casey",
				...input,
			});
		expect(await say({ who: "  " })).toEqual({ ok: false, reason: "no-name" });
		expect(await say({ transactionId: "nothing" })).toEqual({ ok: false, reason: "refused" });
		expect(await say({ amountCents: 4_501 as Cents })).toEqual({ ok: false, reason: "too-much" });
		expect(await say({ amountCents: 0 as Cents })).toEqual({ ok: false, reason: "too-much" });
		expect(await say({ memberId: parentId })).toEqual({ ok: false, reason: "refused" });
		expect(await loadOwedBack(db, viewer)).toEqual([]);
	});
});

describe("$700 arrives in October", () => {
	beforeEach(async () => {
		await caseyOwes();
		await paidBack("zelle", "2026-10-05", 70_000, "Zelle payment from CASEY LOWE");
	});

	it("is offered against what Casey owes, oldest first, and nothing counts until confirmed", async () => {
		const offered = await offerPaidBackFor(db, viewer, "zelle");
		expect(offered?.who).toBe("Casey");
		expect(offered?.offer).toEqual({
			matches: [
				{ owedBackId: "ob-tuition", amount: 60_000 },
				{ owedBackId: "ob-skates", amount: 4_500 },
				{ owedBackId: "ob-dentist", amount: 5_500 },
			],
			unmatched: 0,
		});
		expect(await bucketSpent(october)).toEqual([]);
		expect(await loadUnmatchedPaidBack(db, householdId)).toMatchObject([
			{ id: "zelle", unmatched: 70_000 },
		]);
	});

	it("settles tuition and skates, leaves the dentist partly owed, and restores each in October", async () => {
		const before = { spent: await bucketSpent(september), charged: await charged(september) };
		expect(await confirmOffer("zelle")).toEqual({ ok: true, unmatched: 0, months: [october] });

		const open = await loadOwedBack(db, viewer, { open: true });
		expect(open.map((item) => [item.id, item.owed - item.paid])).toEqual([["ob-dentist", 2_500]]);
		// Each purchase's Bucket or Commitment gets the money back in the month it arrived.
		expect(await bucketSpent(october)).toEqual([
			["health", -5_500, ["leo"]],
			["hockey", -4_500, ["leo"]],
		]);
		expect(await charged(october)).toEqual([["tuition", -60_000]]);
		// Marked as money Paid back, so nothing reads it as a payment of the bill.
		expect((await loadCharges(db, viewer, october)).map((charge) => charge.paidBack)).toEqual([
			true,
		]);
		// September ended as it ended.
		expect(await bucketSpent(september)).toEqual(before.spent);
		expect(await charged(september)).toEqual(before.charged);
		// Never Income.
		expect(await loadIncome(db, householdId, october, "2026-11")).toEqual([]);
		expect(await loadUnmatchedPaidBack(db, householdId)).toEqual([]);
	});

	it("gives a Bucket back what was Paid back, in what's left and in what carries over", async () => {
		await setCarriesOver(db, {
			householdId,
			memberId: parentId,
			bucketId: "hockey",
			month: september,
			rolling: true,
		});
		await confirmOffer("zelle");
		const [row] = await db.all(
			sql`select ${bucketLeftSql(householdId, "hockey", october)} as left`,
		);
		// $400 and nothing spent in October, plus the $45 back (what carried in is passed apart).
		expect((row as unknown as [number])[0]).toBe(44_500);
		const records = await loadPlanRecords(db, householdId, "2026-11");
		// September left $355; October's $400 and the $45 back carry on with it.
		expect(await loadRolledOver(db, householdId, records, "2026-11")).toEqual({ hockey: 80_000 });
	});

	it("takes the split a Parent settles on, and refuses one that doesn't fit", async () => {
		const confirm = (matches: [string, number][]) =>
			confirmPaidBack(db, viewer, {
				incomeId: "zelle",
				matches: matches.map(([owedBackId, amount]) => ({
					id: `m-${owedBackId}`,
					owedBackId,
					amount: amount as Cents,
				})),
				today,
			});
		expect(await confirm([["ob-skates", 4_501]])).toEqual({ ok: false, reason: "more-than-owed" });
		expect(
			await confirm([
				["ob-tuition", 60_000],
				["ob-dentist", 8_000],
			]),
		).toEqual({ ok: true, unmatched: 2_000, months: [october] });
		// Confirming again replaces what was matched.
		expect(await confirm([["ob-dentist", 8_000]])).toEqual({
			ok: true,
			unmatched: 62_000,
			months: [october],
		});
		expect((await loadPaidBack(db, householdId, "zelle"))?.matches).toMatchObject([
			{ owedBackId: "ob-dentist", amount: 8_000, countsOn: "2026-10-05" },
		]);
	});

	it("only matches money in that is Paid back", async () => {
		await addIncome(db, {
			householdId,
			incomeId: "pay",
			date: "2026-10-02",
			amountCents: 300_000 as Cents,
			note: "Pay",
			createdByMemberId: parentId,
		});
		expect(await offerPaidBackFor(db, viewer, "pay")).toBeNull();
		expect(
			await confirmPaidBack(db, viewer, {
				incomeId: "pay",
				matches: [{ id: "m", owedBackId: "ob-skates", amount: 4_500 as Cents }],
				today,
			}),
		).toEqual({ ok: false, reason: "not-paid-back" });
	});

	it("drops its matches when a Parent says it isn't Paid back after all", async () => {
		await confirmOffer("zelle");
		const changed = await changeMoneyInKind(db, viewer, {
			incomeId: "zelle",
			kind: "income",
			transferId: "unused",
		});
		expect(changed.ok).toBe(true);
		expect(await db.select().from(paidBackMatches)).toEqual([]);
		expect(await bucketSpent(october)).toEqual([]);
		expect((await loadOwedBack(db, viewer, { open: true })).map((item) => item.id)).toEqual([
			"ob-tuition",
			"ob-skates",
			"ob-dentist",
		]);
	});

	it("goes with its purchase when the purchase is deleted", async () => {
		await confirmOffer("zelle");
		const deleted = await deleteTransaction(db, {
			householdId,
			memberId: parentId,
			transactionId: "skates",
		});
		expect(deleted.ok).toBe(true);
		expect((await db.select().from(owedBack)).map((row) => row.id).sort()).toEqual([
			"ob-dentist",
			"ob-tuition",
		]);
		expect(await loadUnmatchedPaidBack(db, householdId)).toMatchObject([
			{ id: "zelle", unmatched: 4_500 },
		]);
	});

	it("is no longer owed when a Parent takes the Owed back off, and the money waits again", async () => {
		await confirmOffer("zelle");
		expect(await removeOwedBack(db, viewer, { owedBackId: "ob-skates", today })).toEqual({
			ok: true,
		});
		expect(await loadOwedBack(db, viewer, { transactionId: "skates" })).toEqual([]);
		expect(await loadUnmatchedPaidBack(db, householdId)).toMatchObject([
			{ id: "zelle", unmatched: 4_500 },
		]);
	});
});

describe("money beyond what's owed, and months that have ended", () => {
	beforeEach(caseyOwes);

	it("waits as Paid back, not matched yet, and is never Income", async () => {
		await paidBack("zelle", "2026-10-05", 80_000);
		expect(await confirmOffer("zelle")).toEqual({ ok: true, unmatched: 7_500, months: [october] });
		expect(await loadUnmatchedPaidBack(db, householdId)).toMatchObject([
			{ id: "zelle", amount: 80_000, unmatched: 7_500 },
		]);
		expect(await loadIncome(db, householdId, october, "2026-11")).toEqual([]);
		expect(await loadOwedBack(db, viewer, { open: true })).toEqual([]);
	});

	it("counts in the running month when the month it arrived in has ended", async () => {
		await paidBack("late", "2026-09-28", 4_500);
		const before = await bucketSpent(september);
		expect(
			await confirmPaidBack(db, viewer, {
				incomeId: "late",
				matches: [{ id: "m", owedBackId: "ob-skates", amount: 4_500 as Cents }],
				today,
			}),
		).toEqual({ ok: true, unmatched: 0, months: [october] });
		expect(await bucketSpent(september)).toEqual(before);
		expect(await bucketSpent(october)).toEqual([["hockey", -4_500, ["leo"]]]);
	});

	it("leaves a match alone once the month it counted in has ended", async () => {
		await paidBack("zelle", "2026-10-05", 70_000);
		await confirmOffer("zelle");
		const november: DayKey = "2026-11-03";
		// In November the October matches stand: only what's unmatched can still be placed.
		expect(
			await confirmPaidBack(db, viewer, { incomeId: "zelle", matches: [], today: november }),
		).toEqual({ ok: true, unmatched: 0, months: [] });
		expect(await bucketSpent(october)).toHaveLength(2);
		expect(await removeOwedBack(db, viewer, { owedBackId: "ob-skates", today: november })).toEqual({
			ok: false,
			reason: "month-ended",
		});
	});
});
