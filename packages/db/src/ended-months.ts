import { type DayKey, monthOfDay } from "@noodle/domain";
import { type AnyColumn, type SQL, sql } from "drizzle-orm";
import { transactions } from "./schema";

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
 * that has ended.
 */
export const purchaseEndedRestores = (
	from: DayKey,
	id: AnyColumn | SQL | string = transactions.id,
): SQL =>
	sql`(exists (select 1 from paid_back_matches em join owed_back eo on eo.id = em.owed_back_id
			where eo.transaction_id = ${id} and em.counts_on < ${from})
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
