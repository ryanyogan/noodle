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
	createHouseholdForParent,
	type Db,
	deleteTransaction,
	linkMoneyInRefund,
	loadCharges,
	loadExportData,
	loadIncome,
	loadMoneyInRefund,
	loadPlanRecords,
	loadSpending,
	setTakeHomePay,
	unlinkMoneyInRefund,
} from "./index";
import { bucketLeftSql } from "./moves";
import { setCarriesOver } from "./plan";
import { loadRolledOver } from "./rollover";
import { refundLinks } from "./schema";
import { testDb } from "./test-db";

// A Refund that lands in checking can be linked to its purchase (issue 131, ADR-0057): skates of
// $45 bought in September; $20 comes back into checking in October.

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
	for (const [bucketId, color] of [
		["hockey", 1],
		["health", 2],
	] as const) {
		await addBucket(db, {
			householdId,
			memberId: parentId,
			bucketId,
			name: bucketId,
			color,
			month: september,
			allowanceCents: 40_000,
		});
	}
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
		amountCents: 60_000 as Cents,
		createdByMemberId: parentId,
	});
	for (const [transactionId, bucketId, date, amountCents, note] of [
		["skates", "hockey", "2026-09-14", 4_500, "PURE HOCKEY #12"],
		["dentist", "health", "2026-09-20", 8_000, "Smile Dental"],
		["tape", "hockey", "2026-09-22", 900, "PURE HOCKEY #12"],
		["old-skates", "hockey", "2026-06-01", 9_000, "PURE HOCKEY #12"],
	] as const) {
		await addQuickAdd(db, {
			householdId,
			transactionId,
			bucketId,
			date,
			amountCents: amountCents as Cents,
			note,
			forMemberIds: ["leo"],
			createdByMemberId: parentId,
		});
	}
});

/** Money in that a Parent said is a Refund. */
async function refund(incomeId: string, date: DayKey, amountCents: number, note = "PURE HOCKEY") {
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
		kind: "refund",
		transferId: `${incomeId}-transfer`,
	});
	expect(changed.ok).toBe(true);
}

const link = (incomeId: string, transactionId: string, asOf: DayKey = today) =>
	linkMoneyInRefund(db, viewer, { incomeId, transactionId, today: asOf });

const bucketSpent = async (month: MonthKey) =>
	(await loadSpending(db, viewer, month))
		.map((spend) => [spend.bucketId, spend.amount, spend.for] as const)
		.sort();

const charged = async (month: MonthKey) =>
	(await loadCharges(db, viewer, month)).map((charge) => [charge.commitmentId, charge.amount]);

