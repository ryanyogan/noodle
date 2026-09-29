import {
	type Cents,
	type MonthKey,
	type MonthlySpend,
	type PlanRecords,
	rolledOver,
	rolloverSince,
} from "@noodle/domain";
import { and, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { counts } from "./counting";
import type { Db } from "./index";
import { loadMovesBetween } from "./moves";
import { splits, transactions } from "./schema";

/**
 * What each Bucket carries into `month` from earlier months (see rolledOver in @noodle/domain),
 * from each earlier month's spending totals (whole Transactions and Splits) and Moves. Reads no history when no Bucket was
 * Rolling before `month`. `records` must include every Plan record before `month`.
 */
export async function loadRolledOver(
	db: Db,
	householdId: string,
	records: PlanRecords,
	month: MonthKey,
): Promise<Record<string, Cents>> {
	const since = rolloverSince(records, month);
	if (since === null) return {};
	const monthOf = sql<string>`substr(${transactions.date}, 1, 7)`;
	const inHistory = and(
		eq(transactions.householdId, householdId),
		gte(transactions.date, `${since}-01`),
		lt(transactions.date, `${month}-01`),
		counts(),
	);
	const [spent, splitSpent, moves] = await Promise.all([
		db
			.select({
				bucketId: transactions.bucketId,
				month: monthOf,
				amount: sql<number>`sum(${transactions.amountCents})`,
			})
			.from(transactions)
			.where(and(inHistory, isNotNull(transactions.bucketId)))
			.groupBy(transactions.bucketId, monthOf),
		// A split Transaction spends from each of its Splits' Buckets instead.
		db
			.select({
				bucketId: splits.bucketId,
				month: monthOf,
				amount: sql<number>`sum(${splits.amountCents})`,
			})
			.from(splits)
			.innerJoin(transactions, eq(transactions.id, splits.transactionId))
			.where(and(inHistory, eq(splits.householdId, householdId), isNotNull(splits.bucketId)))
			.groupBy(splits.bucketId, monthOf),
		loadMovesBetween(db, householdId, since, month),
	]);
	// bucket_id is filtered to non-null, and dates are always written as DayKeys.
	return rolledOver({ records, spent: [...spent, ...splitSpent] as MonthlySpend[], moves, month });
}
