import type { DayKey, MonthKey, StatementLine } from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	addAccount,
	changeMoneyInKind,
	createHouseholdForParent,
	type Db,
	decideExtraIncome,
	editMoneyIn,
	householdsAwaitingMoneyInPass,
	importStatement,
	loadMoneyIn,
	loadMoneyInReview,
	runMoneyInPass,
	setTakeHomePay,
} from "./index";
import { householdPasses, income } from "./schema";
import { testDb } from "./test-db";

// The one-time pass of ADR-0057: October 2026's person-to-person money in back to Review, once per
// Household, after a snapshot. The lines are imported, then set as they were before money in had
// a kind (all of it Income, none waiting).

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const month: MonthKey = "2026-10";
const PAY = "ACME CORP PAYROLL 0042";
const ZELLE = "Zelle payment from CASEY LOWE 24816357";
const VENMO = "VENMO CASHOUT 1029";
const CHECK = "MOBILE CHECK DEPOSIT";

let db: Db;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;
const line = (date: DayKey, amount: number, description: string): StatementLine => ({
	date,
	amount,
	description,
	bankId: null,
});

/** Imports the lines the way they stood in October: every one Income, none in Review. */
async function imported(lines: StatementLine[]) {
	await importStatement(db, {
		householdId,
		importId: newId(),
		accountId: "checking",
		source: "csv",
		fileName: null,
		fileKey: null,
		lines,
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: parentId,
		newId,
	});
	await db.update(income).set({ needsReview: false }).where(eq(income.householdId, householdId));
}

const snapshot = vi.fn(async () => "snapshot-1");
const run = (runId = "run-1") => runMoneyInPass(db, householdId, { runId, snapshot });
const waiting = async () => (await loadMoneyInReview(db, householdId)).map((row) => row.date);
const on = async (date: DayKey) => {
	const found = (await loadMoneyIn(db, householdId)).find((row) => row.date === date);
	if (!found) throw new Error(`no money in on ${date}`);
	return found;
};

beforeEach(async () => {
	db = testDb();
	nextId = 0;
	snapshot.mockClear();
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
});