describe("a Refund lands in checking in October", () => {
	beforeEach(() => refund("back", "2026-10-05", 2_000));

	it("is offered the purchases it is likely for: same wording first, enough, in the 90 days before", async () => {
		const offered = await loadMoneyInRefund(db, viewer, "back", today);
		expect(offered?.link).toBeNull();
		// The tape cost less than came back, and June's skates are more than 90 days before.
		expect(offered?.likely.map((purchase) => purchase.id)).toEqual([
			"skates",
			"dentist",
			"tuition-sep",
		]);
		expect(offered?.likely[0]).toEqual({
			id: "skates",
			date: "2026-09-14",
			amount: 4_500,
			note: "PURE HOCKEY #12",
		});
	});

	it("offers nothing for money in that isn't a Refund", async () => {
		await addIncome(db, {
			householdId,
			incomeId: "pay",
			date: "2026-10-02",
			amountCents: 2_000 as Cents,
			note: "PAYROLL",
			createdByMemberId: parentId,
		});
		expect(await loadMoneyInRefund(db, viewer, "pay", today)).toBeNull();
		expect(await link("pay", "skates")).toEqual({ ok: false, reason: "not-refund" });
	});

	it("gives the purchase's Bucket the money back in the month it landed, and never as Income", async () => {
		const before = await bucketSpent(september);
		expect(await link("back", "skates")).toEqual({ ok: true, months: [october] });
		expect(await bucketSpent(october)).toEqual([["hockey", -2_000, ["leo"]]]);
		expect(await bucketSpent(september)).toEqual(before);
		expect(await loadIncome(db, householdId, october, "2026-11")).toEqual([]);
		const offered = await loadMoneyInRefund(db, viewer, "back", today);
		expect(offered?.link).toEqual({
			purchase: { id: "skates", date: "2026-09-14", amount: 4_500, note: "PURE HOCKEY #12" },
			countsOn: "2026-10-05",
			ended: false,
		});
	});

	it("shows in what's left of the Bucket and in what it carries over", async () => {
		await setCarriesOver(db, {
			householdId,
			memberId: parentId,
			bucketId: "hockey",
			month: september,
			rolling: true,
		});
		await link("back", "skates");
		const [row] = await db.all(
			sql`select ${bucketLeftSql(householdId, "hockey", october)} as left`,
		);
		expect((row as unknown as [number])[0]).toBe(42_000);
		const records = await loadPlanRecords(db, householdId, "2026-11");
		// September left $346 ($400 less skates and tape); October's $400 and the $20 back.
		expect(await loadRolledOver(db, householdId, records, "2026-11")).toEqual({ hockey: 76_600 });
	});

	it("gives a Commitment the money back, and not as a payment of it", async () => {
		expect(await link("back", "tuition-sep")).toEqual({ ok: true, months: [october] });
		expect(await charged(october)).toEqual([["tuition", -2_000]]);
		expect((await loadCharges(db, viewer, october)).map((charge) => charge.paidBack)).toEqual([
			true,
		]);
	});

	it("restores once only: saying it again changes nothing, and another purchase is refused", async () => {
		await link("back", "skates");
		expect(await link("back", "skates")).toEqual({ ok: true, months: [october] });
		expect(await link("back", "dentist")).toEqual({ ok: false, reason: "already-linked" });
		expect(await bucketSpent(october)).toEqual([["hockey", -2_000, ["leo"]]]);
	});

	it("refuses a purchase that cost less, came after, or is too long ago", async () => {
		expect(await link("back", "tape")).toEqual({ ok: false, reason: "refused" });
		expect(await link("back", "old-skates")).toEqual({ ok: false, reason: "refused" });
		await addQuickAdd(db, {
			householdId,
			transactionId: "later",
			bucketId: "hockey",
			date: "2026-10-06",
			amountCents: 5_000 as Cents,
			note: "PURE HOCKEY #12",
			forMemberIds: [],
			createdByMemberId: parentId,
		});
		expect(await link("back", "later")).toEqual({ ok: false, reason: "refused" });
		expect(await db.select().from(refundLinks)).toEqual([]);
	});

	it("never gives a purchase back more than it cost", async () => {
		await refund("more", "2026-10-06", 3_000);
		await link("back", "skates");
		expect(await link("more", "skates")).toEqual({ ok: false, reason: "refused" });
	});

	it("can be taken off, and the Bucket loses the money again", async () => {
		await link("back", "skates");
		expect(await unlinkMoneyInRefund(db, viewer, { incomeId: "back", today })).toEqual({
			ok: true,
			months: [october],
		});
		expect(await bucketSpent(october)).toEqual([]);
		expect((await loadMoneyInRefund(db, viewer, "back", today))?.likely[0]?.id).toBe("skates");
	});

	it("drops the link when a Parent says it isn't a Refund after all", async () => {
		await link("back", "skates");
		const changed = await changeMoneyInKind(db, viewer, {
			incomeId: "back",
			kind: "income",
			transferId: "unused",
			today,
		});
		expect(changed.ok).toBe(true);
		expect(await db.select().from(refundLinks)).toEqual([]);
		expect(await bucketSpent(october)).toEqual([]);
	});

	it("drops the link when the purchase is deleted", async () => {
		await link("back", "skates");
		const deleted = await deleteTransaction(db, {
			householdId,
			memberId: parentId,
			transactionId: "skates",
			today,
		});
		expect(deleted.ok).toBe(true);
		expect(await db.select().from(refundLinks)).toEqual([]);
		expect((await loadMoneyInRefund(db, viewer, "back", today))?.link).toBeNull();
	});

	it("is in Download your data", async () => {
		await link("back", "skates");
		const data = await loadExportData(db, viewer, today, 0);
		expect(data.refundLinks).toEqual([
			{ incomeId: "back", transactionId: "skates", amountCents: 2_000, countsOn: "2026-10-05" },
		]);
	});
});

describe("months that have ended", () => {
	it("counts in the running month when the month the money landed in has ended", async () => {
		await refund("late", "2026-09-28", 2_000);
		const before = await bucketSpent(september);
		expect(await link("late", "skates")).toEqual({ ok: true, months: [october] });
		expect(await bucketSpent(september)).toEqual(before);
		expect(await bucketSpent(october)).toEqual([["hockey", -2_000, ["leo"]]]);
	});

	it("can't be taken off once the month it counted in has ended", async () => {
		await refund("back", "2026-10-05", 2_000);
		await link("back", "skates");
		const later: DayKey = "2026-11-02";
		expect(await unlinkMoneyInRefund(db, viewer, { incomeId: "back", today: later })).toEqual({
			ok: false,
			reason: "month-ended",
		});
		expect((await loadMoneyInRefund(db, viewer, "back", later))?.link?.ended).toBe(true);
		expect(await bucketSpent(october)).toEqual([["hockey", -2_000, ["leo"]]]);
	});
});
