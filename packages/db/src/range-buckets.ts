import type { MonthKey } from "@noodle/domain";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "./index";
import type { Viewer } from "./privacy";
import { buckets } from "./schema";

/**
 * The Buckets in the Plan of any month a Transactions list covers (issue 117), each once, by
 * name: what its Bucket filter offers. `month` alone is that month; with `fromMonth`, every month
 * from it to `month`; with `andEarlier`, every month up to `month`. A Bucket is in a month's Plan
 * from its first month until the month it was archived from. Never the other Parent's Personal
 * Allowance (ADR-0003).
 */
export async function loadBucketsInMonths(
	db: Db,
	viewer: Viewer,
	range: { month: MonthKey; fromMonth?: MonthKey; andEarlier?: boolean },
): Promise<{ id: string; name: string }[]> {
	const first = range.andEarlier ? null : (range.fromMonth ?? range.month);
	return db
		.select({ id: buckets.id, name: buckets.name })
		.from(buckets)
		.where(
			and(
				eq(buckets.householdId, viewer.householdId),
				or(isNull(buckets.ownerMemberId), eq(buckets.ownerMemberId, viewer.memberId)),
				lte(buckets.fromMonth, range.month),
				first === null
					? undefined
					: or(isNull(buckets.archivedFromMonth), gt(buckets.archivedFromMonth, first)),
			),
		)
		.orderBy(sql`${buckets.name} collate nocase`, buckets.id);
}
