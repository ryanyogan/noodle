import {
	addDays,
	type BankLine,
	bankLineKey,
	type DayKey,
	type LineToPair,
	pairSameLines,
	SAME_LINE_DAYS,
} from "@noodle/domain";
import { and, eq, gte, inArray, lte, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "./index";
import { bankLinePairs, imports, income, transactions } from "./schema";

// The same line from two places (ADR-0020): a bank line for a line a statement already brought
// into the Account, or the other way round. pairSameLines (@noodle/domain) decides; this reads
// what it compares. A bank line that pairs isn't brought in: it's recorded in bank_line_pairs, so
// the bank's later reads of it skip it too. A statement line that pairs is simply left out, as a
// line already imported is.

type Row = LineToPair & { id: string };

/** An Account's imported rows dated `from` to `to` that `where` picks, in a statement's terms. */
async function rowsIn(
	db: Db,
	householdId: string,
	accountId: string,
	[from, to]: [DayKey, DayKey],
	where: { spent: SQL; received: SQL },
): Promise<Row[]> {
	const [spent, received] = await db.batch([
		db
			.select({
				id: transactions.id,
				date: transactions.date,
				amount: transactions.amountCents,
				description: transactions.note,
			})
			.from(transactions)
			.where(
				and(
					eq(transactions.householdId, householdId),
					eq(transactions.accountId, accountId),
					eq(transactions.source, "import"),
					gte(transactions.date, from),
					lte(transactions.date, to),
					where.spent,
				),
			),
		db
			.select({
				id: income.id,
				date: income.date,
				amount: income.amountCents,
				description: income.note,
			})
			.from(income)
			.where(
				and(
					eq(income.householdId, householdId),
					eq(income.accountId, accountId),
					gte(income.date, from),
					lte(income.date, to),
					where.received,
				),
			),
	]);
	// Transactions hold money spent; a statement line's money out is negative.
	return [
		...spent.map((row) => ({ ...row, date: row.date as DayKey, amount: -row.amount })),
		...received.map((row) => ({ ...row, date: row.date as DayKey })),
	];
}

/** The days lines span, widened by how far apart the same line may be dated. */
const spanOf = (lines: readonly { date: DayKey }[]): [DayKey, DayKey] => {
	const dates = lines.map((line) => line.date).sort();
	return [
		addDays(dates[0] as DayKey, -SAME_LINE_DAYS),
		addDays(dates.at(-1) as DayKey, SAME_LINE_DAYS),
	];
};

/**
 * A Bank Connection's new lines for one of its Accounts, less those already there from
 * elsewhere: lines it paired before, and posted lines that are rows a statement (or an earlier
 * Bank Connection) brought in. `writes` record the new pairs.
 */
export async function bankLinesNotHere(
	db: Db,
	input: { householdId: string; accountId: string; connectionId: string; lines: BankLine[] },
): Promise<{ add: BankLine[]; paired: number; writes: BatchItem<"sqlite">[] }> {
	const { householdId, accountId } = input;
	if (input.lines.length === 0) return { add: [], paired: 0, writes: [] };
	const keys = input.lines.map((line) => bankLineKey(line.bankId));
	const known = await db
		.select({ key: bankLinePairs.bankKey })
		.from(bankLinePairs)
		.where(
			and(
				eq(bankLinePairs.accountId, accountId),
				eq(bankLinePairs.householdId, householdId),
				inArray(bankLinePairs.bankKey, sql`(select value from json_each(${JSON.stringify(keys)}))`),
			),
		);
	const pairedBefore = new Set(known.map((row) => row.key));
	const fresh = input.lines.filter((line) => !pairedBefore.has(bankLineKey(line.bankId)));
	// A statement has no pending lines.
	const candidates = fresh.filter((line) => line.pending !== true);
	if (candidates.length === 0) {
		return { add: fresh, paired: input.lines.length - fresh.length, writes: [] };
	}
	const unpaired = (id: SQLWrapper) =>
		sql`not exists (select 1 from ${bankLinePairs} where ${bankLinePairs.rowId} = ${id})`;
	const notThisConnection = (importId: SQLWrapper) =>
		sql`not exists (select 1 from ${imports} where ${imports.id} = ${importId}
			and ${imports.bankConnectionId} = ${input.connectionId})`;
	const here = await rowsIn(db, householdId, accountId, spanOf(candidates), {
		spent: and(unpaired(transactions.id), notThisConnection(transactions.importId)) as SQL,
		received: and(unpaired(income.id), notThisConnection(income.importId)) as SQL,
	});
	const pairs = pairSameLines(here, candidates);
	const pairedNow = new Map<BankLine, string>();
	candidates.forEach((line, i) => {
		const rowId = pairs[i];
		if (rowId) pairedNow.set(line, rowId);
	});
	const writes: BatchItem<"sqlite">[] = [...pairedNow].map(([line, rowId]) =>
		db
			.insert(bankLinePairs)
			.values({ householdId, accountId, bankKey: bankLineKey(line.bankId), rowId })
			.onConflictDoNothing(),
	);
	return {
		add: fresh.filter((line) => !pairedNow.has(line)),
		paired: input.lines.length - fresh.length + pairedNow.size,
		writes,
	};
}

/**
 * Which of a statement's lines are lines its Account's Bank Connection brought in already: the
 * indexes to leave out. Lines already imported under their own ID (`ids`) aren't compared.
 */
export async function statementLinesBanked(
	db: Db,
	input: { householdId: string; accountId: string; lines: LineToPair[]; ids: string[] },
): Promise<Set<number>> {
	const { householdId, accountId, lines, ids } = input;
	if (lines.length === 0) return new Set();
	const idList = sql`(select value from json_each(${JSON.stringify(ids)}))`;
	const [spentIds, receivedIds] = await db.batch([
		db
			.select({ id: transactions.externalId })
			.from(transactions)
			.where(
				and(
					eq(transactions.householdId, householdId),
					eq(transactions.accountId, accountId),
					inArray(transactions.externalId, idList),
				),
			),
		db
			.select({ id: income.externalId })
			.from(income)
			.where(
				and(
					eq(income.householdId, householdId),
					eq(income.accountId, accountId),
					inArray(income.externalId, idList),
				),
			),
	]);
	const imported = new Set([...spentIds, ...receivedIds].map((row) => row.id));
	const candidates = lines.flatMap((line, i) =>
		imported.has(ids[i] as string) ? [] : [{ ...line, i }],
	);
	if (candidates.length === 0) return new Set();
	const fromBank = (importId: SQLWrapper) =>
		sql`exists (select 1 from ${imports} where ${imports.id} = ${importId}
			and ${imports.source} = 'bank')`;
	const here = await rowsIn(db, householdId, accountId, spanOf(candidates), {
		spent: fromBank(transactions.importId),
		received: fromBank(income.importId),
	});
	const pairs = pairSameLines(here, candidates);
	return new Set(candidates.flatMap((line, n) => (pairs[n] ? [line.i] : [])));
}
