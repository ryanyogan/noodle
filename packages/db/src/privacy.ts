import type { DayKey, MonthKey } from "@noodle/domain";
import {
	type AnyColumn,
	and,
	eq,
	gte,
	isNotNull,
	isNull,
	lt,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import type { Db } from "./index";
import { buckets, splits, transactions } from "./schema";
import type { BucketSpend } from "./transactions";

// Personal Allowance privacy (ADR-0003), applied in one place on the server. Every read of
// Transactions is made for a Viewer and filters with `visibleTo` (and Splits with `visibleSplit`),
// so another Parent's Personal Allowance spending (its amounts, notes, dates, For, even its IDs)
// never leaves D1 for them; `privateTotals` is all they learn of it. A split Transaction with
// Splits in another Parent's Personal Allowance shows them only its other Splits, their sum as its
// amount, and no note (`partlyPrivate`). New reads (search, Ask, Insights, Nudges) go through the
// same rules.

/** The Parent a read is made for, in their Household. */
export type Viewer = { householdId: string; memberId: string };

/** The Bucket, given its ID (or a column holding it), is a Personal Allowance of a Parent other than `memberId`. */
export const othersAllowance = (memberId: string, bucketId: AnyColumn | string) =>
	sql`exists (select 1 from ${buckets} where ${buckets.id} = ${bucketId} and ${buckets.ownerMemberId} is not null and ${buckets.ownerMemberId} <> ${memberId})`;

/**
 * For a query over `buckets`: the Bucket takes spending from `memberId`, being a Household
 * Bucket or their own Personal Allowance (canAssign in @noodle/domain).
 */
export const assignableBy = (memberId: string) =>
	or(isNull(buckets.ownerMemberId), eq(buckets.ownerMemberId, memberId));

/** The Split is in a Personal Allowance of a Parent other than `viewer`. */
const privateSplit = (viewer: Viewer) => othersAllowance(viewer.memberId, splits.bucketId);

/** The Household's Splits `viewer` may read one by one: all but those in another Parent's Personal Allowance. */
export const visibleSplit = (viewer: Viewer) =>
	and(eq(splits.householdId, viewer.householdId), sql`not ${privateSplit(viewer)}`) as SQL;

/**
 * The Transaction (of the enclosing query) is split with Splits in another Parent's Personal
 * Allowance: `viewer` reads only its other Splits, their sum as its amount, and not its note.
 */
export const partlyPrivate = (viewer: Viewer) =>
	sql`exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id} and ${privateSplit(viewer)})`;

/** The sum of the enclosing query's Transaction's Splits that `viewer` may read. */
export const visibleSplitsSum = (viewer: Viewer) =>
	sql<number>`(select coalesce(sum(${splits.amountCents}), 0) from ${splits} where ${splits.transactionId} = ${transactions.id} and ${visibleSplit(viewer)})`;

/**
 * The Household's Transactions `viewer` may read one by one: all but those in another Parent's
 * Personal Allowance, whole or through every one of their Splits.
 */
export const visibleTo = (viewer: Viewer) =>
	and(
		eq(transactions.householdId, viewer.householdId),
		sql`not ${othersAllowance(viewer.memberId, transactions.bucketId)}`,
		sql`(not ${partlyPrivate(viewer)} or exists (select 1 from ${splits} where ${splits.transactionId} = ${transactions.id} and ${visibleSplit(viewer)}))`,
	) as SQL;

/**
 * The Household's Transactions `viewer` may change or delete: those they see whole, so none with
 * spending in another Parent's Personal Allowance, even through one Split.
 */
export const changeableBy = (viewer: Viewer) =>
	and(
		eq(transactions.householdId, viewer.householdId),
		sql`not ${othersAllowance(viewer.memberId, transactions.bucketId)}`,
		sql`not ${partlyPrivate(viewer)}`,
	) as SQL;

/** The Household's Transactions in another Parent's Personal Allowance: `viewer` only reads their totals. */
const hiddenFrom = (viewer: Viewer) =>
	and(
		eq(transactions.householdId, viewer.householdId),
		isNotNull(transactions.bucketId),
		othersAllowance(viewer.memberId, transactions.bucketId),
	) as SQL;

/** The ID a private total goes by: its Bucket's and month's, never any Transaction's. */
export const privateTotalId = (bucketId: string, month: MonthKey) => `private:${bucketId}:${month}`;

/**
 * Spending in other Parents' Personal Allowances on days from `from` up to, not including,
 * `until`, whole Transactions and Splits: totals per Bucket per month, for asPrivateSpending.
 * Enough for each Personal Allowance's allowance, spent, and left, and nothing about what it was
 * spent on.
 */
export function privateTotals(db: Db, viewer: Viewer, from: DayKey, until: DayKey) {
	const monthOf = sql<string>`substr(${transactions.date}, 1, 7)`;
	const inRange = and(gte(transactions.date, from), lt(transactions.date, until));
	return [
		db
			.select({
				bucketId: sql<string>`${transactions.bucketId}`,
				month: monthOf,
				amount: sql<number>`sum(${transactions.amountCents})`,
			})
			.from(transactions)
			.where(and(hiddenFrom(viewer), inRange))
			.groupBy(transactions.bucketId, monthOf),
		db
			.select({
				bucketId: sql<string>`${splits.bucketId}`,
				month: monthOf,
				amount: sql<number>`sum(${splits.amountCents})`,
			})
			.from(splits)
			.innerJoin(transactions, eq(transactions.id, splits.transactionId))
			.where(
				and(
					eq(splits.householdId, viewer.householdId),
					eq(transactions.householdId, viewer.householdId),
					privateSplit(viewer),
					inRange,
				),
			)
			.groupBy(splits.bucketId, monthOf),
	] as const;
}

type PrivateTotal = { bucketId: string; month: string; amount: number };

/**
 * Private totals as spending: one per Bucket per month, whole Transactions and Splits together,
 * each dated its month's first day and For the whole Household.
 */
export function asPrivateSpending(...totals: PrivateTotal[][]): BucketSpend[] {
	const byId = new Map<string, BucketSpend>();
	for (const { bucketId, month, amount } of totals.flat()) {
		const id = privateTotalId(bucketId, month as MonthKey);
		const total = byId.get(id);
		byId.set(id, {
			id,
			bucketId,
			amount: (total?.amount ?? 0) + amount,
			date: `${month}-01` as DayKey,
			for: [],
		});
	}
	return [...byId.values()];
}
