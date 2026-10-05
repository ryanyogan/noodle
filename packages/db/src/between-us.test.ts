import type { DayKey, MonthKey, StatementLine } from "@noodle/domain";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { extraIncomeLeftSql } from "./extra-income";
import { clearHouseholdRows } from "./fresh-start";
import {
	addAccount,
	createHouseholdForParent,
	type Db,
	decideExtraIncome,
	importStatement,
	loadBetweenUsIncome,
	loadIncome,
	loadIncomeCells,
	loadSpending,
	loadTransactionsPage,
	loadTransfer,
	markIncomeTransfer,
	markTransfer,
	removeIncome,
	setTakeHomePay,
	unmarkTransfer,
} from "./index";
import { members } from "./schema";
import {
	exportHouseholdRows,
	restoreHouseholdRows,
	SNAPSHOT_FORMAT,
	type SnapshotFile,
} from "./snapshots";
import { testDb } from "./test-db";

// Money between the two Parents (issue 92, ADR-0052): only one Parent's checking is in Noodle, so
// one side of each move is all there is. Statements go in through importStatement, as an upload
// does, and what counts is read back through the reads the app makes.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const sam = { householdId, memberId: "sam" };
const month: MonthKey = "2026-09";
const ZELLE_IN = "Zelle payment from SAM RINK 24816357";
const ZELLE_OUT = "Zelle payment to SAM RINK 99120044";

let db: Db;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;

const line = (date: DayKey, amount: number, description: string): StatementLine => ({
	date,
	amount,
	description,
	bankId: null,
});

const importInto = (accountId: string, importId: string, lines: StatementLine[]) =>
	importStatement(db, {
		householdId,
		importId,
		accountId,
		source: "csv",
		fileName: null,
		fileKey: null,
		lines,
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: parentId,
		newId,
	});

const received = () => loadIncome(db, householdId, month, "2026-10");
const incomeId = async (note: string) => (await received()).find((i) => i.note === note)?.id ?? "";
const extraLeft = async () =>
	(await db.values<[number]>(sql`select ${extraIncomeLeftSql(householdId, month)}`))[0]?.[0];
const reported = async () =>
	(
		await loadIncomeCells(db, householdId, { from: "2026-09-01", until: "2026-10-01" }, "all")
	).reduce((sum, cell) => sum + cell.amount, 0);
const listed = async () =>
	new Map(
		(await loadTransactionsPage(db, viewer, { month, limit: 50 })).transactions.map((row) => [
			row.note,
			row,
		]),
	);

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
	await db.insert(members).values({
		id: "sam",
		householdId,
		kind: "parent",
		name: "Sam",
		clerkUserId: "clerk-sam",
	});
	await setTakeHomePay(db, { householdId, memberId: parentId, month, amountCents: 600_000 });
	for (const [accountId, name, kind] of [
		["checking", "Checking", "checking"],
		["savings", "Savings", "savings"],
	] as const) {
		await addAccount(db, {
			householdId,
			accountId,
			name,
			kind,
			balanceCents: 0,
			balanceId: `${accountId}-balance`,
			createdByMemberId: parentId,
		});
	}
	await importInto("checking", "i-1", [
		line("2026-09-01", 600_000, "ACME PAYROLL"),
		line("2026-09-05", 150_000, ZELLE_IN),
		line("2026-09-12", -20_000, ZELLE_OUT),
	]);
});

