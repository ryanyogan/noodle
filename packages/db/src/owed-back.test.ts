import type { Cents, DayKey, MonthKey } from "@noodle/domain";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBankConnection,
	addBucket,
	addChild,
	addCommitment,
	addCommitmentPayment,
	addIncome,
	addQuickAdd,
	changeMoneyInKind,
	chooseBankAccounts,
	clearHouseholdRows,
	confirmPaidBack,
	createHouseholdForParent,
	type Db,
	deleteTransaction,
	deleteTransactions,
	editMoneyIn,
	fileCategorizations,
	listRules,
	loadCharges,
	loadExportData,
	loadIncome,
	loadMoneyIn,
	loadOwedBack,
	loadPaidBack,
	loadPlanRecords,
	loadSpending,
	loadTransactionsPage,
	loadUnmatchedPaidBack,
	offerPaidBackFor,
	removeChild,
	removeOwedBack,
	returnToReview,
	sayOwedBack,
	setTakeHomePay,
	splitTransaction,
	syncBankLines,
	updateTransaction,
} from "./index";
import { bucketLeftSql } from "./moves";
import {
	applyOwedBackRules,
	forgetOwedBack,
	owedBackRuleFor,
	rememberOwedBack,
} from "./owed-back-rules";
import { setCarriesOver } from "./plan";
import { loadRolledOver } from "./rollover";
import { applyRule, saveRule } from "./rules";
import { income, owedBack, paidBackMatches, refundLinks, splits, transactions } from "./schema";
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
				writtenOff: 0,
				writtenOffOn: null,
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

	it("lets a Parent take one match off: it is owed again and the money waits to be matched", async () => {
		expect((await offerPaidBackFor(db, viewer, "zelle"))?.settles).toEqual([]);
		await confirmOffer("zelle");
		const settled = await offerPaidBackFor(db, viewer, "zelle");
		// What the line settles is named, settled in full or not, so each can be taken off.
		expect(settled?.settles.map((item) => [item.id, item.who, item.paid])).toEqual([
			["ob-tuition", "Casey", 60_000],
			["ob-skates", "Casey", 4_500],
			["ob-dentist", "Casey", 5_500],
		]);
		const without = (settled?.matches ?? [])
			.filter((match) => match.owedBackId !== "ob-skates")
			.map((match, i) => ({
				id: `again-${i}`,
				owedBackId: match.owedBackId,
				amount: match.amount,
			}));
		expect(
			await confirmPaidBack(db, viewer, { incomeId: "zelle", matches: without, today }),
		).toEqual({ ok: true, unmatched: 4_500, months: [october] });
		const open = await loadOwedBack(db, viewer, { open: true });
		expect(open.map((item) => [item.id, item.owed - item.paid])).toEqual([
			["ob-skates", 4_500],
			["ob-dentist", 2_500],
		]);
		expect(await bucketSpent(october)).toEqual([["health", -5_500, ["leo"]]]);
		expect(await charged(october)).toEqual([["tuition", -60_000]]);
		// And it is offered again, to match as before or somewhere else.
		const again = await offerPaidBackFor(db, viewer, "zelle");
		expect(again?.offer).toEqual({
			matches: [{ owedBackId: "ob-skates", amount: 4_500 }],
			unmatched: 0,
		});
		expect(again?.settles.map((item) => item.id)).toEqual(["ob-tuition", "ob-dentist"]);
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
			today,
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
			today,
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

describe("a Rule remembers who pays part back", () => {
	const line = (id: string, date: string, amountCents: number) => ({
		id,
		householdId,
		source: "import" as const,
		date,
		amountCents,
		note: "RIVERSIDE ACADEMY TUITION",
		accountId: "checking",
		createdByMemberId: parentId,
	});

	beforeEach(async () => {
		await addAccount(db, {
			householdId,
			accountId: "checking",
			name: "Checking",
			kind: "checking",
			balanceCents: 0,
			balanceId: "balance-checking",
			createdByMemberId: parentId,
		});
		await db.insert(transactions).values(line("academy-sep", "2026-09-05", 120_000));
		await saveRule(db, {
			id: "academy",
			householdId,
			memberId: parentId,
			pattern: "riverside academy",
			commitmentId: "tuition",
		});
		await applyRule(db, viewer, "academy");
	});

	it("is offered on a purchase a Rule files, and remembers who and what part", async () => {
		expect(await owedBackRuleFor(db, viewer, "academy-sep")).toEqual({
			ruleId: "academy",
			pattern: "riverside academy",
			remembered: null,
		});
		// The skates go by no Rule: there is nothing to offer.
		expect(await owedBackRuleFor(db, viewer, "skates")).toBeNull();
		await sayOwedBack(db, viewer, {
			owedBackId: "ob-academy",
			transactionId: "academy-sep",
			who: "Casey",
		});
		const remembered = { who: "Casey", memberId: null, percent: 50 };
		expect(await rememberOwedBack(db, viewer, { owedBackId: "ob-academy" })).toEqual({
			ok: true,
			rule: { ruleId: "academy", pattern: "riverside academy", remembered },
		});
		expect((await owedBackRuleFor(db, viewer, "academy-sep"))?.remembered).toEqual(remembered);
	});

	it("says it on what the Rule files afterwards, once, and not on what it filed before", async () => {
		await sayOwedBack(db, viewer, {
			owedBackId: "ob-academy",
			transactionId: "academy-sep",
			who: "Casey",
		});
		await rememberOwedBack(db, viewer, { owedBackId: "ob-academy" });
		await db.insert(transactions).values(line("academy-oct", "2026-10-05", 130_000));
		await applyRule(db, viewer, "academy");
		const october = await loadOwedBack(db, viewer, { transactionId: "academy-oct" });
		expect(october).toMatchObject([
			{ who: "Casey", owed: 65_000, paid: 0, commitmentId: "tuition", splitId: null },
		]);
		// An ID that passes wherever a ULID is asked for.
		expect(october[0]?.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		// Said again for the same purchases: nothing is doubled.
		await applyOwedBackRules(db, viewer, [
			{ transactionId: "academy-oct", ruleId: "academy" },
			{ transactionId: "academy-sep", ruleId: "academy" },
		]);
		expect(await loadOwedBack(db, viewer, { open: true })).toHaveLength(2);
	});

	it("says it on what a run files by the Rule: an Import, the bank, a captured Quick Add", async () => {
		await sayOwedBack(db, viewer, {
			owedBackId: "ob-academy",
			transactionId: "academy-sep",
			who: "Casey",
		});
		await rememberOwedBack(db, viewer, { owedBackId: "ob-academy" });
		// The Rules page says what the Rule remembers.
		expect((await listRules(db, viewer)).find((rule) => rule.id === "academy")).toMatchObject({
			owedBack: { who: "Casey", percent: 50 },
		});
		await db.insert(transactions).values(line("academy-oct", "2026-10-05", 130_000));
		// The decision categorize-run.ts makes for a line its Rule matches: the one writer behind
		// all three ways a line comes in.
		await fileCategorizations(db, viewer, [
			{
				transactionId: "academy-oct",
				merchant: "riverside academy",
				ruleId: "academy",
				categorization: {
					outcome: "filed",
					method: "rule",
					bucketId: null,
					commitmentId: "tuition",
					confidence: 1,
					for: [],
				},
			},
		]);
		expect(await loadOwedBack(db, viewer, { transactionId: "academy-oct" })).toMatchObject([
			{ who: "Casey", owed: 65_000, paid: 0, commitmentId: "tuition" },
		]);
	});

	it("says nothing once the Rule has forgotten, or when it never remembered", async () => {
		await db.insert(transactions).values(line("academy-oct", "2026-10-05", 130_000));
		await applyRule(db, viewer, "academy");
		expect(await loadOwedBack(db, viewer, { transactionId: "academy-oct" })).toEqual([]);
		await sayOwedBack(db, viewer, {
			owedBackId: "ob-academy",
			transactionId: "academy-sep",
			who: "Casey",
		});
		await rememberOwedBack(db, viewer, { owedBackId: "ob-academy" });
		await forgetOwedBack(db, viewer, "academy");
		await db.insert(transactions).values(line("academy-nov", "2026-11-05", 130_000));
		await applyRule(db, viewer, "academy");
		expect(await loadOwedBack(db, viewer, { transactionId: "academy-nov" })).toEqual([]);
	});
});

describe("around Owed back", () => {
	it("keeps what a Child owes once the Child is removed from the Household", async () => {
		await sayOwedBack(db, viewer, {
			owedBackId: "ob-skates",
			transactionId: "skates",
			who: "",
			memberId: "leo",
			amountCents: 2_000 as Cents,
		});
		await removeChild(db, { householdId, memberId: "leo" });
		expect(await loadOwedBack(db, viewer, { open: true })).toMatchObject([
			{ id: "ob-skates", who: "Leo", memberId: "leo", owed: 2_000, paid: 0 },
		]);
		// And it can still be Paid back.
		await paidBack("from-leo", "2026-10-02", 2_000);
		expect((await confirmOffer("from-leo")).ok).toBe(true);
		expect(await loadOwedBack(db, viewer, { open: true })).toEqual([]);
	});

	it("is in Download your data, with what each Paid back line settled", async () => {
		await caseyOwes();
		await paidBack("zelle", "2026-10-02", 70_000);
		expect((await confirmOffer("zelle")).ok).toBe(true);
		const data = await loadExportData(db, viewer, today, 0);
		expect(data.owedBack).toEqual([
			{
				id: "ob-tuition",
				transactionId: "tuition-sep",
				splitId: null,
				date: "2026-09-03",
				purchase: null,
				who: "Casey",
				owedCents: 60_000,
				paidBackCents: 60_000,
				writtenOffCents: 0,
				writtenOffOn: null,
			},
			{
				id: "ob-skates",
				transactionId: "skates",
				splitId: null,
				date: "2026-09-14",
				purchase: "skates",
				who: "Casey",
				owedCents: 4_500,
				paidBackCents: 4_500,
				writtenOffCents: 0,
				writtenOffOn: null,
			},
			{
				id: "ob-dentist",
				transactionId: "dentist",
				splitId: null,
				date: "2026-09-20",
				purchase: "dentist",
				who: "Casey",
				owedCents: 8_000,
				paidBackCents: 5_500,
				writtenOffCents: 0,
				writtenOffOn: null,
			},
		]);
		expect(data.paidBackMatches).toHaveLength(3);
		expect(data.paidBackMatches).toContainEqual({
			incomeId: "zelle",
			owedBackId: "ob-dentist",
			amountCents: 5_500,
			countsOn: "2026-10-02",
		});
	});
});

describe("splitting again a purchase with Owed back on one of its Splits", () => {
	const split = (parts: [id: string, amount: number, bucketId: string][]) =>
		splitTransaction(db, {
			householdId,
			memberId: parentId,
			transactionId: "skates",
			amountCents: 4_500 as Cents,
			note: "skates",
			splits: parts.map(([id, amount, bucketId]) => ({
				id,
				amountCents: amount as Cents,
				assignment: { bucketId },
				forMemberIds: ["leo"],
			})),
		});
	const onSkates = async () =>
		(await loadOwedBack(db, viewer, { transactionId: "skates" })).map((item) => ({
			id: item.id,
			splitId: item.splitId,
			who: item.who,
			owed: item.owed,
			paid: item.paid,
			purchaseAmount: item.purchaseAmount,
		}));
	const stored = async () =>
		(await db.select().from(owedBack))
			.filter((row) => row.transactionId === "skates")
			.map((row) => [row.id, row.splitId, row.amountCents]);

	beforeEach(async () => {
		expect(
			(
				await split([
					["blade", 3_000, "hockey"],
					["laces", 1_500, "health"],
				])
			).ok,
		).toBe(true);
		const said = await sayOwedBack(db, viewer, {
			owedBackId: "ob-blade",
			transactionId: "skates",
			splitId: "blade",
			who: "Casey",
			amountCents: 2_000 as Cents,
		});
		expect(said).toMatchObject({ ok: true, item: { splitId: "blade", purchaseAmount: 3_000 } });
		await paidBack("zelle", "2026-10-05", 1_200);
		expect(
			await confirmPaidBack(db, viewer, {
				incomeId: "zelle",
				matches: [{ id: "m-blade", owedBackId: "ob-blade", amount: 1_200 as Cents }],
				today,
			}),
		).toMatchObject({ ok: true });
	});

	const onTheWholePurchase = [
		{
			id: "ob-blade",
			splitId: null,
			who: "Casey",
			owed: 2_000,
			paid: 1_200,
			purchaseAmount: 4_500,
		},
	];

	it("moves it to the whole purchase: who, how much and what was Paid back stay", async () => {
		expect(
			(
				await split([
					["boots", 2_500, "hockey"],
					["tape", 2_000, "health"],
				])
			).ok,
		).toBe(true);
		expect(await stored()).toEqual([["ob-blade", null, 2_000]]);
		expect(await onSkates()).toEqual(onTheWholePurchase);
		// Said again on the whole purchase, it is the same item, not a second one.
		const again = await sayOwedBack(db, viewer, {
			owedBackId: "ob-again",
			transactionId: "skates",
			who: "Casey",
			amountCents: 2_500 as Cents,
		});
		expect(again).toMatchObject({ ok: true, item: { id: "ob-blade", owed: 2_500, paid: 1_200 } });
		expect(await stored()).toEqual([["ob-blade", null, 2_500]]);
	});

	it("stays on its Split when the same Split is written again", async () => {
		await split([
			["blade", 3_000, "hockey"],
			["tape", 1_500, "health"],
		]);
		expect(await stored()).toEqual([["ob-blade", "blade", 2_000]]);
		expect(await onSkates()).toMatchObject([{ splitId: "blade", purchaseAmount: 3_000 }]);
	});

	it("moves it when the purchase is filed whole again", async () => {
		const edited = await updateTransaction(db, {
			householdId,
			memberId: parentId,
			transactionId: "skates",
			amountCents: 4_500 as Cents,
			assignment: { bucketId: "hockey" },
			note: "skates",
			forMemberIds: ["leo"],
		});
		expect(edited.ok).toBe(true);
		expect(await stored()).toEqual([["ob-blade", null, 2_000]]);
		expect(await onSkates()).toEqual(onTheWholePurchase);
	});

	it("moves it when the purchase is put back in Review", async () => {
		await returnToReview(db, viewer, {
			transactionId: "skates",
			merchant: "skates",
			guess: null,
			forMemberIds: ["leo"],
		});
		expect(await stored()).toEqual([["ob-blade", null, 2_000]]);
		expect(await onSkates()).toEqual(onTheWholePurchase);
	});

	it("moves the first of two, and still reads the second against the whole purchase", async () => {
		await sayOwedBack(db, viewer, {
			owedBackId: "ob-laces",
			transactionId: "skates",
			splitId: "laces",
			who: "Leo",
			memberId: "leo",
			amountCents: 500 as Cents,
		});
		await split([
			["boots", 2_500, "hockey"],
			["tape", 2_000, "health"],
		]);
		expect(await onSkates()).toMatchObject([
			{ id: "ob-blade", splitId: null, owed: 2_000, paid: 1_200, purchaseAmount: 4_500 },
			// One item a purchase is on the whole of it; the other still names its gone Split.
			{ id: "ob-laces", splitId: "laces", owed: 500, paid: 0, purchaseAmount: 4_500 },
		]);
	});
});

describe("a Fresh start with Owed back, Paid back and a linked Refund", () => {
	it("clears them all, children first", async () => {
		await caseyOwes();
		await paidBack("zelle", "2026-10-05", 70_000);
		await confirmOffer("zelle");
		await addIncome(db, {
			householdId,
			incomeId: "refund",
			date: "2026-10-04",
			amountCents: 1_000 as Cents,
			note: "Refund",
			createdByMemberId: parentId,
		});
		await db.insert(refundLinks).values({
			incomeId: "refund",
			householdId,
			transactionId: "dentist",
			countsOn: "2026-10-04",
			createdByMemberId: parentId,
		});
		await clearHouseholdRows(db, householdId, "fresh-start");
		expect(await db.select().from(owedBack)).toEqual([]);
		expect(await db.select().from(paidBackMatches)).toEqual([]);
		expect(await db.select().from(refundLinks)).toEqual([]);
		expect(await db.select().from(transactions)).toEqual([]);
	});
});

describe("what counted in a month that has ended stays as it was", () => {
	const november: DayKey = "2026-11-03";
	const matches = async () =>
		(await db.select().from(paidBackMatches))
			.map((row) => [row.owedBackId, row.amountCents])
			.sort();
	const settled = [
		["ob-skates", 4_500],
		["ob-tuition", 60_000],
	];

	beforeEach(async () => {
		await caseyOwes();
		await paidBack("zelle", "2026-10-05", 64_500);
		await confirmOffer("zelle");
	});

	it("refuses a change of kind once the line's matches counted in a month that has ended", async () => {
		expect(
			await changeMoneyInKind(db, viewer, {
				incomeId: "zelle",
				kind: "income",
				transferId: "unused",
				today: november,
			}),
		).toEqual({ ok: false, reason: "month-ended" });
		expect(await matches()).toEqual(settled);
		expect(await bucketSpent(october)).toHaveLength(1);
		expect((await loadPaidBack(db, householdId, "zelle"))?.line.kind).toBe("paid-back");
	});

	it("refuses deleting a purchase whose money back counted in a month that has ended", async () => {
		expect(
			await deleteTransaction(db, {
				householdId,
				memberId: parentId,
				transactionId: "skates",
				today: november,
			}),
		).toEqual({ ok: false, reason: "month-ended" });
		expect(await matches()).toEqual(settled);
		expect(await bucketSpent(october)).toHaveLength(1);
	});

	it("refuses an edit or a split that would move the ended month, and lets its note and For change", async () => {
		const [was] = await db.select().from(transactions).where(sql`${transactions.id} = 'skates'`);
		if (!was) throw new Error("no skates");
		const filed = was.bucketId
			? { bucketId: was.bucketId }
			: { commitmentId: was.commitmentId as string };
		const edit = (over: Record<string, unknown>) =>
			updateTransaction(db, {
				householdId,
				memberId: parentId,
				transactionId: "skates",
				amountCents: was.amountCents as Cents,
				assignment: filed,
				note: was.note,
				forMemberIds: [],
				today: november,
				...over,
			});
		const spentBefore = await bucketSpent(october);
		expect(await edit({ amountCents: 4_000 })).toEqual({ ok: false, reason: "month-ended" });
		expect(
			await edit({ assignment: { bucketId: was.bucketId === "hockey" ? "health" : "hockey" } }),
		).toEqual({ ok: false, reason: "month-ended" });
		expect(
			await splitTransaction(db, {
				householdId,
				memberId: parentId,
				transactionId: "skates",
				amountCents: was.amountCents as Cents,
				note: was.note,
				splits: [
					{
						id: "s-1",
						amountCents: 3_000 as Cents,
						assignment: { bucketId: "hockey" },
						forMemberIds: [],
					},
					{
						id: "s-2",
						amountCents: 1_500 as Cents,
						assignment: { bucketId: "health" },
						forMemberIds: [],
					},
				],
				today: november,
			}),
		).toEqual({ ok: false, reason: "month-ended" });
		expect(await bucketSpent(october)).toEqual(spentBefore);
		expect(await matches()).toEqual(settled);
		// Harmless: the note and who it's For.
		expect((await edit({ note: "new skates", forMemberIds: ["leo"] })).ok).toBe(true);
		expect(await bucketSpent(october)).toEqual(spentBefore);
		// While its month runs, the same change of amount is an ordinary edit.
		expect((await edit({ amountCents: 4_600, note: "new skates", today })).ok).toBe(true);
	});

	it("leaves such a purchase out when several are deleted at once", async () => {
		expect(
			await deleteTransactions(db, viewer, { ids: ["skates", "dentist"] }, { today: november }),
		).toEqual({ deleted: 1, kept: 1 });
		expect(await matches()).toEqual(settled);
		expect(
			(await db.select({ id: transactions.id }).from(transactions)).map((row) => row.id),
		).toContain("skates");
	});

	// A bank line of $80 in and a $30 purchase, the $80 Paid back on the dentist ($50) and on the
	// purchase ($30), both confirmed in October.
	const bankSetup = async () => {
		await addBankConnection(db, {
			householdId,
			connectionId: "conn-1",
			provider: "plaid",
			externalId: "item-1",
			institution: "First Platypus Bank",
			credential: "v1:sealed",
			createdByMemberId: parentId,
		});
		await chooseBankAccounts(db, {
			householdId,
			connectionId: "conn-1",
			createdByMemberId: parentId,
			choices: [
				{
					balanceId: "bank-b",
					account: {
						externalId: "acc-ch",
						name: "Bank",
						mask: null,
						kind: "checking",
						balance: null,
					},
					choice: { kind: "add", accountId: "bank" },
				},
			],
		});
		let ids = 0;
		const sync = (importId: string, lines: unknown[], removed: string[], asOf: DayKey) =>
			syncBankLines(db, {
				householdId,
				connectionId: "conn-1",
				accountId: "bank",
				importId,
				lines: lines as never,
				removed,
				createdByMemberId: parentId,
				newId: () => `bank-${++ids}`,
				today: asOf,
			});
		const bankLine = (bankId: string, date: string, amount: number, description: string) => ({
			accountExternalId: "acc-ch",
			bankId,
			date,
			amount,
			description,
		});
		await sync(
			"imp-1",
			[
				bankLine("in-1", "2026-10-06", 80_00, "ACH CREDIT CASEY LOWE"),
				bankLine("out-1", "2026-10-02", -30_00, "Rink Shop"),
			],
			[],
			today,
		);
		const [arrived] = await db.select().from(income).where(sql`${income.accountId} = 'bank'`);
		const [bought] = await db
			.select()
			.from(transactions)
			.where(sql`${transactions.accountId} = 'bank'`);
		if (!arrived || !bought) throw new Error("the bank's lines didn't arrive");
		await db
			.update(transactions)
			.set({ bucketId: "hockey" })
			.where(sql`${transactions.id} = ${bought.id}`);
		expect(
			(
				await changeMoneyInKind(db, viewer, {
					incomeId: arrived.id,
					kind: "paid-back",
					transferId: "unused",
					today,
				})
			).ok,
		).toBe(true);
		expect(
			(
				await sayOwedBack(db, viewer, {
					owedBackId: "ob-shop",
					transactionId: bought.id,
					who: "Casey",
					amountCents: 3_000 as Cents,
				})
			).ok,
		).toBe(true);
		expect(
			await confirmPaidBack(db, viewer, {
				incomeId: arrived.id,
				matches: [
					{ id: "m-bank", owedBackId: "ob-dentist", amount: 5_000 as Cents },
					{ id: "m-shop", owedBackId: "ob-shop", amount: 3_000 as Cents },
				],
				today,
			}),
		).toMatchObject({ ok: true });
		return { sync, bankLine, arrived, bought };
	};
	const lineNow = async (id: string) =>
		(await db.select().from(income).where(sql`${income.id} = ${id}`))[0];
	const purchaseNow = async (id: string) =>
		(await db.select().from(transactions).where(sql`${transactions.id} = ${id}`))[0];
	const matchAmounts = async () =>
		Object.fromEntries(
			(await db.select().from(paidBackMatches)).map((row) => [row.id, row.amountCents]),
		);

	it("says the bank took it back when a line it had lowered, and that was kept, is withdrawn later", async () => {
		const { sync, arrived, bought } = await bankSetup();
		// Lowered earlier, and kept as it was: "The bank changed this to $60".
		const lowered = { bankTookBackOn: "2026-11-01", bankAmountCents: 6_000 };
		await db.update(transactions).set(lowered).where(sql`${transactions.id} = ${bought.id}`);
		await db.update(income).set(lowered).where(sql`${income.id} = ${arrived.id}`);

		await sync("imp-2", [], ["in-1", "out-1"], november);
		// The withdrawal is what happened last, so it is what the line says, with its own day.
		expect(await purchaseNow(bought.id)).toMatchObject({
			bankTookBackOn: november,
			bankAmountCents: null,
		});
		expect(await lineNow(arrived.id)).toMatchObject({
			bankTookBackOn: november,
			bankAmountCents: null,
		});
	});

	it("keeps a line the bank withdraws, and a purchase it withdraws, once they counted in an ended month", async () => {
		const { sync, arrived, bought } = await bankSetup();
		const spentBefore = await bucketSpent(october);

		await sync("imp-2", [], ["in-1", "out-1"], november);
		expect((await db.select().from(paidBackMatches)).map((row) => row.id).sort()).toEqual([
			"m-bank",
			"m-ob-skates",
			"m-ob-tuition",
			"m-shop",
		]);
		expect(await bucketSpent(october)).toEqual(spentBefore);
		expect(await db.select().from(income).where(sql`${income.id} = ${arrived.id}`)).toHaveLength(1);
		// And they say so: the day the bank took them back (issue 141).
		expect(await lineNow(arrived.id)).toMatchObject({
			bankTookBackOn: november,
			bankAmountCents: null,
		});
		expect(await purchaseNow(bought.id)).toMatchObject({
			bankTookBackOn: november,
			bankAmountCents: null,
		});
		expect((await loadMoneyIn(db, householdId)).find((row) => row.id === arrived.id)).toMatchObject(
			{ bankTookBackOn: november, bankAmount: null },
		);
		// A later sync naming them again keeps the first day.
		await sync("imp-3", [], ["in-1", "out-1"], "2026-11-20");
		expect((await lineNow(arrived.id))?.bankTookBackOn).toBe(november);
	});

	it("trims the newest matches when the bank lowers a Paid back line in the running month", async () => {
		const { sync, bankLine, arrived } = await bankSetup();
		await sync(
			"imp-2",
			[bankLine("in-1", "2026-10-06", 60_00, "ACH CREDIT CASEY LOWE")],
			[],
			today,
		);
		expect(await lineNow(arrived.id)).toMatchObject({ amountCents: 6_000, bankTookBackOn: null });
		// $50 + $30 was more than $60: the newest match gives up $20, which is owed again.
		expect(await matchAmounts()).toMatchObject({ "m-bank": 5_000, "m-shop": 1_000 });
		expect(
			(await loadOwedBack(db, viewer, { open: true })).find((item) => item.id === "ob-shop"),
		).toMatchObject({ owed: 3_000, paid: 1_000 });
		// Lower than its first match: that one is trimmed and the newer one goes.
		await sync(
			"imp-3",
			[bankLine("in-1", "2026-10-06", 40_00, "ACH CREDIT CASEY LOWE")],
			[],
			today,
		);
		const left = await matchAmounts();
		expect(left["m-bank"]).toBe(4_000);
		expect(left["m-shop"]).toBeUndefined();
	});

	it("keeps a Paid back line as it was when the bank lowers it after its month ended, and says so", async () => {
		const { sync, bankLine, arrived } = await bankSetup();
		const spentBefore = await bucketSpent(october);
		await sync(
			"imp-2",
			[bankLine("in-1", "2026-10-06", 60_00, "ACH CREDIT CASEY LOWE")],
			[],
			november,
		);
		expect(await lineNow(arrived.id)).toMatchObject({
			amountCents: 8_000,
			bankTookBackOn: november,
			bankAmountCents: 6_000,
		});
		expect(await matchAmounts()).toMatchObject({ "m-bank": 5_000, "m-shop": 3_000 });
		expect(await bucketSpent(october)).toEqual(spentBefore);
	});

	it("trims what was Paid back on a purchase the bank lowers in the running month", async () => {
		const { sync, bankLine, bought } = await bankSetup();
		await sync("imp-2", [bankLine("out-1", "2026-10-02", -20_00, "Rink Shop")], [], today);
		expect(await purchaseNow(bought.id)).toMatchObject({
			amountCents: 2_000,
			bankTookBackOn: null,
		});
		const [item] = await loadOwedBack(db, viewer, { id: "ob-shop" });
		expect(item).toMatchObject({ owed: 2_000, paid: 2_000 });
		expect((await matchAmounts())["m-shop"]).toBe(2_000);
	});

	it("keeps a purchase as it was when the bank lowers it below its money back after the month ended", async () => {
		const { sync, bankLine, bought } = await bankSetup();
		const spentBefore = await bucketSpent(october);
		await sync("imp-2", [bankLine("out-1", "2026-10-02", -20_00, "Rink Shop")], [], november);
		expect(await purchaseNow(bought.id)).toMatchObject({
			amountCents: 3_000,
			bankTookBackOn: november,
			bankAmountCents: 2_000,
		});
		expect((await matchAmounts())["m-shop"]).toBe(3_000);
		expect(await bucketSpent(october)).toEqual(spentBefore);
		const row = (
			await loadTransactionsPage(db, viewer, { month: october, limit: 200 } as never)
		).transactions.find((one) => one.id === bought.id);
		expect(row).toMatchObject({ bankTookBackOn: november, bankAmount: 2_000 });
		// Lowered, but still at least its money back: the amount follows the bank.
		await sync("imp-3", [bankLine("out-1", "2026-10-02", -30_00, "Rink Shop")], [], november);
		expect((await purchaseNow(bought.id))?.amountCents).toBe(3_000);
	});

	/** A second purchase from the bank, split in two, with Owed back said and Paid back on one Split. */
	const splitSetup = async () => {
		const made = await bankSetup();
		await made.sync(
			"imp-s",
			[
				made.bankLine("out-2", "2026-10-03", -40_00, "Skate Barn"),
				made.bankLine("in-2", "2026-10-06", 30_00, "ACH CREDIT CASEY LOWE"),
			],
			[],
			today,
		);
		const [barn] = await db
			.select()
			.from(transactions)
			.where(sql`${transactions.accountId} = 'bank' and ${transactions.amountCents} = 4000`);
		const [paid] = await db
			.select()
			.from(income)
			.where(sql`${income.accountId} = 'bank' and ${income.amountCents} = 3000`);
		if (!barn || !paid) throw new Error("the bank's second lines didn't arrive");
		expect(
			await splitTransaction(db, {
				householdId,
				memberId: parentId,
				transactionId: barn.id,
				amountCents: 4_000 as Cents,
				note: barn.note,
				splits: [
					{
						id: "barn-a",
						amountCents: 3_000 as Cents,
						assignment: { bucketId: "hockey" },
						forMemberIds: [],
					},
					{
						id: "barn-b",
						amountCents: 1_000 as Cents,
						assignment: { bucketId: "health" },
						forMemberIds: [],
					},
				],
			}),
		).toMatchObject({ ok: true });
		expect(
			(
				await sayOwedBack(db, viewer, {
					owedBackId: "ob-barn",
					transactionId: barn.id,
					splitId: "barn-a",
					who: "Casey",
					amountCents: 3_000 as Cents,
				})
			).ok,
		).toBe(true);
		expect(
			(
				await changeMoneyInKind(db, viewer, {
					incomeId: paid.id,
					kind: "paid-back",
					transferId: "unused-2",
					today,
				})
			).ok,
		).toBe(true);
		expect(
			await confirmPaidBack(db, viewer, {
				incomeId: paid.id,
				matches: [{ id: "m-barn", owedBackId: "ob-barn", amount: 3_000 as Cents }],
				today,
			}),
		).toMatchObject({ ok: true });
		const splitAmounts = async () =>
			Object.fromEntries(
				(await db.select().from(splits).where(sql`${splits.transactionId} = ${barn.id}`)).map(
					(row) => [row.id, row.amountCents],
				),
			);
		return { ...made, barn, splitAmounts };
	};

	it("caps Owed back said on a Split at the Split's new amount when the bank lowers the purchase in the running month", async () => {
		const { sync, bankLine, barn, splitAmounts } = await splitSetup();
		await sync("imp-2", [bankLine("out-2", "2026-10-03", -20_00, "Skate Barn")], [], today);
		expect(await purchaseNow(barn.id)).toMatchObject({ amountCents: 2_000, bankTookBackOn: null });
		const now = await splitAmounts();
		expect((now["barn-a"] ?? 0) + (now["barn-b"] ?? 0)).toBe(2_000);
		expect(now["barn-a"]).toBeLessThan(3_000);
		const [item] = await loadOwedBack(db, viewer, { id: "ob-barn" });
		// Never more than its Split came to, and never more Paid back on it than is owed.
		expect(item).toMatchObject({ owed: now["barn-a"], paid: now["barn-a"] });
		expect((await matchAmounts())["m-barn"]).toBe(now["barn-a"]);
	});

	it("keeps a split purchase and its Splits when the bank lowers it below what one Split had Paid back, after the month ended", async () => {
		const { sync, bankLine, barn, splitAmounts } = await splitSetup();
		const spentBefore = await bucketSpent(october);
		// $36 is still more than the $30 Paid back, but its Split's share of it is not.
		await sync("imp-2", [bankLine("out-2", "2026-10-03", -36_00, "Skate Barn")], [], november);
		expect(await purchaseNow(barn.id)).toMatchObject({
			amountCents: 4_000,
			bankTookBackOn: november,
			bankAmountCents: 3_600,
		});
		expect(await splitAmounts()).toEqual({ "barn-a": 3_000, "barn-b": 1_000 });
		const [item] = await loadOwedBack(db, viewer, { id: "ob-barn" });
		expect(item).toMatchObject({ owed: 3_000, paid: 3_000 });
		expect((await matchAmounts())["m-barn"]).toBe(3_000);
		expect(await bucketSpent(october)).toEqual(spentBefore);
	});

	it("still lets all of it go while the month is running", async () => {
		expect(
			(
				await changeMoneyInKind(db, viewer, {
					incomeId: "zelle",
					kind: "income",
					transferId: "unused",
					today,
				})
			).ok,
		).toBe(true);
		expect(await matches()).toEqual([]);
	});
});

describe("a typed, linked Refund's amount", () => {
	it("can't go above what its purchase cost, or change once it counted in an ended month", async () => {
		await caseyOwes();
		await addIncome(db, {
			householdId,
			incomeId: "refund",
			date: "2026-10-04",
			amountCents: 1_000 as Cents,
			note: "Refund",
			createdByMemberId: parentId,
		});
		expect(
			(
				await changeMoneyInKind(db, viewer, {
					incomeId: "refund",
					kind: "refund",
					transferId: "unused",
					today,
				})
			).ok,
		).toBe(true);
		await db.insert(refundLinks).values({
			incomeId: "refund",
			householdId,
			transactionId: "dentist",
			countsOn: "2026-10-04",
			createdByMemberId: parentId,
		});
		const [dentist] = await db
			.select()
			.from(transactions)
			.where(sql`${transactions.id} = 'dentist'`);
		if (!dentist) throw new Error("no dentist");
		expect(
			await editMoneyIn(db, viewer, {
				incomeId: "refund",
				edit: { amountCents: (dentist.amountCents + 1) as Cents },
				today,
			}),
		).toEqual({ ok: false, reason: "over-purchase" });
		expect(
			(
				await editMoneyIn(db, viewer, {
					incomeId: "refund",
					edit: { amountCents: 2_000 as Cents },
					today,
				})
			).ok,
		).toBe(true);
		expect(
			await editMoneyIn(db, viewer, {
				incomeId: "refund",
				edit: { amountCents: 1_500 as Cents },
				today: "2026-11-03",
			}),
		).toEqual({ ok: false, reason: "month-ended" });
		// Its note is still its own.
		expect(
			(
				await editMoneyIn(db, viewer, {
					incomeId: "refund",
					edit: { note: "Dentist refund" },
					today: "2026-11-03",
				})
			).ok,
		).toBe(true);
	});
});

describe("an Owed back item whose Split is gone", () => {
	beforeEach(async () => {
		await caseyOwes();
		// As an older re-split left it: still naming a Split the purchase no longer has.
		await db.update(owedBack).set({ splitId: "gone" }).where(sql`${owedBack.id} = 'ob-skates'`);
	});
	const skates = async () => (await loadOwedBack(db, viewer, { transactionId: "skates" }))[0];

	it("can be changed where it is", async () => {
		const was = await skates();
		expect(
			await sayOwedBack(db, viewer, {
				owedBackId: "ob-skates",
				transactionId: "skates",
				splitId: "gone",
				who: "Robin",
				amountCents: 1_500 as Cents,
			}),
		).toMatchObject({ ok: true, item: { id: "ob-skates", who: "Robin", owed: 1_500 } });
		expect(
			await sayOwedBack(db, viewer, {
				owedBackId: "ob-skates",
				transactionId: "skates",
				splitId: "gone",
				who: "Robin",
				amountCents: ((was?.purchaseAmount ?? 0) + 1) as Cents,
			}),
		).toEqual({ ok: false, reason: "too-much" });
	});

	it("moves to the whole purchase when a Parent says it there, as the one item it was", async () => {
		expect(
			await sayOwedBack(db, viewer, {
				owedBackId: "ob-new",
				transactionId: "skates",
				who: "Casey",
				amountCents: 2_500 as Cents,
			}),
		).toMatchObject({ ok: true, item: { id: "ob-skates", splitId: null, owed: 2_500 } });
		expect(
			(await db.select().from(owedBack)).filter((row) => row.transactionId === "skates"),
		).toHaveLength(1);
	});
});

describe("a typed Paid back line's amount", () => {
	it("can't go below what it has settled", async () => {
		await caseyOwes();
		await paidBack("zelle", "2026-10-05", 60_000);
		await confirmOffer("zelle");
		expect(
			await editMoneyIn(db, viewer, { incomeId: "zelle", edit: { amountCents: 10_000 as Cents } }),
		).toEqual({ ok: false, reason: "matched" });
		expect(await loadPaidBack(db, householdId, "zelle")).toMatchObject({
			line: { amount: 60_000 },
			unmatched: 0,
		});
		expect(
			(await editMoneyIn(db, viewer, { incomeId: "zelle", edit: { amountCents: 65_000 as Cents } }))
				.ok,
		).toBe(true);
	});
});

describe("Owed back on a purchase with Splits", () => {
	beforeEach(async () => {
		const split = await splitTransaction(db, {
			householdId,
			memberId: parentId,
			transactionId: "dentist",
			amountCents: 8_000 as Cents,
			note: "dentist",
			splits: [
				{
					id: "s1",
					amountCents: 6_000 as Cents,
					assignment: { bucketId: "health" },
					forMemberIds: [],
				},
				{
					id: "s2",
					amountCents: 2_000 as Cents,
					assignment: { bucketId: "hockey" },
					forMemberIds: [],
				},
			],
		});
		expect(split).toMatchObject({ ok: true });
	});
	const say = (owedBackId: string, splitId: string | null, amountCents: number) =>
		sayOwedBack(db, viewer, {
			owedBackId,
			transactionId: "dentist",
			splitId,
			who: "Casey",
			amountCents: amountCents as Cents,
		});
	const owed = async () =>
		(await loadOwedBack(db, viewer, { transactionId: "dentist" })).reduce(
			(sum, item) => sum + item.owed,
			0,
		);

	it("can be said on one Split, up to what the Split came to", async () => {
		expect(await say("ob-s2", "s2", 2_000)).toMatchObject({
			ok: true,
			item: { splitId: "s2", owed: 2_000, purchaseAmount: 2_000, bucketId: "hockey" },
		});
		expect(await say("ob-s2", "s2", 2_001)).toEqual({ ok: false, reason: "too-much" });
	});

	it("is on the whole purchase or on its Splits, never both", async () => {
		expect((await say("ob-whole", null, 8_000)).ok).toBe(true);
		expect(await say("ob-s1", "s1", 6_000)).toEqual({ ok: false, reason: "on-whole" });
		expect(await owed()).toBe(8_000);
	});

	it("is on its Splits and then not on the whole purchase too", async () => {
		expect((await say("ob-s1", "s1", 6_000)).ok).toBe(true);
		expect((await say("ob-s2", "s2", 2_000)).ok).toBe(true);
		expect(await say("ob-whole", null, 8_000)).toEqual({ ok: false, reason: "on-splits" });
		expect(await owed()).toBe(8_000);
	});
});
