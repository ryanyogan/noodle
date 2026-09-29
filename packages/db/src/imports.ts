import {
	type ClosingBalance,
	type CsvMapping,
	type DayKey,
	holdsMoney,
	type StatementLine,
	statementLineIds,
} from "@noodle/domain";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "./index";
import { matchImported } from "./matches";
import { accounts, csvMappings, imports, income, transactions } from "./schema";

// Imports: a statement's lines brought into one of the Household's Accounts. Money out becomes
// unassigned Transactions (in no Bucket until a Parent or, later, categorization assigns them);
// money into a checking or savings Account becomes income; money back onto a card or loan (a
// payment or a Refund) is a Transaction with a negative amount, unassigned, so it counts nowhere
// until a Transfer or Refund claims it. Every line is keyed by its ID in the Account (the bank's
// own, or a fingerprint; statementLineIds in @noodle/domain) behind a unique index, so bringing in
// the same or an overlapping statement again adds nothing twice, and a retried Import is a no-op.
// After the lines land, the statement's days are Matched with Quick Adds (matchImported), so a
// Quick Add's bank copy counts once; a retry Matches nothing twice.

/** An Import, as its Account's history shows it. */
export type ImportRecord = {
	id: string;
	source: "csv" | "ofx";
	fileName: string | null;
	transactionCount: number;
	incomeCount: number;
	duplicateCount: number;
	/** How many of its Transactions are Matched to Quick Adds now. */
	matchedCount: number;
	firstDate: DayKey | null;
	lastDate: DayKey | null;
	closingBalance: ClosingBalance | null;
	createdAt: Date;
};

export type ImportResult =
	| { ok: true; import: ImportRecord; months: string[]; matched: number }
	| { ok: false; reason: "no-account" | "nothing-to-import" };

/**
 * Brings a statement's lines into an Account, atomically, and records the Import. Idempotent per
 * `importId`. `newId` makes the ID of each Transaction or income row written.
 */
