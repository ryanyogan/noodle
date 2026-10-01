import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	type CsvMapping,
	guessCsvMapping,
	type MonthKey,
	parseCsv,
	readStatement,
	type StatementLine,
} from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBucket,
	addPersonalAllowance,
	createHouseholdForParent,
	type Db,
	importStatement,
	loadCsvMapping,
	loadImports,
	loadIncome,
	loadSpending,
	loadTransactionsPage,
	setTakeHomePay,
	splitTransaction,
} from "./index";
import { members, transactions } from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const month: MonthKey = "2026-09";

const fixture = (name: string) =>
	readFileSync(
		join(import.meta.dirname, "..", "..", "domain", "fixtures", "statements", name),
		"utf8",
	);

let db: Db;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;

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
	await setTakeHomePay(db, { householdId, memberId: parentId, month, amountCents: 600_000 });
	await addBucket(db, {
		householdId,
		memberId: parentId,
		bucketId: "groceries",
		name: "Groceries",
		color: 1,
		month,
		allowanceCents: 80_000,
	});
	for (const [accountId, kind] of [
		["checking", "checking"],
		["card", "credit-card"],
	] as const) {
		await addAccount(db, {
			householdId,
			accountId,
			name: accountId === "checking" ? "Everyday Checking" : "Visa",
			kind,
			balanceCents: 100_000,
			balanceId: `${accountId}-balance`,
			createdByMemberId: parentId,
		});
	}
});

function importLines(
	importId: string,
	lines: StatementLine[],
	options: { accountId?: string; csvMapping?: CsvMapping; household?: string } = {},
) {
	return importStatement(db, {
		householdId: options.household ?? householdId,
		importId,
		accountId: options.accountId ?? "checking",
		source: "csv",
		fileName: `${importId}.csv`,
		fileKey: `statements/${importId}`,
		lines,
		closingBalance: null,
		csvMapping: options.csvMapping ?? null,
		createdByMemberId: parentId,
		newId,
	});
}

const checkingCsv = () => {
	const rows = parseCsv(fixture("checking.csv"));
	const mapping = guessCsvMapping(rows);
	return { mapping, lines: readStatement(fixture("checking.csv"), mapping).statement.lines };
};

const allTransactions = () =>
	db.select().from(transactions).where(eq(transactions.householdId, householdId));

