import {
	type BankLine,
	type BankRow,
	type BankRowChange,
	bankLineKey,
	type DayKey,
	holdsMoney,
	planBankSync,
} from "@noodle/domain";
import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { bankLinesNotDeleted } from "./deleted-lines";
import { importStatement } from "./imports";
import type { Db } from "./index";
import { matchImported } from "./matches";
import { bankLinesNotHere } from "./same-lines";
import { accounts, income, splits, transactions, transfers } from "./schema";
import { clearSplits, transactionDeletes } from "./transactions";
import { detectTransfers } from "./transfers";

// A sync from a Bank Connection into one of its Accounts: the lines the provider says are new or
// changed, and those it no longer has, applied as planBankSync (@noodle/domain) works out. Rows
// already in are changed where they are, in one batch, each only if it's still as it was read (a
// sync overtaken by another changes nothing twice); a pending Transaction's posted copy takes
// over its row, so its assignment, Splits, For, Receipt and any Match stay with it. Rows the bank
// dropped are deleted with what hangs off them. New lines then come in as an Import, less those
// already in the Account from a statement (bankLinesNotHere, ADR-0020). The rows
// compared are read by their IDs as one JSON parameter: D1 caps a statement's at 100.

export type BankSyncResult = {
	/** The Import the new lines made; null when there were none. */
	importId: string | null;
	changed: number;
	removed: number;
	/** Every month a row was added to, changed in or out of, or removed from. */
	months: string[];
};

/**
 * Syncs one of a Bank Connection's Accounts with the provider's `lines` and `removed` line IDs.
 * Null when the Account is gone or isn't the Bank Connection's. New lines land as the Import
 * `importId`, idempotently, as importStatement's do.
 */