export async function importStatement(
	db: Db,
	input: {
		householdId: string;
		importId: string;
		accountId: string;
		source: "csv" | "ofx";
		fileName: string | null;
		fileKey: string | null;
		lines: StatementLine[];
		closingBalance: ClosingBalance | null;
		/** The CSV mapping to remember for the Account. */
		csvMapping: CsvMapping | null;
		createdByMemberId: string;
		newId: () => string;
	},
): Promise<ImportResult> {
	const { householdId, importId, accountId } = input;
	if (input.lines.length === 0) return { ok: false, reason: "nothing-to-import" };
	const [account] = await db
		.select({ kind: accounts.kind })
		.from(accounts)
		.where(and(eq(accounts.id, accountId), eq(accounts.householdId, householdId)));
	if (!account) return { ok: false, reason: "no-account" };

	const ids = statementLineIds(input.lines);
	const toIncome = holdsMoney(account.kind);
	const spending: ImportRow[] = [];
	const received: ImportRow[] = [];
	input.lines.forEach((line, i) => {
		const row = {
			id: input.newId(),
			date: line.date,
			note: line.description || null,
			externalId: ids[i] as string,
		};
		if (line.amount > 0 && toIncome) received.push({ ...row, amount: line.amount });
		// Transactions hold money spent, so money out is positive and money back negative.
		else spending.push({ ...row, amount: -line.amount });
	});
	const dates = input.lines.map((line) => line.date).sort();

	// The lines go in as one JSON parameter each for Transactions and income: D1 caps a
	// statement's bound parameters at 100, and a statement can have hundreds of lines.
	const theImport = sql`exists (select 1 from ${imports} where ${imports.id} = ${importId}
		and ${imports.householdId} = ${householdId} and ${imports.accountId} = ${accountId})`;
	const lineField = (field: keyof ImportRow) => sql`json_extract(value, ${`$.${field}`})`;
	await db.batch([
		db
			.insert(imports)
			.values({
				id: importId,
				householdId,
				accountId,
				source: input.source,
				fileName: input.fileName,
				fileKey: input.fileKey,
				status: "imported",
				firstDate: dates[0] ?? null,
				lastDate: dates.at(-1) ?? null,
				closingBalanceCents: input.closingBalance?.amount ?? null,
				closingBalanceDate: input.closingBalance?.date ?? null,
				createdByMemberId: input.createdByMemberId,
			})
			.onConflictDoNothing({ target: imports.id }),
		db
			.insert(transactions)
			.select(
				db
					.select({
						// Selected in the table's column order: insert … select is positional.
						id: sql<string>`${lineField("id")}`.as("id"),
						householdId: sql<string>`${householdId}`.as("household_id"),
						source: sql<"import">`'import'`.as("source"),
						date: sql<string>`${lineField("date")}`.as("date"),
						amountCents: sql<number>`${lineField("amount")}`.as("amount_cents"),
						bucketId: sql<string | null>`null`.as("bucket_id"),
						note: sql<string | null>`${lineField("note")}`.as("note"),
						createdByMemberId: sql<string | null>`null`.as("created_by_member_id"),
						createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
						commitmentId: sql<string | null>`null`.as("commitment_id"),
						accountId: sql<string>`${accountId}`.as("account_id"),
						goalId: sql<string | null>`null`.as("goal_id"),
						importId: sql<string>`${importId}`.as("import_id"),
						externalId: sql<string>`${lineField("externalId")}`.as("external_id"),
					})
					.from(sql`json_each(${JSON.stringify(spending)})`)
					.where(theImport),
			)
			.onConflictDoNothing(),
		db
			.insert(income)
			.select(
				db
					.select({
						id: sql<string>`${lineField("id")}`.as("id"),
						householdId: sql<string>`${householdId}`.as("household_id"),
						date: sql<string>`${lineField("date")}`.as("date"),
						amountCents: sql<number>`${lineField("amount")}`.as("amount_cents"),
						note: sql<string | null>`${lineField("note")}`.as("note"),
						createdByMemberId: sql<string | null>`null`.as("created_by_member_id"),
						createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
						accountId: sql<string>`${accountId}`.as("account_id"),
						importId: sql<string>`${importId}`.as("import_id"),
						externalId: sql<string>`${lineField("externalId")}`.as("external_id"),
					})
					.from(sql`json_each(${JSON.stringify(received)})`)
					.where(theImport),
			)
			.onConflictDoNothing(),
		// What this Import added, counted from the rows, so a retry reports the same.
		db
			.update(imports)
			.set({
				transactionCount: sql`(select count(*) from ${transactions} where ${transactions.importId} = ${importId})`,
				incomeCount: sql`(select count(*) from ${income} where ${income.importId} = ${importId})`,
				duplicateCount: sql`${input.lines.length}
					- (select count(*) from ${transactions} where ${transactions.importId} = ${importId})
					- (select count(*) from ${income} where ${income.importId} = ${importId})`,
			})
			.where(and(eq(imports.id, importId), eq(imports.householdId, householdId))),
		...(input.csvMapping
			? [
					db
						.insert(csvMappings)
						.values({ accountId, householdId, mapping: input.csvMapping })
						.onConflictDoUpdate({
							target: csvMappings.accountId,
							set: { mapping: input.csvMapping, updatedAt: sql`(unixepoch() * 1000)` },
							setWhere: eq(csvMappings.householdId, householdId),
						}),
				]
			: []),
	]);
	const first = dates[0] as DayKey;
	const last = dates.at(-1) as DayKey;
	const matched = await matchImported(db, householdId, first, last, input.newId);
	const [written] = await loadImports(db, householdId, accountId, importId);
	if (!written) return { ok: false, reason: "no-account" };
	return {
		ok: true,
		import: written,
		months: [...new Set([...dates.map((date) => date.slice(0, 7)), ...matched.months])],
		matched: matched.matched,
	};
}

type ImportRow = {
	id: string;
	date: DayKey;
	amount: number;
	note: string | null;
	externalId: string;
};

/** An Account's Imports, newest first; or just one of them. */
export async function loadImports(
	db: Db,
	householdId: string,
	accountId: string,
	importId?: string,
): Promise<ImportRecord[]> {
	const rows = await db
		.select({
			row: imports,
			matchedCount: sql<number>`(select count(*) from matches m join transactions t
				on t.id = m.imported_id where t.import_id = imports.id and m.removed_at is null)`,
		})
		.from(imports)
		.where(
			and(
				eq(imports.householdId, householdId),
				eq(imports.accountId, accountId),
				importId ? eq(imports.id, importId) : undefined,
			),
		)
		.orderBy(desc(imports.createdAt), desc(imports.id));
	// Dates are always written as DayKeys.
	return rows.map(({ row, matchedCount }) => ({
		id: row.id,
		source: row.source,
		fileName: row.fileName,
		transactionCount: row.transactionCount,
		incomeCount: row.incomeCount,
		duplicateCount: row.duplicateCount,
		matchedCount,
		firstDate: row.firstDate as DayKey | null,
		lastDate: row.lastDate as DayKey | null,
		closingBalance:
			row.closingBalanceCents !== null && row.closingBalanceDate
				? { amount: row.closingBalanceCents, date: row.closingBalanceDate as DayKey }
				: null,
		createdAt: row.createdAt,
	}));
}

/** The CSV mapping remembered for an Account, if it has had a CSV Import. */
export async function loadCsvMapping(
	db: Db,
	householdId: string,
	accountId: string,
): Promise<CsvMapping | null> {
	const [row] = await db
		.select({ mapping: csvMappings.mapping })
		.from(csvMappings)
		.where(and(eq(csvMappings.accountId, accountId), eq(csvMappings.householdId, householdId)));
	return row?.mapping ?? null;
}
