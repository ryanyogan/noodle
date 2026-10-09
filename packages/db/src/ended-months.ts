import { type DayKey, type MonthKey, monthOfDay } from "@noodle/domain";
import { type AnyColumn, and, eq, type SQL, sql } from "drizzle-orm";
import type { Db } from "./index";
import { type Viewer, visibleTo } from "./privacy";
import {
	refunds as cardRefunds,
	owedBack,
	paidBackMatches,
	refundLinks,
	transactions,
} from "./schema";

// "Ended months don't change" (ADR-0058): money Paid back, or a Refund linked to its purchase,
// counts on a day (`counts_on`), and once that day's month has ended nothing takes it away again.
// Whatever would remove such a restore asks here first: a Parent's action is refused
// (`month-ended`), and a line the bank withdraws is kept as it is.

/** The first day of the month `today` is in: what counts before it counted in an ended month. */
export const runningFrom = (today: DayKey) => `${monthOfDay(today)}-01` as DayKey;

/**
 * The first day of the running month. Callers that know the Household's day pass it; without it
 * the day is UTC's, so the guard is never off.
 */
export const endedBefore = (today?: DayKey) =>
	runningFrom(today ?? (new Date().toISOString().slice(0, 10) as DayKey));

/**
 * On `transactions` (or the purchase `id` names): money back on this purchase counted in a month
 * that has ended, or what was Owed back on it was written off in one.
 */
export const purchaseEndedRestores = (
	from: DayKey,
	id: AnyColumn | SQL | string = transactions.id,
): SQL =>
	sql`(exists (select 1 from paid_back_matches em join owed_back eo on eo.id = em.owed_back_id
			where eo.transaction_id = ${id} and em.counts_on < ${from})
		or exists (select 1 from owed_back ew
			where ew.transaction_id = ${id} and ew.written_off_on < ${from})
		or exists (select 1 from refund_links el
			where el.transaction_id = ${id} and el.counts_on < ${from}))`;

/**
 * The one test every write that would move a purchase asks (issue 141): true while no money back
 * on it counted in a month that has ended, so its amount, where it is filed, its Splits and
 * whether it counts may still change. A bulk action puts this in its write and counts the
 * purchases it left out; a single one answers `month-ended`.
 */
export const purchaseMayMove = (today?: DayKey, id?: AnyColumn | SQL | string): SQL =>
	sql`not ${purchaseEndedRestores(endedBefore(today), id)}`;

/** What the money-in line `incomeId` restored counted in a month that has ended. */
export const lineEndedRestores = (incomeId: AnyColumn | string, from: DayKey): SQL =>
	sql`(exists (select 1 from paid_back_matches em
			where em.income_id = ${incomeId} and em.counts_on < ${from})
		or exists (select 1 from refund_links el
			where el.income_id = ${incomeId} and el.counts_on < ${from}))`;

/**
 * The months money back counted in for one row, oldest first, each once: for a purchase
 * (`transactionId`) what was Paid back on it and the Refunds linked to it, through money in or on
 * a card; for a money-in line
 * (`incomeId`) what it Paid back and the purchase it refunds. They are the months a line the bank
 * took back is kept for, beside its own (issue 141). None for a row the viewer can't see.
 */
export async function loadRestoreMonths(
	db: Db,
	viewer: Viewer,
	row: { transactionId: string } | { incomeId: string },
): Promise<MonthKey[]> {
	const { householdId } = viewer;
	const seen =
		"transactionId" in row
			? sql`exists (select 1 from ${transactions} where ${and(
					eq(transactions.id, row.transactionId),
					visibleTo(viewer),
				)})`
			: undefined;
	const [refunds, matches, onCard] = await Promise.all([
		db
			.selectDistinct({ month: sql<string>`substr(${refundLinks.countsOn}, 1, 7)` })
			.from(refundLinks)
			.where(
				and(
					eq(refundLinks.householdId, householdId),
					"transactionId" in row
						? eq(refundLinks.transactionId, row.transactionId)
						: eq(refundLinks.incomeId, row.incomeId),
					seen,
				),
			),
		db
			.selectDistinct({ month: sql<string>`substr(${paidBackMatches.countsOn}, 1, 7)` })
			.from(paidBackMatches)
			.innerJoin(owedBack, eq(owedBack.id, paidBackMatches.owedBackId))
			.where(
				and(
					eq(paidBackMatches.householdId, householdId),
					"transactionId" in row
						? eq(owedBack.transactionId, row.transactionId)
						: eq(paidBackMatches.incomeId, row.incomeId),
					seen,
				),
			),
		// Money back on a card, linked to the purchase as its Refund (the card Refund table): it
		// counts in its own month, which is the month the purchase is kept for (issue 142).
		"transactionId" in row
			? db
					.selectDistinct({
						month: sql<string>`(select substr(t.date, 1, 7) from transactions t
							where t.id = ${cardRefunds.refundTransactionId})`,
					})
					.from(cardRefunds)
					.where(
						and(
							eq(cardRefunds.householdId, householdId),
							eq(cardRefunds.originalTransactionId, row.transactionId),
							sql`${cardRefunds.removedAt} is null`,
							seen,
						),
					)
			: [],
	]);
	return [
		...new Set([...refunds, ...matches, ...onCard].map((found) => found.month as MonthKey)),
	].sort();
}