describe("money in from the other Parent", () => {
	it("counts as Income and Extra income until a Parent says it's between them", async () => {
		expect((await received()).map((i) => i.note)).toEqual(["ACME PAYROLL", ZELLE_IN]);
		expect(await extraLeft()).toBe(150_000);
		expect(await reported()).toBe(750_000);
		expect(await loadBetweenUsIncome(db, householdId, month, "2026-10")).toEqual([]);
	});

	it("once marked is not Income, Extra income or a Report's income, and is listed as between us", async () => {
		const id = await incomeId(ZELLE_IN);
		expect(await markIncomeTransfer(db, viewer, { transferId: "t-1", incomeId: id })).toEqual({
			ok: true,
			months: [month],
		});
		// What This Month, Plan › Income ("Lower take-home pay to"), the Year view, the Check-in
		// and the Plan draft are all given.
		expect((await received()).map((i) => i.note)).toEqual(["ACME PAYROLL"]);
		expect(await extraLeft()).toBe(0);
		expect(await reported()).toBe(600_000);
		expect(await loadBetweenUsIncome(db, householdId, month, "2026-10")).toEqual([
			{ id, amount: 150_000, date: "2026-09-05", note: ZELLE_IN, transferId: "t-1" },
		]);
		// Nothing was spent by it either.
		expect(await loadSpending(db, viewer, month)).toEqual([]);
	});

	it("is marked once: the same mark again changes nothing, another is refused", async () => {
		const id = await incomeId(ZELLE_IN);
		await markIncomeTransfer(db, viewer, { transferId: "t-1", incomeId: id });
		expect(await markIncomeTransfer(db, viewer, { transferId: "t-1", incomeId: id })).toEqual({
			ok: true,
			months: [month],
		});
		expect(await markIncomeTransfer(db, sam, { transferId: "t-2", incomeId: id })).toEqual({
			ok: false,
			reason: "refused",
		});
		expect(await loadBetweenUsIncome(db, householdId, month, "2026-10")).toHaveLength(1);
	});

	it("counts again once either Parent undoes it, and can be marked again", async () => {
		const id = await incomeId(ZELLE_IN);
		await markIncomeTransfer(db, viewer, { transferId: "t-1", incomeId: id });
		expect(await unmarkTransfer(db, sam, "t-1")).toEqual({ ok: true, months: [month] });
		expect((await received()).map((i) => i.note)).toEqual(["ACME PAYROLL", ZELLE_IN]);
		expect(await extraLeft()).toBe(150_000);
		expect(await reported()).toBe(750_000);
		expect(await loadBetweenUsIncome(db, householdId, month, "2026-10")).toEqual([]);
		expect(await markIncomeTransfer(db, viewer, { transferId: "t-2", incomeId: id })).toMatchObject(
			{ ok: true },
		);
		expect(await extraLeft()).toBe(0);
	});

	it("is refused while Extra income from it has already gone somewhere, as removing it is", async () => {
		const id = await incomeId(ZELLE_IN);
		expect(
			await decideExtraIncome(db, {
				householdId,
				moveId: "move-1",
				month,
				to: { kind: "free-to-spend" },
				amountCents: 100_000,
				createdByMemberId: parentId,
			}),
		).toEqual({ ok: true });
		expect(await markIncomeTransfer(db, viewer, { transferId: "t-1", incomeId: id })).toEqual({
			ok: false,
			reason: "extra-income",
		});
		expect(await removeIncome(db, { householdId, incomeId: id, month })).toEqual({
			ok: false,
			reason: "refused",
		});
		expect((await received()).map((i) => i.note)).toEqual(["ACME PAYROLL", ZELLE_IN]);
		expect(await extraLeft()).toBe(50_000);
	});

	it("is the Household's own to mark: another Household's Parent is refused", async () => {
		const id = await incomeId(ZELLE_IN);
		expect(
			await markIncomeTransfer(
				db,
				{ householdId: "elsewhere", memberId: "nobody" },
				{ transferId: "t-1", incomeId: id },
			),
		).toEqual({ ok: false, reason: "refused" });
		expect(await extraLeft()).toBe(150_000);
	});

	it("that already paired with money out of another Account is a Transfer, not marked twice", async () => {
		await importInto("savings", "i-2", [line("2026-09-20", -30_000, "TRANSFER TO CHECKING")]);
		await importInto("checking", "i-3", [line("2026-09-20", 30_000, "TRANSFER FROM SAVINGS")]);
		// Paired on Import, so it was never Income.
		expect((await received()).map((i) => i.note)).not.toContain("TRANSFER FROM SAVINGS");
		const out = await loadTransfer(
			db,
			viewer,
			(await listed()).get("TRANSFER TO CHECKING")?.id ?? "",
		);
		expect(out).toMatchObject({ kind: "transfer", from: "Savings", to: "Checking", reason: null });
		const peer = out.kind === "transfer" ? (out.peer?.id ?? "") : "";
		expect(await markIncomeTransfer(db, viewer, { transferId: "t-9", incomeId: peer })).toEqual({
			ok: false,
			reason: "refused",
		});
	});
});

