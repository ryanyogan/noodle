import { type AnyColumn, type SQL, sql } from "drizzle-orm";
import { matches, transactions } from "./schema";

// Which Transactions count as spending. One rule, used by every read that totals spending (the
// month's spending, rollover, Cover guards, Commitment charges, Goal spending, bucket uses and
// private totals):
// - A Match counts once, as its Quick Add: the Quick Add keeps its amount, assignment, Splits and
//   For, and the imported copy counts nowhere. The copy isn't listed on its own either (privacy.ts
//   leaves it out of visibleTo); it's shown through its Quick Add.

/** The Transaction (a column holding its ID) is the imported copy in a Match. */
export const matchedCopy = (id: AnyColumn = transactions.id) =>
	sql`exists (select 1 from ${matches} where ${matches.importedId} = ${id} and ${matches.removedAt} is null)`;

/** The Transaction (a column holding its ID) counts as spending. */
export const counts = (id: AnyColumn = transactions.id): SQL => sql`not ${matchedCopy(id)}`;

/** `counts` for raw SQL that names the Transaction's ID column as `id` (e.g. `t.id`). */
export const countsRaw = (id: string) =>
	`not exists (select 1 from matches where matches.imported_id = ${id} and matches.removed_at is null)`;
