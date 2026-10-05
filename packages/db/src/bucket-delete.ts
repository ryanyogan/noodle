import type { MonthKey } from "@noodle/domain";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "./index";
import {
	bucketAllowances,
	bucketRolling,
	buckets,
	categorizations,
	moves,
	planChanges,
	rules,
	splits,
	transactions,
} from "./schema";

// Deleting a Bucket (issue 98). A Bucket normally leaves the Plan by being archived: earlier
// months keep it, and so does everything filed in it (ADR-0009). One that nothing ever pointed at
// (added by mistake, a starter nobody used) can go for good instead, as if it had never been
// added. What stops that is named, so the sheet can say why it offers Archive only.

/**
 * Why a Bucket can't be deleted, most telling first:
 * - `personal-allowance`: it is a Parent's own; it stays, set to $0.
 * - `earlier-months`: it was in the Plan of a month before this one, which would change.
 * - `spending`: a Transaction or a Split is filed in it.
 * - `moves`: money was Moved in or out of it (a Cover, a Sweep, Extra income).
 * - `rules`: a Rule files into it.
 */
export const BUCKET_DELETE_BLOCKERS = [
	"personal-allowance",
	"earlier-months",
	"spending",
	"moves",
	"rules",
] as const;
export type BucketDeleteBlocker = (typeof BUCKET_DELETE_BLOCKERS)[number];

type Target = { householdId: string; bucketId: string };

const one = sql<number>`1`.as("one");

/**
 * What stops the Bucket being deleted, as of `thisMonth` (the month it is now for the Household);
 * empty when it can be. Null when the Household has no such Bucket.
 */
export async function bucketDeleteBlockers(
	db: Db,
	{ householdId, bucketId, thisMonth }: Target & { thisMonth: MonthKey },
): Promise<BucketDeleteBlocker[] | null> {
	const [found, filed, split, moved, ruled] = await db.batch([
		db
			.select({ owner: buckets.ownerMemberId, fromMonth: buckets.fromMonth })
			.from(buckets)
			.where(and(eq(buckets.id, bucketId), eq(buckets.householdId, householdId))),
		db.select({ one }).from(transactions).where(eq(transactions.bucketId, bucketId)).limit(1),
		db.select({ one }).from(splits).where(eq(splits.bucketId, bucketId)).limit(1),
		db
			.select({ one })
			.from(moves)
			.where(or(eq(moves.fromBucketId, bucketId), eq(moves.toBucketId, bucketId)))
			.limit(1),
		db.select({ one }).from(rules).where(eq(rules.bucketId, bucketId)).limit(1),
	]);
	const bucket = found[0];
	if (!bucket) return null;
	const stops: Record<BucketDeleteBlocker, boolean> = {
		"personal-allowance": bucket.owner !== null,
		"earlier-months": bucket.fromMonth < thisMonth,
		spending: filed.length > 0 || split.length > 0,
		moves: moved.length > 0,
		rules: ruled.length > 0,
	};
	return BUCKET_DELETE_BLOCKERS.filter((blocker) => stops[blocker]);
}

/**
 * Deletes a Bucket nothing points at: the Bucket, its allowances, whether it carries over and its
 * own Plan changes go, and a Review guess that named it is left without one. Anything else is left
 * exactly as it is and the blockers are returned: that Bucket is archived instead. Every statement
 * carries the whole condition, so a Transaction filed between the check and the delete keeps the
 * Bucket.
 */
export async function deleteBucket(
	db: Db,
	input: Target & { thisMonth: MonthKey },
): Promise<{ deleted: boolean; blockers: BucketDeleteBlocker[] }> {
	const blockers = await bucketDeleteBlockers(db, input);
	if (blockers === null || blockers.length > 0) return { deleted: false, blockers: blockers ?? [] };
	const { householdId, bucketId, thisMonth } = input;
	const untouched = sql`not exists (select 1 from ${transactions} where ${transactions.bucketId} = ${bucketId})
		and not exists (select 1 from ${splits} where ${splits.bucketId} = ${bucketId})
		and not exists (select 1 from ${moves} where ${moves.fromBucketId} = ${bucketId} or ${moves.toBucketId} = ${bucketId})
		and not exists (select 1 from ${rules} where ${rules.bucketId} = ${bucketId})`;
	const deletable = and(
		eq(buckets.id, bucketId),
		eq(buckets.householdId, householdId),
		isNull(buckets.ownerMemberId),
		sql`${buckets.fromMonth} >= ${thisMonth}`,
		untouched,
	);
	const stillDeletable = sql`exists (select 1 from ${buckets} where ${deletable})`;
	const [, , , , gone] = await db.batch([
		db
			.update(categorizations)
			.set({ bucketId: null })
			.where(
				and(
					eq(categorizations.householdId, householdId),
					eq(categorizations.bucketId, bucketId),
					stillDeletable,
				),
			),
		db
			.delete(planChanges)
			.where(
				and(
					eq(planChanges.householdId, householdId),
					eq(planChanges.targetId, bucketId),
					stillDeletable,
				),
			),
		db.delete(bucketAllowances).where(and(eq(bucketAllowances.bucketId, bucketId), stillDeletable)),
		db.delete(bucketRolling).where(and(eq(bucketRolling.bucketId, bucketId), stillDeletable)),
		db.delete(buckets).where(deletable).returning({ id: buckets.id }),
	]);
	return { deleted: gone.length > 0, blockers: [] };
}