describe("money out to the other Parent", () => {
	it("marked as between us is no spending, and says so where it's listed", async () => {
		const id = (await listed()).get(ZELLE_OUT)?.id ?? "";
		expect(
			await markTransfer(db, viewer, {
				transferId: "t-1",
				transactionId: id,
				reason: "between-us",
			}),
		).toEqual({ ok: true, months: [month] });
		expect(await loadTransfer(db, viewer, id)).toMatchObject({
			kind: "transfer",
			from: "Checking",
			to: null,
			peer: null,
			reason: "between-us",
		});
		expect((await listed()).get(ZELLE_OUT)?.transfer).toEqual({
			from: "Checking",
			to: null,
			reason: "between-us",
		});
		expect(await loadSpending(db, viewer, month)).toEqual([]);
		// It never touches Income.
		expect(await reported()).toBe(750_000);
		expect(await unmarkTransfer(db, viewer, "t-1")).toEqual({ ok: true, months: [month] });
		expect((await listed()).get(ZELLE_OUT)?.transfer).toBeNull();
	});

	it("marked as between us while its other side is in Noodle pairs, and says it paired", async () => {
		await importInto("savings", "i-2", [line("2026-09-20", -30_000, "TRANSFER TO CHECKING")]);
		await importInto("checking", "i-3", [line("2026-09-20", 30_000, "TRANSFER FROM SAVINGS")]);
		const id = (await listed()).get("TRANSFER TO CHECKING")?.id ?? "";
		const found = await loadTransfer(db, viewer, id);
		// A Parent unmarks the pair Noodle found, then says the money out was between the two.
		await unmarkTransfer(db, viewer, found.kind === "transfer" ? found.transferId : "");
		expect(
			await markTransfer(db, viewer, {
				transferId: "t-1",
				transactionId: id,
				reason: "between-us",
			}),
		).toEqual({ ok: true, months: [month], paired: true });
		expect(await loadTransfer(db, viewer, id)).toMatchObject({
			kind: "transfer",
			from: "Savings",
			to: "Checking",
			reason: null,
		});
	});

	it("marked as a plain Transfer keeps no reason", async () => {
		const id = (await listed()).get(ZELLE_OUT)?.id ?? "";
		await markTransfer(db, viewer, { transferId: "t-1", transactionId: id });
		expect(await loadTransfer(db, viewer, id)).toMatchObject({ kind: "transfer", reason: null });
		expect((await listed()).get(ZELLE_OUT)?.transfer).toEqual({
			from: "Checking",
			to: null,
			reason: null,
		});
	});
});

describe("a snapshot with money between the Parents in it", () => {
	const fileOf = (migration: string, tables: SnapshotFile["tables"]): SnapshotFile => ({
		format: SNAPSHOT_FORMAT,
		householdId,
		takenAt: "2026-09-30T18:00:00.000Z",
		migration,
		tables,
	});

	it("comes back with it still between them", async () => {
		await markIncomeTransfer(db, viewer, { transferId: "t-1", incomeId: await incomeId(ZELLE_IN) });
		const before = await exportHouseholdRows(db, householdId);
		expect(before.tables.transfers).toHaveLength(1);
		await clearHouseholdRows(db, householdId, "fresh-start");
		await restoreHouseholdRows(db, householdId, fileOf("0055_transfer_reason", before.tables));
		expect((await exportHouseholdRows(db, householdId)).tables.transfers).toEqual(
			before.tables.transfers,
		);
		expect(await loadBetweenUsIncome(db, householdId, month, "2026-10")).toHaveLength(1);
		expect(await extraLeft()).toBe(0);
	});

	it("taken before the reason existed restores, with its Transfers plain", async () => {
		const id = (await listed()).get(ZELLE_OUT)?.id ?? "";
		await markTransfer(db, viewer, { transferId: "t-1", transactionId: id });
		const before = await exportHouseholdRows(db, householdId);
		const older = {
			...before.tables,
			transfers: (before.tables.transfers ?? []).map((row) => {
				const { reason: _reason, otherAccountId: _other, ...rest } = row as Record<string, unknown>;
				return rest;
			}),
		} as SnapshotFile["tables"];
		await clearHouseholdRows(db, householdId, "fresh-start");
		await restoreHouseholdRows(db, householdId, fileOf("0054_commitment_account", older));
		expect(await loadTransfer(db, viewer, id)).toMatchObject({ kind: "transfer", reason: null });
	});
});
