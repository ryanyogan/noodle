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

/** The income row (a column holding its ID) counts as income: it didn't arrive by Transfer. */
export const incomeCounts = (id: AnyColumn = income.id): SQL =>
	sql`not exists (select 1 from ${transfers} where ${transfers.inIncomeId} = ${id} and ${transfers.removedAt} is null)`;

/** `incomeCounts` for raw SQL that names the income row's ID column as `id` (e.g. `i.id`). */
export const incomeCountsRaw = (id: string) =>
	`not exists (select 1 from transfers where transfers.in_income_id = ${id} and transfers.removed_at is null)`;