describe("importStatement", () => {
	it("brings money out in as unassigned Transactions and deposits in as income", async () => {
		const { lines, mapping } = checkingCsv();
		const result = await importLines("import-1", lines, { csvMapping: mapping });
		expect(result).toMatchObject({
			ok: true,
			import: {
				id: "import-1",
				source: "csv",
				fileName: "import-1.csv",
				transactionCount: 5,
				incomeCount: 1,
				duplicateCount: 0,
				firstDate: "2026-09-02",
				lastDate: "2026-09-10",
				closingBalance: null,
			},
			months: ["2026-09"],
		});
		const rows = await allTransactions();
		expect(rows).toHaveLength(5);
		expect(rows.every((row) => row.source === "import" && row.bucketId === null)).toBe(true);
		expect(rows.every((row) => row.accountId === "checking" && row.importId === "import-1")).toBe(
			true,
		);
		expect(rows.map((row) => row.amountCents).sort((a, b) => a - b)).toEqual([
			450, 450, 6000, 8412, 14237,
		]);
		expect(await loadIncome(db, householdId, month, "2026-10")).toEqual([
			expect.objectContaining({ amount: 320000, date: "2026-09-05", note: "ACME CORP PAYROLL" }),
		]);
	});

	it("adds nothing twice when the same statement comes in again", async () => {
		const { lines } = checkingCsv();
		await importLines("import-1", lines);
		const again = await importLines("import-2", lines);
		expect(again).toMatchObject({
			ok: true,
			import: { transactionCount: 0, incomeCount: 0, duplicateCount: 6 },
		});
		expect(await allTransactions()).toHaveLength(5);
		expect(await loadIncome(db, householdId, month, "2026-10")).toHaveLength(1);
		expect((await loadImports(db, householdId, "checking")).map((i) => i.id)).toEqual([
			"import-2",
			"import-1",
		]);
	});

	it("adds only the new lines of an overlapping statement, keeping same-day twins apart", async () => {
		const { lines } = checkingCsv();
		// The first statement ends after the first of two identical coffees on 09/03.
		await importLines("import-1", lines.slice(0, 2));
		const later = await importLines("import-2", lines.slice(1));
		expect(later).toMatchObject({
			import: { transactionCount: 3, incomeCount: 1, duplicateCount: 1 },
		});
		const coffees = (await allTransactions()).filter((row) => row.note === "STUMPTOWN COFFEE");
		expect(coffees).toHaveLength(2);
	});

	it("is idempotent when the same Import is retried", async () => {
		const { lines } = checkingCsv();
		const first = await importLines("import-1", lines);
		const retry = await importLines("import-1", lines);
		expect(retry).toEqual(first);
		expect(await allTransactions()).toHaveLength(5);
		expect(await loadImports(db, householdId, "checking")).toHaveLength(1);
	});

	it("keeps lines apart per Account", async () => {
		const { lines } = checkingCsv();
		await importLines("import-1", lines.slice(0, 1));
		const other = await importLines("import-2", lines.slice(0, 1), { accountId: "card" });
		expect(other).toMatchObject({ import: { transactionCount: 1, duplicateCount: 0 } });
	});

	it("brings money back onto a card in as a negative Transaction, never income", async () => {
		const { statement } = readStatement(fixture("card-v2.qfx"), null);
		const result = await importStatement(db, {
			householdId,
			importId: "import-card",
			accountId: "card",
			source: "ofx",
			fileName: "card-v2.qfx",
			fileKey: null,
			lines: statement.lines,
			closingBalance: statement.closingBalance,
			csvMapping: null,
			createdByMemberId: parentId,
			newId,
		});
		expect(result).toMatchObject({
			import: {
				transactionCount: 3,
				incomeCount: 0,
				closingBalance: { amount: -81233, date: "2026-09-21" },
			},
		});
		expect((await allTransactions()).map((row) => row.amountCents).sort((a, b) => a - b)).toEqual([
			-50000, 3840, 3840,
		]);
		expect((await allTransactions()).map((row) => row.externalId).sort()).toEqual([
			"id:320262450123",
			"id:320262530456",
			"id:320262540789",
		]);
		expect(await loadIncome(db, householdId, month, "2026-10")).toEqual([]);
	});

	it("counts in no Bucket, and lists with its Account's name", async () => {
		const { lines } = checkingCsv();
		await importLines("import-1", lines);
		expect(await loadSpending(db, viewer, month)).toEqual([]);
		const page = await loadTransactionsPage(db, viewer, { month, limit: 10 });
		expect(page.transactions).toHaveLength(5);
		expect(page.transactions[0]).toMatchObject({
			date: "2026-09-10",
			amountCents: 6000,
			bucketId: null,
			note: "CHECK 1043",
			importedFrom: "Everyday Checking",
		});
	});

	it("keeps an imported Transaction's description private once split into a Personal Allowance", async () => {
		await db.insert(members).values({
			id: "sam",
			householdId,
			kind: "parent",
			name: "Sam",
			clerkUserId: "clerk-sam",
		});
		await addPersonalAllowance(db, {
			householdId,
			memberId: parentId,
			bucketId: "alex-pa",
			name: "Alex’s Personal Allowance",
			color: 2,
			month,
			allowanceCents: 20_000,
		});
		await importLines("import-1", checkingCsv().lines);
		const sam = { householdId, memberId: "sam" };
		const check = async (who: typeof viewer) =>
			(await loadTransactionsPage(db, who, { month, limit: 10 })).transactions.find(
				(t) => t.date === "2026-09-10",
			);
		// Unassigned and shared: both Parents see it whole.
		expect(await check(sam)).toMatchObject({ note: "CHECK 1043", partlyPrivate: false });
		const id = (await check(viewer))?.id ?? "";
		expect(
			await splitTransaction(db, {
				householdId,
				memberId: parentId,
				transactionId: id,
				amountCents: 6_000,
				note: "CHECK 1043",
				splits: [
					{
						id: "check-pa",
						amountCents: 2_000,
						assignment: { bucketId: "alex-pa" },
						forMemberIds: [],
					},
					{
						id: "check-food",
						amountCents: 4_000,
						assignment: { bucketId: "groceries" },
						forMemberIds: [],
					},
				],
			}),
		).toEqual({ ok: true });
		expect(await check(sam)).toMatchObject({
			amountCents: 4_000,
			note: null,
			partlyPrivate: true,
			importedFrom: "Everyday Checking",
		});
		expect(await check(viewer)).toMatchObject({ note: "CHECK 1043", partlyPrivate: false });
	});

	it("refuses another Household's Account and an empty statement", async () => {
		const { lines } = checkingCsv();
		await createHouseholdForParent(db, {
			clerkUserId: "other-user",
			householdId: "other",
			householdName: "Others",
			timeZone: "America/Chicago",
			parentId: "other-parent",
			parentName: "Sam",
		});
		expect(await importLines("import-1", lines, { household: "other" })).toEqual({
			ok: false,
			reason: "no-account",
		});
		expect(await importLines("import-2", [])).toEqual({ ok: false, reason: "nothing-to-import" });
		expect(await allTransactions()).toEqual([]);
		expect(await loadImports(db, "other", "checking")).toEqual([]);
	});

	it("brings in a long statement in one go", async () => {
		const lines: StatementLine[] = Array.from({ length: 400 }, (_, i) => ({
			date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}` as StatementLine["date"],
			amount: -(100 + i),
			description: `Shop ${i}`,
			bankId: null,
		}));
		expect(await importLines("import-1", lines)).toMatchObject({
			import: { transactionCount: 400 },
		});
	});

	it("remembers the Account's CSV mapping from its latest CSV Import", async () => {
		const { lines, mapping } = checkingCsv();
		expect(await loadCsvMapping(db, householdId, "checking")).toBeNull();
		await importLines("import-1", lines, { csvMapping: mapping });
		expect(await loadCsvMapping(db, householdId, "checking")).toEqual(mapping);
		const changed: CsvMapping = { ...mapping, dateFormat: "dmy" };
		await importLines("import-2", lines, { csvMapping: changed });
		expect(await loadCsvMapping(db, householdId, "checking")).toEqual(changed);
		expect(await loadCsvMapping(db, "other", "checking")).toBeNull();
	});
});
