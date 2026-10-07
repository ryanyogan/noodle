import {
	type BankLine,
	type BankRow,
	type BankRowChange,
	bankLineKey,
	type DayKey,
	holdsMoney,
	planBankSync,
} from "@noodle/domain";
import { and, asc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { markCardPayments } from "./card-payments";
import { bankLinesNotDeleted } from "./deleted-lines";
import { endedBefore, lineEndedRestores, purchaseEndedRestores } from "./ended-months";
import { importStatement } from "./imports";
import type { Db } from "./index";
import { matchImported } from "./matches";
import { markMoneyInByRule } from "./money-in";
import { owedBackOffGoneSplits } from "./owed-back";
import { bankLinesNotHere } from "./same-lines";
import {
	accounts,
	income,
	owedBack,
	paidBackMatches,
	refundLinks,
	splits,
	transactions,
	transfers,
} from "./schema";
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
 * Null when the Account is gone, archived, or isn't the Bank Connection's (unlinked: ADR-0046). New lines land as the Import
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
		/** The Household's day; UTC's when left out. */
		today?: DayKey;
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
				// Nothing new is brought into an archived Account (ADR-0046).
				isNull(accounts.archivedAt),
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
	const day = input.today ?? (new Date().toISOString().slice(0, 10) as DayKey);

	const writes = [
		...plan.change.flatMap((change) => changeWrites(db, householdId, accountId, change, day)),
		...plan.remove.flatMap((row) => removeWrites(db, householdId, accountId, row, day)),
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
	} else {
		// Nothing new came in, so no Import ran: a payment on a card that reads "Money back" (it
		// came in before its words were read, or its wording changed as it posted) is still marked.
		const paid = await markCardPayments(db, householdId, input.newId);
		for (const month of paid.months) months.add(month);
		// A line that changed as it posted may now be the money out a remembered pair of Accounts
		// was waiting for: joined here too, as every Import does (issue 141).
		await markMoneyInByRule(db, householdId, [], input.newId);
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

// The bank changing an amount under money back (issue 141, ADR-0058). Nothing ever restores more
// than it is: where the new amount is below what a line has Paid back, or a purchase's below what
// was Paid back on it or refunded to it, the newest matches and links give way in the running
// month, and what was owed is owed again. Once some of that counted in a month that has ended,
// the row keeps its amount and date instead (as a withdrawn one keeps its row) and is marked
// with the day and what the bank says now.

/** A match made before this one on the same `side` (its line, or its Owed back item). */
const earlierMatches = (side: "income_id" | "owed_back_id") =>
	sql`(select coalesce(sum(e.amount_cents), 0) from paid_back_matches e
		where e.${sql.raw(side)} = paid_back_matches.${sql.raw(side)}
		and (e.created_at < paid_back_matches.created_at
			or (e.created_at = paid_back_matches.created_at and e.id < paid_back_matches.id)))`;

/** Deletes, then lowers, the newest matches on `side` until they come to no more than `cap`. */
function trimMatches(
	db: Db,
	householdId: string,
	side: "income_id" | "owed_back_id",
	these: SQL,
	cap: SQL,
	from: DayKey,
): BatchItem<"sqlite">[] {
	const running = and(
		eq(paidBackMatches.householdId, householdId),
		these,
		// What counted in a month that has ended is never taken away.
		sql`paid_back_matches.counts_on >= ${from}`,
	);
	return [
		db.delete(paidBackMatches).where(and(running, sql`${earlierMatches(side)} >= ${cap}`)),
		db
			.update(paidBackMatches)
			.set({ amountCents: sql`${cap} - ${earlierMatches(side)}` })
			.where(and(running, sql`${earlierMatches(side)} + paid_back_matches.amount_cents > ${cap}`)),
	];
}

/** Takes the newest Refund links off the purchase `transactionId` while they come to more than it cost. */
function trimRefundLinks(db: Db, householdId: string, these: SQL, from: DayKey) {
	return db.delete(refundLinks).where(
		and(
			eq(refundLinks.householdId, householdId),
			these,
			sql`refund_links.counts_on >= ${from}`,
			sql`(select coalesce(sum(oi.amount_cents), 0) from refund_links ol
					join income oi on oi.id = ol.income_id
					where ol.transaction_id = refund_links.transaction_id
					and (ol.created_at < refund_links.created_at
						or (ol.created_at = refund_links.created_at and ol.income_id <= refund_links.income_id)))
				> (select pt.amount_cents from transactions pt where pt.id = refund_links.transaction_id)`,
		),
	);
}

function changeWrites(
	db: Db,
	householdId: string,
	accountId: string,
	change: BankRowChange,
	today: DayKey,
): BatchItem<"sqlite">[] {
	const { row } = change;
	const from = endedBefore(today);
	const asRead = stillAsRead(householdId, accountId, row);
	const mark = {
		externalId: change.externalId,
		// The first day it was seen: a later sync saying the same again keeps it.
		bankTookBackOn: sql<string>`coalesce(bank_took_back_on, ${today})`,
		bankAmountCents: change.amount,
	};
	if (row.kind === "income") {
		const set = { externalId: change.externalId, date: change.date, amountCents: change.amount };
		if (change.amount === row.amount) return [db.update(income).set(set).where(asRead)];
		// What it restored would move: less than it has Paid back, or a linked Refund of another amount.
		const kept = sql`((${change.amount} < (select coalesce(sum(pm.amount_cents), 0)
				from paid_back_matches pm where pm.income_id = ${row.id})
			or exists (select 1 from refund_links rl where rl.income_id = ${row.id}))
			and ${lineEndedRestores(row.id, from)})`;
		const theLine = sql`(select li.amount_cents from income li where li.id = ${row.id})`;
		return [
			db.update(income).set(mark).where(and(asRead, kept)),
			db
				.update(income)
				.set(set)
				.where(and(asRead, sql`not ${kept}`)),
			...trimMatches(
				db,
				householdId,
				"income_id",
				eq(paidBackMatches.incomeId, row.id),
				theLine,
				from,
			),
			// A Refund now larger than the purchase it was linked to cost is no longer linked.
			trimRefundLinks(db, householdId, eq(refundLinks.incomeId, row.id), from),
		];
	}
	const set = {
		externalId: change.externalId,
		date: change.date,
		amountCents: change.amount,
		pending: change.pending,
		// A Parent's change made on what the bank said before is refused, not this (ADR-0041).
		version: sql`${transactions.version} + 1`,
	};
	// Only a purchase the bank lowered can end up below the money back on it.
	const lowered = row.amount > 0 && change.amount < row.amount;
	// Below what was Paid back on it (on any of its Splits, at their new amounts) or refunded to it.
	const paidOn = (owed: SQL) =>
		sql`(select coalesce(sum(pm.amount_cents), 0) from paid_back_matches pm
			join owed_back po on po.id = pm.owed_back_id where po.transaction_id = ${row.id} and ${owed})`;
	// Its Splits at their new amounts, as one JSON parameter however many there are: D1 caps a
	// statement's bound parameters at 100, and `kept` is in two statements.
	const parts = JSON.stringify((change.splits ?? []).map((split) => [split.id, split.amount]));
	const kept = sql`((${change.amount} < ${paidOn(sql`1`)}
		or ${change.amount} < (select coalesce(sum(ri.amount_cents), 0) from refund_links rl
			join income ri on ri.id = rl.income_id where rl.transaction_id = ${row.id})
		or exists (select 1 from json_each(${parts}) part where json_extract(part.value, '$[1]') <
			${paidOn(sql`po.split_id = json_extract(part.value, '$[0]')`)}))
		and ${purchaseEndedRestores(from)})`;
	const writes: BatchItem<"sqlite">[] = lowered
		? [
				db
					.update(transactions)
					.set({ ...mark, pending: change.pending, version: sql`${transactions.version} + 1` })
					.where(and(asRead, kept)),
				db
					.update(transactions)
					.set(set)
					.where(and(asRead, sql`not ${kept}`)),
			]
		: [db.update(transactions).set(set).where(asRead)];
	const ofThePurchase = sql`paid_back_matches.owed_back_id in
		(select ob.id from owed_back ob where ob.transaction_id = ${row.id})`;
	// What an Owed back item can be at most: its Split's amount, or the purchase's.
	const most = sql`coalesce((select q.amount_cents from splits q where q.id = owed_back.split_id
			and q.transaction_id = owed_back.transaction_id),
		(select pt.amount_cents from transactions pt where pt.id = owed_back.transaction_id))`;
	const trims: BatchItem<"sqlite">[] = lowered
		? [
				db
					.update(owedBack)
					.set({ amountCents: most })
					.where(
						and(
							eq(owedBack.householdId, householdId),
							eq(owedBack.transactionId, row.id),
							sql`owed_back.amount_cents > ${most}`,
							// Its Owed back stays as it was with the purchase, when that is kept.
							sql`not exists (select 1 from paid_back_matches km
								where km.owed_back_id = owed_back.id and km.counts_on < ${from})`,
						),
					),
				...trimMatches(
					db,
					householdId,
					"owed_back_id",
					ofThePurchase,
					sql`(select ob.amount_cents from owed_back ob where ob.id = paid_back_matches.owed_back_id)`,
					from,
				),
				trimRefundLinks(db, householdId, eq(refundLinks.transactionId, row.id), from),
			]
		: [];
	if (change.splits === null) return [...writes, ...trims];
	// Its Splits follow only the change this sync made, so they add up to its amount.
	const changed = sql`exists (select 1 from ${transactions} where ${and(
		eq(transactions.id, row.id),
		eq(transactions.householdId, householdId),
		eq(transactions.externalId, change.externalId),
		eq(transactions.amountCents, change.amount),
	)})`;
	if (change.splits.length === 0)
		return [
			...writes,
			...clearSplits(db, householdId, row.id, changed),
			owedBackOffGoneSplits(db, householdId, row.id),
			...trims,
		];
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
		...trims,
	];
}

function removeWrites(
	db: Db,
	householdId: string,
	accountId: string,
	row: BankRow,
	today: DayKey,
): BatchItem<"sqlite">[] {
	const from = endedBefore(today);
	const asRead = stillAsRead(householdId, accountId, row);
	// Kept, it says the day the bank took it back (issue 141): the first day, if said again. A
	// line the bank had lowered before ("changed this to $60") says the withdrawal instead, with
	// its own day: what happened last is what is true of it now.
	const tookBack = {
		bankTookBackOn: sql<string>`case when bank_amount_cents is not null then ${today}
			else coalesce(bank_took_back_on, ${today}) end`,
		bankAmountCents: null,
	};
	const marked =
		row.kind === "transaction"
			? db
					.update(transactions)
					.set({ ...tookBack, version: sql`${transactions.version} + 1` })
					.where(
						and(
							asRead,
							purchaseEndedRestores(from),
							sql`(${transactions.bankTookBackOn} is null or ${transactions.bankAmountCents} is not null)`,
						),
					)
			: db
					.update(income)
					.set(tookBack)
					.where(and(asRead, lineEndedRestores(row.id, from)));
	// A line whose money back counted in a month that has ended is kept as it is, with what it
	// restored: the bank can't be refused, and an ended month never changes (ADR-0058).
	const theRow = and(
		stillAsRead(householdId, accountId, row),
		sql`not ${row.kind === "transaction" ? purchaseEndedRestores(from) : lineEndedRestores(income.id, from)}`,
	) as SQL;
	if (row.kind === "transaction") {
		return [
			marked,
			...transactionDeletes(db, { householdId, transactionId: row.id, theTransaction: theRow }),
		];
	}
	return [
		marked,
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
		// What it had Paid back is owed again.
		db
			.delete(paidBackMatches)
			.where(
				and(
					eq(paidBackMatches.householdId, householdId),
					eq(paidBackMatches.incomeId, row.id),
					sql`exists (select 1 from ${income} where ${theRow})`,
				),
			),
		// The purchase it was a Refund for is no longer given the money back.
		db
			.delete(refundLinks)
			.where(
				and(
					eq(refundLinks.householdId, householdId),
					eq(refundLinks.incomeId, row.id),
					sql`exists (select 1 from ${income} where ${theRow})`,
				),
			),
		db.delete(income).where(theRow),
	];
}
