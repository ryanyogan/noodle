import { and, eq, type SQL, sql } from "drizzle-orm";
import type { Db } from "./index";
import { categorizations, transactions } from "./schema";

// Who took a Transaction out of Review (issue 142). Filing one deletes categorization's marker,
// which is all that said it waited, so the Parent is noted on the Transaction itself, in the same
// batch and BEFORE that delete: only a Transaction that still waits there is noted.

/**
 * A statement noting `memberId` as the Parent who cleared from Review each of the Household's
 * Transactions `which` is true of, while it still waits there. Run it in the filing's own batch,
 * before the statement that deletes the marker.
 */
export function reviewCleared(
	db: Db,
	householdId: string,
	memberId: string,
	which: SQL | undefined,
) {
	return db
		.update(transactions)
		.set({ reviewClearedByMemberId: memberId, reviewClearedAt: sql`(unixepoch() * 1000)` })
		.where(
			and(
				eq(transactions.householdId, householdId),
				which,
				sql`exists (select 1 from ${categorizations} where ${categorizations.transactionId} = ${transactions.id}
					and ${categorizations.householdId} = ${transactions.householdId} and ${categorizations.outcome} = 'review')`,
			),
		);
}