export async function syncBankLines(
	db: Db,
	input: {
		householdId: string;
		connectionId: string;
		accountId: string;
		importId: string;
		lines: BankLine[];
		removed: string[];
		createdByMemberId: string;
		newId: () => string;
	},
): Promise<BankSyncResult | null> {
	const { householdId, accountId } = input;
	const [account] = await db
		.select({ kind: accounts.kind })
		.from(accounts)
		.where(
			and(
				eq(accounts.id, accountId),
				eq(accounts.householdId, householdId),
				eq(accounts.bankConnectionId, input.connectionId),
			),
		);
	if (!account) return null;

	const rows = await loadBankRows(db, householdId, accountId, [
		...input.lines.flatMap((line) =>
			line.replaces ? [line.bankId, line.replaces] : [line.bankId],
		),
		...input.removed,
	]);
	const plan = planBankSync(rows, input.lines, input.removed, holdsMoney(account.kind));

	const writes = [
		...plan.change.flatMap((change) => changeWrites(db, householdId, accountId, change)),
		...plan.remove.flatMap((row) => removeWrites(db, householdId, accountId, row)),
	];
	if (writes.length > 0) {
		await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
	}
	const months = new Set<string>();
	const changedDays: DayKey[] = [];
	for (const change of plan.change) {
		months.add(change.row.date.slice(0, 7));
		months.add(change.date.slice(0, 7));
		changedDays.push(change.date);
	}
	for (const row of plan.remove) months.add(row.date.slice(0, 7));
	// A charge that changed as it posted may be a Quick Add's bank copy, or a Transfer's side, now.
	if (changedDays.length > 0) {
		const [first, last] = [changedDays.sort()[0], changedDays.at(-1)] as [DayKey, DayKey];
		const matched = await matchImported(db, householdId, first, last, input.newId);
		const moved = await detectTransfers(db, householdId, first, last, input.newId);
		for (const month of [...matched.months, ...moved.months]) months.add(month);
	}

	// Lines a Parent deleted stay deleted, a pending one's posted copy too (ADR-0045).
	const kept = await bankLinesNotDeleted(db, { householdId, accountId, lines: plan.add });
	if (kept.writes.length > 0) {
		await db.batch(kept.writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
	}
	// Lines a statement already brought in (or an earlier Bank Connection) aren't brought in again.
	const notHere = await bankLinesNotHere(db, {
		householdId,
		accountId,
		connectionId: input.connectionId,
		lines: kept.add,
	});
	if (notHere.writes.length > 0) {
		await db.batch(notHere.writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
	}

	let importId: string | null = null;
	if (notHere.add.length > 0) {
		const imported = await importStatement(db, {
			householdId,
			importId: input.importId,
			accountId,
			source: "bank",
			fileName: null,
			fileKey: null,
			bankConnectionId: input.connectionId,
			lines: notHere.add.map(({ date, amount, description, bankId, pending }) => ({
				date,
				amount,
				description,
				bankId,
				pending: pending === true,
			})),
			closingBalance: null,
			csvMapping: null,
			alreadyHere: notHere.paired,
			createdByMemberId: input.createdByMemberId,
			newId: input.newId,
		});
		if (imported.ok) {
			importId = input.importId;
			for (const month of imported.months) months.add(month);
		}
	}
	return {
		importId,
		changed: plan.change.length,
		removed: plan.remove.length,
		months: [...months].sort(),
	};
}

/** The Account's Transactions and income kept under any of the bank IDs, with their Splits. */
async function loadBankRows(
	db: Db,
	householdId: string,
	accountId: string,
	bankIds: string[],
): Promise<BankRow[]> {
	const keys = sql`(select value from json_each(${JSON.stringify(
		[...new Set(bankIds)].map(bankLineKey),
	)}))`;
	const [spent, received, splitRows] = await db.batch([
		db
			.select({
				id: transactions.id,
				externalId: transactions.externalId,
				date: transactions.date,
				amount: transactions.amountCents,
				pending: transactions.pending,
			})
			.from(transactions)
			.where(
				and(
					eq(transactions.householdId, householdId),
					eq(transactions.accountId, accountId),
					inArray(transactions.externalId, keys),
				),
			),
		db
			.select({
				id: income.id,
				externalId: income.externalId,
				date: income.date,
				amount: income.amountCents,
			})
			.from(income)
			.where(
				and(
					eq(income.householdId, householdId),
					eq(income.accountId, accountId),
					inArray(income.externalId, keys),
				),
			),
		db
			.select({ id: splits.id, transactionId: splits.transactionId, amount: splits.amountCents })
			.from(splits)
			.innerJoin(transactions, eq(transactions.id, splits.transactionId))
			.where(
				and(
					eq(splits.householdId, householdId),
					eq(transactions.accountId, accountId),
					inArray(transactions.externalId, keys),
				),
			)
			.orderBy(asc(splits.transactionId), asc(splits.position)),
	]);
	// Dates are always written as DayKeys; a row found by its external ID has one.
	return [
		...spent.map((row) => ({
			...row,
			kind: "transaction" as const,
			externalId: row.externalId as string,
			date: row.date as DayKey,
			splits: splitRows
				.filter((split) => split.transactionId === row.id)
				.map(({ id, amount }) => ({ id, amount })),
		})),
		...received.map((row) => ({
			...row,
			kind: "income" as const,
			externalId: row.externalId as string,
			date: row.date as DayKey,
			pending: false,
			splits: [],
		})),
	];
}

/** A row still as the sync read it. */
const stillAsRead = (householdId: string, accountId: string, row: BankRow): SQL =>
	row.kind === "income"
		? (and(
				eq(income.id, row.id),
				eq(income.householdId, householdId),
				eq(income.accountId, accountId),
				eq(income.externalId, row.externalId),
				eq(income.date, row.date),
				eq(income.amountCents, row.amount),
			) as SQL)
		: (and(
				eq(transactions.id, row.id),
				eq(transactions.householdId, householdId),
				eq(transactions.accountId, accountId),
				eq(transactions.externalId, row.externalId),
				eq(transactions.date, row.date),
				eq(transactions.amountCents, row.amount),
				eq(transactions.pending, row.pending),
			) as SQL);

function changeWrites(
	db: Db,
	householdId: string,
	accountId: string,
	change: BankRowChange,
): BatchItem<"sqlite">[] {
	const { row } = change;
	if (row.kind === "income") {
		return [
			db
				.update(income)
				.set({ externalId: change.externalId, date: change.date, amountCents: change.amount })
				.where(stillAsRead(householdId, accountId, row)),
		];
	}
	const writes: BatchItem<"sqlite">[] = [
		db
			.update(transactions)
			.set({
				externalId: change.externalId,
				date: change.date,
				amountCents: change.amount,
				pending: change.pending,
				// A Parent's change made on what the bank said before is refused, not this (ADR-0041).
				version: sql`${transactions.version} + 1`,
			})
			.where(stillAsRead(householdId, accountId, row)),
	];
	if (change.splits === null) return writes;
	// Its Splits follow only the change this sync made, so they add up to its amount.
	const changed = sql`exists (select 1 from ${transactions} where ${and(
		eq(transactions.id, row.id),
		eq(transactions.householdId, householdId),
		eq(transactions.externalId, change.externalId),
		eq(transactions.amountCents, change.amount),
	)})`;
	if (change.splits.length === 0)
		return [...writes, ...clearSplits(db, householdId, row.id, changed)];
	return [
		...writes,
		...change.splits.map((split) =>
			db
				.update(splits)
				.set({ amountCents: split.amount })
				.where(
					and(
						eq(splits.id, split.id),
						eq(splits.transactionId, row.id),
						eq(splits.householdId, householdId),
						changed,
					),
				),
		),
	];
}

function removeWrites(
	db: Db,
	householdId: string,
	accountId: string,
	row: BankRow,
): BatchItem<"sqlite">[] {
	const theRow = stillAsRead(householdId, accountId, row);
	if (row.kind === "transaction") {
		return transactionDeletes(db, { householdId, transactionId: row.id, theTransaction: theRow });
	}
	return [
		// The Transfer it arrived by goes, marked or unmarked, and the money it came from counts again.
		db
			.delete(transfers)
			.where(
				and(
					eq(transfers.householdId, householdId),
					eq(transfers.inIncomeId, row.id),
					sql`exists (select 1 from ${income} where ${theRow})`,
				),
			),
		db.delete(income).where(theRow),
	];
}
