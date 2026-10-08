import {
	addAccount,
	addBucket,
	addQuickAdd,
	changeMoneyInKind,
	createHouseholdForParent,
	type Db,
	importStatement,
	linkMoneyInRefund,
	loadIncome,
	loadMoneyIn,
	loadMoneyInSummary,
	setTakeHomePay,
} from "@noodle/db";
import { testDb } from "@noodle/db/test-db";
import type { Cents, DayKey, MoneyInKind, StatementLine } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";

// "Money in" on the Transactions summary and "received" on This Month are two different figures
// (issue 131, ADR-0057), and this says exactly how. "received" is Income only: it is what is set
// against Take-home pay. "Money in" is everything that came in from outside: Income, and Refunds
// and Paid back too, linked or matched or not (those give a purchase its money back, or count
// nowhere; never as Income). Neither holds a Transfer, Between us, or a line waiting in Review.
// So Money in = received + Refunds + Paid back, and the summary says how much of it is Income.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const month = "2026-09";

let db: Db;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;

const line = (date: DayKey, amount: number, description: string): StatementLine => ({
	date,
	amount,
	description,
	bankId: null,
});

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
	await setTakeHomePay(db, { householdId, memberId: parentId, month, amountCents: 600_000 });
	await addAccount(db, {
		householdId,
		accountId: "checking",
		name: "Checking",
		kind: "checking",
		balanceCents: 0,
		balanceId: "checking-balance",
		createdByMemberId: parentId,
	});
	await addBucket(db, {
		householdId,
		memberId: parentId,
		bucketId: "hockey",
		name: "Hockey",
		color: 1,
		month,
		allowanceCents: 40_000,
	});
	await addQuickAdd(db, {
		householdId,
		transactionId: "skates",
		bucketId: "hockey",
		date: "2026-09-02",
		amountCents: 4_500 as Cents,
		note: "PURE HOCKEY #12",
		forMemberIds: [],
		createdByMemberId: parentId,
	});
});

describe("a month holding every kind of money in", () => {
	it("has Money in = received + Refunds + Paid back, and nothing of what moves within or waits", async () => {
		await importStatement(db, {
			householdId,
			importId: "import-1",
			accountId: "checking",
			source: "csv",
			fileName: null,
			fileKey: null,
			lines: [
				line("2026-09-01", 600_000, "ACME CORP PAYROLL 0042"),
				line("2026-09-09", 12_000, "MOBILE CHECK DEPOSIT"),
				// Person to person: waits in Review until a Parent says what it is.
				line("2026-09-05", 30_000, "Zelle payment from CASEY LOWE 24816357"),
				line("2026-09-10", 2_000, "PURE HOCKEY RETURN"),
				line("2026-09-11", 1_500, "SHOE BARN RETURN"),
				line("2026-09-12", 4_000, "DEPOSIT BRANCH 0007"),
				line("2026-09-13", 50_000, "ONLINE MOVE FROM SAVINGS"),
				line("2026-09-14", 7_000, "DEPOSIT BRANCH 0009"),
			],
			closingBalance: null,
			csvMapping: null,
			createdByMemberId: parentId,
			newId,
		});
		const all = () => loadMoneyIn(db, householdId, { from: "2026-09-01", until: "2026-10-01" });
		const say = async (note: string, kind: MoneyInKind) => {
			const found = (await all()).find((row) => row.note === note);
			if (!found) throw new Error(`no money in: ${note}`);
			const changed = await changeMoneyInKind(db, viewer, {
				incomeId: found.id,
				kind,
				transferId: newId(),
			});
			expect(changed.ok).toBe(true);
			return found.id;
		};
		const linked = await say("PURE HOCKEY RETURN", "refund");
		await say("SHOE BARN RETURN", "refund");
		await say("DEPOSIT BRANCH 0007", "paid-back");
		await say("ONLINE MOVE FROM SAVINGS", "transfer");
		await say("DEPOSIT BRANCH 0009", "between-us");
		expect(
			await linkMoneyInRefund(db, viewer, {
				incomeId: linked,
				transactionId: "skates",
				today: "2026-09-20",
			}),
		).toMatchObject({ ok: true });

		// The Transactions page's own read of the month (`loadTransactionsPage` gives its figures).
		const summary = await loadMoneyInSummary(db, householdId, {
			from: "2026-09-01",
			until: "2026-10-01",
		});
		const received = (await loadIncome(db, householdId, month, "2026-10")).reduce(
			(sum, row) => sum + row.amount,
			0,
		);
		// This Month: pay and the check. The Zelle waits; the rest isn't Income.
		expect(received).toBe(612_000);
		// Transactions: that, the two Refunds (linked or not) and the Paid back.
		expect(summary.inCents).toBe(612_000 + 2_000 + 1_500 + 4_000);
		expect(summary.waiting).toBe(1);
		// The part of Money in the summary names as Income is This Month's "received".
		expect(summary.incomeCents).toBe(received);
	});
});
