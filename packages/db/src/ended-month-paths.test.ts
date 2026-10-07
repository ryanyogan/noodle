import type { Cents, DayKey, MonthKey } from "@noodle/domain";
import { inArray, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addCommitment,
	addIncome,
	addQuickAdd,
	applyRule,
	changeMoneyInKind,
	createHouseholdForParent,
	type Db,
	fileCardPayment,
	fileTransactions,
	linkMoneyInRefund,
	loadRestoreMonths,
	loadSpending,
	markTransfer,
	returnToReview,
	saveRule,
	setTakeHomePay,
	unfileTransactions,
} from "./index";
import { transactions, transfers } from "./schema";
import { testDb } from "./test-db";

// "Ended months don't change" on every path that refiles a purchase or stops it counting (issue
// 141, ADR-0058): skates of $45 bought in September, $20 of it refunded in October. Once October
// has ended, the skates stay in Hockey at $45 whatever a Parent presses; the tape, bought the same
// week with no money back, moves as before.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const september: MonthKey = "2026-09";
const today: DayKey = "2026-10-06";
const later: DayKey = "2026-11-02";

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
	for (const [transactionId, date, amountCents] of [
		["skates", "2026-09-14", 4_500],
		["tape", "2026-09-22", 900],
	] as const) {
		await addQuickAdd(db, {
			householdId,
			transactionId,
			bucketId: "hockey",
			date,
			amountCents: amountCents as Cents,
			note: "PURE HOCKEY #12",
			forMemberIds: [],
			createdByMemberId: parentId,
		});
	}
	await addIncome(db, {
		householdId,
		incomeId: "back",
		date: "2026-10-05",
		amountCents: 2_000 as Cents,
		note: "PURE HOCKEY",
		createdByMemberId: parentId,
	});
	await changeMoneyInKind(db, viewer, { incomeId: "back", kind: "refund", transferId: "back-t" });
	expect(
		await linkMoneyInRefund(db, viewer, { incomeId: "back", transactionId: "skates", today }),
	).toMatchObject({ ok: true });
});

const filedIn = async () =>
	Object.fromEntries(
		(
			await db
				.select({ id: transactions.id, bucketId: transactions.bucketId })
				.from(transactions)
				.where(inArray(transactions.id, ["skates", "tape"]))
		).map((row) => [row.id, row.bucketId]),
	);

const file = (asOf: DayKey) =>
	fileTransactions(db, viewer, {
		selection: { ids: ["skates", "tape"] },
		month: september,
		assignment: { bucketId: "health" },
		today: asOf,
	});

