import type { Cents, DayKey } from "@noodle/domain";
import { and, asc, desc, eq, gte, lt, or, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { accountLabelSql } from "./account-label";
import type { Db } from "./index";
import { loadMoneyIn, type MoneyInLine } from "./money-in";
import { accounts, income } from "./schema";
import type { TransactionCursor, TransactionRow, TransactionSort } from "./transactions";

// Money in as rows of the Transactions table (issue 152, ADR-0061). Money into an Account that
// holds money is kept in `income`, apart from `transactions`; the table lists both as one list.
// Each side is read in the list's order, past the same cursor, and the two are merged here: the
// order is a total one over (what the list sorts on, date, ID), so a page boundary never repeats
// or skips a row whichever table it came from.

/** A money-in line as a row of the Transactions table: `moneyIn` is the line itself. */
export type MoneyInRow = TransactionRow & { moneyIn: MoneyInLine };

/** Which money in a list of Transactions takes in: the list's own filters, as far as they apply. */
export type MoneyInRowsFilter = {
	/** From this day. */
	from?: DayKey;
	/** Up to, not including, this day. */
	until?: DayKey;
	accountId?: string;
	/** Words in the note, already escaped for LIKE (with "!"). */
	like?: string;
	/** Only the lines waiting in Review. */
	review?: boolean;
	/**
	 * The list is narrowed to a Bucket or to who it was For: money in is in no Bucket and For
	 * nobody, so none of it is listed.
	 */
	none?: boolean;
};

/** How a list's order compares two rows: by amount, by a text key, or by date alone. */
export function sortShape(sort: TransactionSort) {
	const byAmount = sort === "largest" || sort === "smallest";
	const byText =
		sort === "name-az" || sort === "name-za"
			? ("name" as const)
			: sort === "assigned-az" || sort === "assigned-za"
				? ("assigned" as const)
				: sort === "account-az" || sort === "account-za"
					? ("account" as const)
					: null;
	const descending = sort === "newest" || sort === "largest" || sort.endsWith("-za");
	return { byAmount, byText, descending };
}

/** What a row is placed by in the list's order. */
export type ListPlace = { date: string; id: string; amountCents: number; sortKey: string | null };

const encoder = new TextEncoder();

/** Text as SQLite orders it (BINARY: byte by byte in UTF-8), which a JS string compare is not. */
function compareBytes(a: string, b: string): number {
	if (a === b) return 0;
	const x = encoder.encode(a);
	const y = encoder.encode(b);
	const shared = Math.min(x.length, y.length);
	for (let i = 0; i < shared; i += 1) {
		const diff = (x[i] as number) - (y[i] as number);
		if (diff !== 0) return diff;
	}
	return x.length - y.length;
}

/**
 * The list's order as SQL gives it, for rows read from two tables: what the list sorts on, then
 * the date, then the ID, all in the order's own direction.
 */
export function listOrder(sort: TransactionSort): (a: ListPlace, b: ListPlace) => number {
	const { byAmount, byText, descending } = sortShape(sort);
	const sign = descending ? -1 : 1;
	return (a, b) => {
		let diff = 0;
		if (byAmount) diff = a.amountCents - b.amountCents;
		else if (byText) diff = compareBytes(a.sortKey ?? "", b.sortKey ?? "");
		if (diff === 0) diff = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
		if (diff === 0) diff = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
		return sign * diff;
	};
}

/** The enclosing query's money-in line is the arriving side of a Transfer that still stands. */
const inTransfer = sql`exists (select 1 from transfers x where x.in_income_id = ${income.id}
	and x.removed_at is null)`;

/** It waits in Review for a Parent to say its kind, as `loadMoneyIn` reads it. */
const waits = sql`(${income.needsReview} = 1 and ${income.kind} is null and not ${inTransfer})`;

function matching(householdId: string, filter: MoneyInRowsFilter): SQL | undefined {
	return and(
		eq(income.householdId, householdId),
		filter.from ? gte(income.date, filter.from) : undefined,
		filter.until ? lt(income.date, filter.until) : undefined,
		filter.accountId ? eq(income.accountId, filter.accountId) : undefined,
		filter.like ? sql`${income.note} like ${`%${filter.like}%`} escape '!'` : undefined,
		filter.review ? waits : undefined,
	);
}

/**
 * What a money-in row sorts on in a list by name, by what it's assigned to or by Account, as
 * `textSortKey` says it for a Transaction: its wording; nothing (it is assigned to nothing, so it
 * sorts with the unassigned); the Account it came into, or nothing when it was typed in.
 */
function textKey(by: "name" | "assigned" | "account"): SQL<string> {
	if (by === "name") return sql<string>`substr(lower(coalesce(trim(${income.note}), '')), 1, 200)`;
	if (by === "assigned") return sql<string>`''`;
	return sql<string>`lower(coalesce(${accountLabelSql}, ''))`;
}

/** A money-in line as the Transactions table's row: money in is a negative amount there. */
export function moneyInRow(
	line: MoneyInLine,
	into: string | null,
	transfer: { from: string | null; reason: "between-us" | null } | null,
): MoneyInRow {
	return {
		id: line.id,
		date: line.date,
		amountCents: -line.amount as Cents,
		bucketId: null,
		commitmentId: null,
		goal: null,
		note: line.note,
		merchantName: null,
		importedFrom: into,
		pending: false,
		bankTookBackOn: line.bankTookBackOn,
		bankAmount: line.bankAmount,
		matchedIn: null,
		transfer: transfer ? { from: transfer.from, to: into, reason: transfer.reason } : null,
		refundOf: null,
		for: [],
		splits: [],
		partlyPrivate: false,
		autoFiled: null,
		waits: line.needsReview,
		version: line.version,
		moneyIn: line,
	};
}

/**
 * One page's worth of the money in a list of Transactions takes in, in the list's order, past
 * `after`: at most `limit` rows, each with what it sorts on. Income is the Household's, never
 * private, so there is nothing of it to hide from either Parent.
 */
export async function loadMoneyInRows(
	db: Db,
	householdId: string,
	query: MoneyInRowsFilter & {
		sort: TransactionSort;
		after?: TransactionCursor;
		/** Only this line. */
		id?: string;
		limit: number;
	},
): Promise<{ row: MoneyInRow; sortKey: string | null }[]> {
	if (query.none) return [];
	const { byAmount, byText, descending } = sortShape(query.sort);
	const amount = sql<number>`(-${income.amountCents})`;
	const text = byText ? textKey(byText) : null;
	const key = text ?? (byAmount ? amount : null);
	const past = (column: SQLWrapper, value: unknown) =>
		descending ? sql`${column} < ${value}` : sql`${column} > ${value}`;
	const pastByDate = (from: TransactionCursor) =>
		or(past(income.date, from.date), and(eq(income.date, from.date), past(income.id, from.id)));
	// A cursor made for another order has nothing to continue from here, so it's left alone.
	const from = text ? query.after?.key : byAmount ? query.after?.amountCents : undefined;
	const after = !query.after
		? undefined
		: !key
			? pastByDate(query.after)
			: from === undefined
				? undefined
				: or(past(key, from), and(sql`${key} = ${from}`, pastByDate(query.after)));
	const direction = descending ? desc : asc;
	const found = await db
		.select({
			id: income.id,
			into: sql<string | null>`${accountLabelSql}`,
			transfer: sql<
				string | null
			>`(select json_object('from', coalesce(ao.name, oa.name), 'reason', x.reason)
				from transfers x
				left join accounts oa on oa.id = x.other_account_id
				left join transactions o on o.id = x.out_transaction_id
				left join accounts ao on ao.id = o.account_id
				where x.in_income_id = ${income.id} and x.removed_at is null)`,
			sortKey: text ?? sql<string | null>`null`,
		})
		.from(income)
		.leftJoin(accounts, eq(accounts.id, income.accountId))
		.where(and(matching(householdId, query), query.id ? eq(income.id, query.id) : undefined, after))
		.orderBy(...(key ? [direction(key)] : []), direction(income.date), direction(income.id))
		.limit(query.limit);
	if (found.length === 0) return [];
	const lines = new Map(
		(await loadMoneyIn(db, householdId, { ids: found.map((row) => row.id) })).map((line) => [
			line.id,
			line,
		]),
	);
	return found.flatMap(({ id, into, transfer, sortKey }) => {
		const line = lines.get(id);
		// Gone between the two reads: the list is as it would be read a moment later.
		if (!line) return [];
		const side =
			line.kind === "transfer" || line.kind === "between-us"
				? { from: null, reason: null, ...(transfer ? JSON.parse(transfer) : {}) }
				: null;
		return [{ row: moneyInRow(line, into, side), sortKey }];
	});
}

/** One money-in line as the Transactions table's row, for its own address; null when there is none. */
export async function loadMoneyInRow(
	db: Db,
	householdId: string,
	incomeId: string,
): Promise<MoneyInRow | null> {
	const [found] = await loadMoneyInRows(db, householdId, {
		id: incomeId,
		sort: "newest",
		limit: 1,
	});
	return found?.row ?? null;
}

/**
 * The list's Money in figure and what of it is Income, with how many lines wait in Review: a
 * Transfer and Between us are the Household's own money moving, and a line that waits counts
 * nowhere until a Parent says what it is.
 */
export async function loadMoneyInSummary(
	db: Db,
	householdId: string,
	filter: MoneyInRowsFilter,
): Promise<{ inCents: number; incomeCents: number; waiting: number }> {
	if (filter.none) return { inCents: 0, incomeCents: 0, waiting: 0 };
	const came = sql`(not ${inTransfer} and not ${waits})`;
	const [row] = await db
		.select({
			inCents:
				sql<number>`coalesce(sum(case when ${came} then ${income.amountCents} else 0 end), 0)`.mapWith(
					Number,
				),
			incomeCents:
				sql<number>`coalesce(sum(case when ${came} and ${income.kind} is null then ${income.amountCents} else 0 end), 0)`.mapWith(
					Number,
				),
			waiting: sql<number>`coalesce(sum(case when ${waits} then 1 else 0 end), 0)`.mapWith(Number),
		})
		.from(income)
		.where(matching(householdId, { ...filter, review: false }));
	return row ?? { inCents: 0, incomeCents: 0, waiting: 0 };
}