describe("the one-time pass over October 2026's money in", () => {
	it("sends person-to-person money in back to Review, after a snapshot, and deletes nothing", async () => {
		await imported([
			line("2026-09-20", 20_000, ZELLE),
			line("2026-10-01", 600_000, PAY),
			line("2026-10-05", 30_000, ZELLE),
			line("2026-10-07", 4_000, VENMO),
			line("2026-10-09", 12_000, CHECK),
			line("2026-10-11", 9_000, ZELLE),
			line("2026-11-02", 7_000, ZELLE),
		]);
		// One a Parent already said is Between us stays so.
		const between = await on("2026-10-11");
		await changeMoneyInKind(db, viewer, {
			incomeId: between.id,
			kind: "between-us",
			transferId: newId(),
		});
		const before = (await loadMoneyIn(db, householdId)).length;

		expect(await householdsAwaitingMoneyInPass(db)).toEqual([householdId]);
		expect(await run()).toEqual({ ran: true, changed: 2, snapshotId: "snapshot-1" });

		expect(snapshot).toHaveBeenCalledTimes(1);
		expect(await waiting()).toEqual(["2026-10-07", "2026-10-05"]);
		expect((await on("2026-10-11")).kind).toBe("between-us");
		expect((await on("2026-10-01")).needsReview).toBe(false);
		expect((await on("2026-10-09")).needsReview).toBe(false);
		expect((await loadMoneyIn(db, householdId)).length).toBe(before);
		expect(await householdsAwaitingMoneyInPass(db)).toEqual([]);
		expect(await db.select().from(householdPasses)).toMatchObject([
			{
				householdId,
				pass: "money-in-2026-10",
				runId: "run-1",
				snapshotId: "snapshot-1",
				changed: 2,
			},
		]);
	});

	it("sends back what a person sent even when its memo mentions a refund, and leaves a store's refund alone", async () => {
		await imported([
			line("2026-10-03", 8_000, "ZELLE FROM JOHN refund for tickets"),
			line("2026-10-04", 4_210, "AMAZON REFUND 42.10"),
			line("2026-10-06", 5_000, "Zelle payment from CASEY LOWE paying you back"),
			line("2026-10-08", 9_900, "ACH RETURN COMCAST CABLE"),
			line("2026-10-10", 31_000, "GA DOR REFUND"),
		]);

		expect(await run()).toEqual({ ran: true, changed: 2, snapshotId: "snapshot-1" });

		expect(await waiting()).toEqual(["2026-10-06", "2026-10-03"]);
		// Income under the old rules, and the lines already here are not touched.
		expect((await on("2026-10-04")).needsReview).toBe(false);
		expect((await on("2026-10-08")).needsReview).toBe(false);
		expect((await on("2026-10-10")).needsReview).toBe(false);
	});

	it("does nothing the second time, even for a line a Parent has since called Income", async () => {
		await imported([line("2026-10-05", 30_000, ZELLE), line("2026-10-07", 4_000, VENMO)]);
		await run();
		const zelle = await on("2026-10-05");
		await changeMoneyInKind(db, viewer, {
			incomeId: zelle.id,
			kind: "income",
			transferId: newId(),
		});
		// More of October arrives afterwards, already sorted by the Import.
		expect(await waiting()).toEqual(["2026-10-07"]);

		expect(await run("run-2")).toEqual({ ran: false, changed: 0, snapshotId: null });

		expect(snapshot).toHaveBeenCalledTimes(1);
		expect(await waiting()).toEqual(["2026-10-07"]);
		expect((await on("2026-10-05")).needsReview).toBe(false);
		expect(await db.select().from(householdPasses)).toMatchObject([{ runId: "run-1", changed: 2 }]);
	});

	it("leaves a line that fed Extra income already decided", async () => {
		await imported([
			line("2026-10-01", 600_000, PAY),
			line("2026-10-05", 30_000, ZELLE),
			line("2026-10-09", 12_000, CHECK),
		]);
		const decided = await decideExtraIncome(db, {
			householdId,
			moveId: "move-1",
			month,
			amountCents: 40_000,
			to: { kind: "free-to-spend" },
			createdByMemberId: parentId,
		});
		expect(decided.ok).toBe(true);

		expect(await run()).toEqual({ ran: true, changed: 0, snapshotId: "snapshot-1" });

		expect(await waiting()).toEqual([]);
		expect(await on("2026-10-05")).toMatchObject({ kind: "income", needsReview: false });
		// It has run: the line is left for a Parent, not tried again.
		expect(await run("run-2")).toMatchObject({ ran: false });
	});

	it("sends back only what the decided Extra income can spare", async () => {
		await imported([
			line("2026-10-01", 600_000, PAY),
			line("2026-10-05", 30_000, ZELLE),
			line("2026-10-07", 5_000, VENMO),
			line("2026-10-09", 12_000, CHECK),
		]);
		await decideExtraIncome(db, {
			householdId,
			moveId: "move-1",
			month,
			amountCents: 15_000,
			to: { kind: "free-to-spend" },
			createdByMemberId: parentId,
		});

		// $470 extra: without the $300 it is $170, still over the $150 decided; without the $50 too it isn't.
		expect(await run()).toMatchObject({ ran: true, changed: 1 });
		expect(await waiting()).toEqual(["2026-10-05"]);
	});

	it("takes no snapshot when there is nothing to send back, and still runs only once", async () => {
		await imported([line("2026-10-01", 600_000, PAY), line("2026-10-09", 12_000, CHECK)]);
		expect(await run()).toEqual({ ran: true, changed: 0, snapshotId: null });
		expect(snapshot).not.toHaveBeenCalled();
		expect(await householdsAwaitingMoneyInPass(db)).toEqual([]);
	});

	it("writes nothing when the snapshot can't be taken, so it runs another night", async () => {
		await imported([line("2026-10-05", 30_000, ZELLE)]);
		snapshot.mockRejectedValueOnce(new Error("no bucket"));
		await expect(run()).rejects.toThrow("no bucket");
		expect(await waiting()).toEqual([]);
		expect(await householdsAwaitingMoneyInPass(db)).toEqual([householdId]);

		expect(await run("run-2")).toEqual({ ran: true, changed: 1, snapshotId: "snapshot-1" });
		expect(await waiting()).toEqual(["2026-10-05"]);
	});

	it("leaves a line a Parent confirmed as Income before the pass ran", async () => {
		await imported([line("2026-10-05", 30_000, ZELLE), line("2026-10-07", 4_000, VENMO)]);
		const zelle = await on("2026-10-05");
		const confirmed = await changeMoneyInKind(db, viewer, {
			incomeId: zelle.id,
			kind: "income",
			transferId: newId(),
			expectedVersion: zelle.version,
		});
		expect(confirmed).toMatchObject({ ok: true, line: { kind: "income", needsReview: false } });
		// Sent again (the answer was lost): still that one confirmation.
		expect(
			await changeMoneyInKind(db, viewer, {
				incomeId: zelle.id,
				kind: "income",
				transferId: newId(),
				expectedVersion: zelle.version,
			}),
		).toEqual(confirmed);
		// Whose pay said to be the Household's, as it already was, is a decision too.
		const venmo = await on("2026-10-07");
		expect(
			(await editMoneyIn(db, viewer, { incomeId: venmo.id, edit: { whosePay: null } })).ok,
		).toBe(true);
		expect(await run()).toEqual({ ran: true, changed: 0, snapshotId: null });
		expect(await waiting()).toEqual([]);
	});
});