describe("a purchase whose money back counted in a month that has ended", () => {
	it("is left out of File in…, which says how many stayed", async () => {
		const before = await loadSpending(db, viewer, "2026-10");
		const result = await file(later);
		expect(result).toMatchObject({ ok: true, filed: 1 });
		expect(result.ok && result.skipped.monthEnded).toBe(1);
		expect(await filedIn()).toEqual({ skates: "hockey", tape: "health" });
		expect(await loadSpending(db, viewer, "2026-10")).toEqual(before);
	});

	it("is filed like any other while that month is still running", async () => {
		const result = await file(today);
		expect(result).toMatchObject({ ok: true, filed: 2 });
		expect(result.ok && result.skipped.monthEnded).toBe(0);
	});

	it("stays where a filing put it when the Undo comes after the month ended", async () => {
		const filed = await file(today);
		if (!filed.ok) throw new Error("not filed");
		expect(await unfileTransactions(db, viewer, filed.undo, { today: later })).toEqual({
			restored: 1,
			kept: 1,
		});
		expect(await filedIn()).toEqual({ skates: "health", tape: "hockey" });
	});

	it("can't be put back in Review", async () => {
		expect(
			await returnToReview(db, viewer, {
				transactionId: "skates",
				merchant: "pure hockey",
				guess: null,
				forMemberIds: [],
				today: later,
			}),
		).toEqual({ ok: false, reason: "month-ended" });
		expect(await filedIn()).toEqual({ skates: "hockey", tape: "hockey" });
		expect(
			await returnToReview(db, viewer, {
				transactionId: "tape",
				merchant: "pure hockey",
				guess: null,
				forMemberIds: [],
				today: later,
			}),
		).toMatchObject({ ok: true });
		expect(await filedIn()).toEqual({ skates: "hockey", tape: null });
	});

	it("isn't filed by a Rule applied to what's unassigned, which says how many stayed", async () => {
		await db
			.update(transactions)
			.set({ bucketId: null })
			.where(inArray(transactions.id, ["skates", "tape"]));
		const saved = await saveRule(db, {
			id: "rule",
			householdId,
			memberId: parentId,
			pattern: "PURE HOCKEY #12",
			bucketId: "health",
		});
		expect(saved.ok).toBe(true);
		expect(await applyRule(db, viewer, "rule", { today: later })).toMatchObject({
			filed: 1,
			kept: 1,
		});
		expect(await filedIn()).toEqual({ skates: null, tape: "health" });
	});

	it("can't be marked as a Transfer, which would stop it counting", async () => {
		await db
			.update(transactions)
			.set({ bucketId: null, source: "import" })
			.where(inArray(transactions.id, ["skates", "tape"]));
		expect(
			await markTransfer(db, viewer, {
				transferId: "t-skates",
				transactionId: "skates",
				today: later,
			}),
		).toEqual({ ok: false, reason: "month-ended" });
		expect(
			await markTransfer(db, viewer, { transferId: "t-tape", transactionId: "tape", today: later }),
		).toMatchObject({ ok: true });
		expect(
			(
				await db
					.select({ id: transfers.id })
					.from(transfers)
					.where(inArray(transfers.id, ["t-skates", "t-tape"]))
			).map((row) => row.id),
		).toEqual(["t-tape"]);
	});

	it("is not filed by “It’s a card payment”, which says why, and is while that month is running", async () => {
		await addCommitment(db, {
			householdId,
			memberId: parentId,
			commitmentId: "visa-bill",
			name: "Visa",
			month: september,
			amountCents: 10_000 as Cents,
			cadence: "monthly",
			dueDate: "2026-09-20",
		});
		const answer = (asOf: DayKey) =>
			fileCardPayment(db, viewer, {
				transactionId: "skates",
				commitmentId: "visa-bill",
				ruleId: "card-rule",
				today: asOf,
			});
		expect(await answer(later)).toEqual({ ok: false, reason: "month-ended" });
		expect(await filedIn()).toEqual({ skates: "hockey", tape: "hockey" });
		expect(await answer(today)).toMatchObject({ ok: true, filed: 1 });
	});
});

describe("the months money back counted in, for the sentence on a line the bank took back", () => {
	it("are the months of the Refunds linked to a purchase, which can be later than its own", async () => {
		// Skates were bought in September; the Refund counted in October.
		expect(await loadRestoreMonths(db, viewer, { transactionId: "skates" })).toEqual(["2026-10"]);
		expect(await loadRestoreMonths(db, viewer, { incomeId: "back" })).toEqual(["2026-10"]);
	});

	it("are each month once, oldest first, with what was Paid back on it too", async () => {
		await db.run(
			sql`insert into owed_back (id, household_id, transaction_id, who, amount_cents)
				values ('owed', 'household', 'skates', 'Sam', 1500)`,
		);
		for (const [id, countsOn] of [
			["m-1", "2026-11-02"],
			["m-2", "2026-10-20"],
			["m-3", "2026-11-28"],
		]) {
			await db.run(
				sql`insert into paid_back_matches (id, household_id, income_id, owed_back_id, amount_cents, counts_on)
					values (${id}, 'household', 'back', 'owed', 500, ${countsOn})`,
			);
		}
		expect(await loadRestoreMonths(db, viewer, { transactionId: "skates" })).toEqual([
			"2026-10",
			"2026-11",
		]);
	});

	it("are none for a purchase with no money back, or for another Household", async () => {
		expect(await loadRestoreMonths(db, viewer, { transactionId: "tape" })).toEqual([]);
		expect(
			await loadRestoreMonths(
				db,
				{ householdId: "other", memberId: "someone" },
				{ transactionId: "skates" },
			),
		).toEqual([]);
	});
});
