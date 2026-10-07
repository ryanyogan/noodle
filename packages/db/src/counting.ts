import { type AnyColumn, type SQL, sql } from "drizzle-orm";
import { income, matches, transactions, transfers } from "./schema";

// Which Transactions count as spending. One rule, used by every read that totals spending (the
// month's spending, rollover, Cover guards, Commitment charges, Goal spending, bucket uses and
// private totals):
// - A Match counts once, as its Quick Add: the Quick Add keeps its amount, assignment, Splits and
//   For, and the imported copy counts nowhere. The copy isn't listed on its own either (privacy.ts
//   leaves it out of visibleTo); it's shown through its Quick Add.
// - A Transfer counts as neither spending nor income: its money only moved between the
//   Household's own Accounts. Both sides stay listed (as a Transfer) but count nowhere, whatever
//   they're assigned to; income that arrived by Transfer isn't income (incomeCounts).
// - A Refund counts as spending in reverse: linked to its purchase, the money back carries the
//   purchase's assignment, so it adds back to that Bucket in the month it lands. Money back that
//   is neither is unassigned, so it counts nowhere until a Parent says what it is.

/** The Transaction (a column holding its ID) is the imported copy in a Match. */
export const matchedCopy = (id: AnyColumn = transactions.id) =>
	sql`exists (select 1 from ${matches} where ${matches.importedId} = ${id} and ${matches.removedAt} is null)`;

/** The Transaction (a column holding its ID) is a side of a Transfer. */
export const inTransfer = (id: AnyColumn = transactions.id) =>
	sql`exists (select 1 from ${transfers} where (${transfers.outTransactionId} = ${id} or ${transfers.inTransactionId} = ${id}) and ${transfers.removedAt} is null)`;

/** The Transaction (a column holding its ID) counts as spending. */
export const counts = (id: AnyColumn = transactions.id): SQL =>
	sql`not ${matchedCopy(id)} and not ${inTransfer(id)}`;

/** `counts` for raw SQL that names the Transaction's ID column as `id` (e.g. `t.id`). */
export const countsRaw = (id: string) =>
	`not exists (select 1 from matches where matches.imported_id = ${id} and matches.removed_at is null)
	and not exists (select 1 from transfers where (transfers.out_transaction_id = ${id}
		or transfers.in_transaction_id = ${id}) and transfers.removed_at is null)`;

/** The income row (a column holding its ID) is the arriving side of a Transfer. */
export const incomeInTransfer = (id: AnyColumn = income.id): SQL =>
	sql`exists (select 1 from ${transfers} where ${transfers.inIncomeId} = ${id} and ${transfers.removedAt} is null)`;

/**
 * The income row (a column holding its ID) counts as Income (ADR-0057): it didn't arrive by
 * Transfer (which covers Between us), it isn't a Refund or Paid back, and it isn't waiting in
 * Review for a Parent to say its kind.
 */
export const incomeCounts = (id: AnyColumn = income.id): SQL =>
	sql`(not ${incomeInTransfer(id)} and not exists (select 1 from income mk where mk.id = ${id}
		and (mk.kind is not null or mk.needs_review = 1)))`;

/** `incomeCounts` for raw SQL that names the income row's ID column as `id` (e.g. `i.id`). */
export const incomeCountsRaw = (id: string) =>
	`(not exists (select 1 from transfers where transfers.in_income_id = ${id} and transfers.removed_at is null)
	and not exists (select 1 from income mk where mk.id = ${id} and (mk.kind is not null or mk.needs_review = 1)))`;

// Paid back (ADR-0058) counts as spending in reverse too, though its money is a row in `income`:
// each confirmed match gives its amount back to the Bucket, Commitment or Goal its purchase is
// filed in, on the match's `counts_on` day. The purchase's month is never touched.

/**
 * The FROM of every read of what Paid back restores, in raw SQL: one row (`m`) per match, with
 * its Owed back item's purchase and Split, and per Refund in checking linked to its purchase
 * (refund-links.ts), which restores the same way; the purchase (`t`) and, when the purchase is
 * split, the Split it restores (`p`: the one the item names, else the largest). `m.split_id` is
 * only named in a `where`: SQLite before 3.52 can't find an outer row from the `order by` of a
 * subquery here ("no such column").
 */
export const PAID_BACK_RESTORES_FROM = `(select pm.household_id, pm.amount_cents, pm.counts_on,
			ob.transaction_id, ob.split_id
		from paid_back_matches pm join owed_back ob on ob.id = pm.owed_back_id
		union all
		select rl.household_id, ri.amount_cents, rl.counts_on, rl.transaction_id, null
		from refund_links rl join income ri on ri.id = rl.income_id) m
	join transactions t on t.id = m.transaction_id
	left join splits p on p.id = coalesce(
		(select q.id from splits q where q.transaction_id = t.id and q.id = m.split_id),
		(select q.id from splits q where q.transaction_id = t.id
			order by q.amount_cents desc, q.position limit 1))`;

/** With PAID_BACK_RESTORES_FROM: the Bucket, Commitment or Goal (`column`) a match restores. */
export const paidBackRestoresRaw = (column: "bucket_id" | "commitment_id" | "goal_id") =>
	`(case when p.id is null then t.${column} else p.${column} end)`;

/**
 * What was Paid back into the Bucket `bucketId` (SQL giving its ID) on days from `from` through
 * `to`, as a positive sum.
 */
export const paidBackToBucketSql = (householdId: string, bucketId: SQL, from: string, to: string) =>
	sql`coalesce((select sum(m.amount_cents) from ${sql.raw(PAID_BACK_RESTORES_FROM)}
		where m.household_id = ${householdId}
		and ${sql.raw(paidBackRestoresRaw("bucket_id"))} = ${bucketId}
		and m.counts_on >= ${from} and m.counts_on <= ${to} and ${sql.raw(countsRaw("t.id"))}), 0)`;
