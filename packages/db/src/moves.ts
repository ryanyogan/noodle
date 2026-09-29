import { addMonths, type Cents, daysInMonth, type MonthKey, type Move } from "@noodle/domain";
import { and, eq, gt, gte, isNotNull, isNull, lt, lte, or, type SQL, sql } from "drizzle-orm";
import type { Db } from "./index";
import { assignableBy, othersAllowance } from "./privacy";
import { buckets, moves } from "./schema";

// Moves of planned money within a month's Plan (ADR-0004: appended rows, never a stored balance
// read, changed, and written back). Every query is scoped by household_id; IDs from the client
// are only ever used together with it.

/** A Move with its ID. */
export type PlanMove = Move & { id: string };

/** The month's Moves between Buckets and Free to Spend, oldest first (Goal funding is apart). */
export function loadMoves(db: Db, householdId: string, month: MonthKey): Promise<PlanMove[]> {
	return loadMovesBetween(db, householdId, month, addMonths(month, 1));
}

/** Moves between Buckets and Free to Spend in months from `from` up to, not including, `until`. */
export async function loadMovesBetween(
	db: Db,
	householdId: string,
	from: MonthKey,
	until: MonthKey,
): Promise<PlanMove[]> {
	const rows = await db
		.select({
			id: moves.id,
			fromBucketId: moves.fromBucketId,
			toBucketId: moves.toBucketId,
			amount: moves.amountCents,
			month: moves.month,
		})
		.from(moves)
		.where(
			and(
				eq(moves.householdId, householdId),
				gte(moves.month, from),
				lt(moves.month, until),
				isNotNull(moves.toBucketId),
			),
		)
		.orderBy(moves.id);
	// to_bucket_id is filtered to non-null, and months are always written as MonthKeys.
	return rows as PlanMove[];
}

// What a Move's source has left this month, computed from the rows inside the write that
// depends on it, so a concurrent write by the other Parent can't make it wrong. These mirror
// monthState and freeToSpend in @noodle/domain (and moves.test.ts holds them to it), except
// that they count Moves to or from a Bucket archived this month, which the domain ignores: a
// rare case where the guard errs on refusing.

/** Moves this month into (`to_bucket_id`) or out of (`from_bucket_id`) a Bucket, by SQL expression. */
const movedSql = (
	householdId: string,
	month: MonthKey,
	side: "to_bucket_id" | "from_bucket_id",
	bucketId: SQL,
) => sql`coalesce((select sum(m.amount_cents) from moves m
	where m.household_id = ${householdId} and m.month = ${month}
	and m.${sql.raw(side)} = ${bucketId}), 0)`;

/** A Bucket's allowance in force for `month`, by SQL expression for its ID. */
const allowanceSql = (month: MonthKey, bucketId: SQL) =>
	sql`coalesce((select a.amount_cents from bucket_allowances a
	where a.bucket_id = ${bucketId} and a.month <= ${month}
	order by a.month desc limit 1), 0)`;

/** Whether the Bucket aliased `alias` is in the Plan for `month`. */
const inPlanSql = (alias: string, month: MonthKey) =>
	sql`${sql.raw(alias)}.from_month <= ${month} and (${sql.raw(alias)}.archived_from_month is null or ${sql.raw(alias)}.archived_from_month > ${month})`;

/**
 * What a Bucket has left this month; null when it isn't the Household's or isn't in the Plan.
 * What rolled into it from last month is given as a constant, since it depends only on earlier
 * months, and those are closed.
 */
export function bucketLeftSql(
	householdId: string,
	bucketId: string,
	month: MonthKey,
	rolledOverCents: Cents = 0,
): SQL {
	const id = sql`s.id`;
	return sql`(select ${allowanceSql(month, id)} + ${rolledOverCents}
		+ ${movedSql(householdId, month, "to_bucket_id", id)}
		- ${movedSql(householdId, month, "from_bucket_id", id)}
		- coalesce((select sum(t.amount_cents) from transactions t
			where t.household_id = ${householdId} and t.bucket_id = s.id
			and t.date >= ${`${month}-01`} and t.date <= ${`${month}-31`}), 0)
		- coalesce((select sum(p.amount_cents) from splits p
			join transactions t on t.id = p.transaction_id
			where p.household_id = ${householdId} and p.bucket_id = s.id
			and t.date >= ${`${month}-01`} and t.date <= ${`${month}-31`}), 0)
		from buckets s
		where s.id = ${bucketId} and s.household_id = ${householdId} and ${inPlanSql("s", month)})`;
}

/**
 * What the Household's Commitments are expected to take in `month`: each one's amount on the
 * terms in force, times how often it's due (see dueDatesIn in @noodle/domain).
 */
function committedSql(householdId: string, month: MonthKey): SQL {
	const first = `${month}-01`;
	// Days from the 1st to the next biweekly due date on or after it.
	const offset = sql`((cast(julianday(t.due_date) - julianday(${first}) as integer) % 14) + 14) % 14`;
	return sql`coalesce((select sum(t.amount_cents * case t.cadence
			when 'monthly' then 1
			when 'annual' then substr(t.due_date, 6, 2) = ${month.slice(5, 7)}
			else cast((${daysInMonth(month)} - ${offset} + 13) / 14 as integer)
		end)
		from commitments c
		join commitment_terms t on t.commitment_id = c.id and t.month = (
			select max(l.month) from commitment_terms l where l.commitment_id = c.id and l.month <= ${month})
		where c.household_id = ${householdId} and c.from_month <= ${month}
		and (c.ended_from_month is null or c.ended_from_month > ${month})), 0)`;
}

/** Free to Spend this month: the Baseline less Commitments, allowances, and Moves out of it. */
export function freeToSpendSql(householdId: string, month: MonthKey): SQL {
	return sql`(coalesce((select b.amount_cents from baselines b
			where b.household_id = ${householdId} and b.month <= ${month}
			order by b.month desc limit 1), 0)
		- ${committedSql(householdId, month)}
		- coalesce((select sum(${allowanceSql(month, sql`p.id`)}) from buckets p
			where p.household_id = ${householdId} and ${inPlanSql("p", month)}), 0)
		- coalesce((select sum(m.amount_cents) from moves m
			where m.household_id = ${householdId} and m.month = ${month}
			and m.from_bucket_id is null), 0))`;
}

/** Guards a write to only land if the Bucket belongs to the Household and is in `month`'s Plan. */
const bucketInPlan = (householdId: string, bucketId: string, month: MonthKey) =>
	and(
		eq(buckets.id, bucketId),
		eq(buckets.householdId, householdId),
		lte(buckets.fromMonth, month),
		or(isNull(buckets.archivedFromMonth), gt(buckets.archivedFromMonth, month)),
	);

export type CoverResult = { ok: true } | { ok: false; reason: "refused" };

/**
 * Records a Cover: `amountCents` Moved to an overspent Bucket from another Bucket, or from Free
 * to Spend when `fromBucketId` is null. Idempotent per `moveId`. It is only written if, at write
 * time, both are the Household's and in `month`'s Plan and the source still has at least
 * `amountCents` left.
 */
export async function addCover(
	db: Db,
	input: {
		householdId: string;
		moveId: string;
		month: MonthKey;
		fromBucketId: string | null;
		toBucketId: string;
		amountCents: Cents;
		/** What rolled into the source Bucket from last month (see rolledOver in @noodle/domain). */
		fromRolledOverCents?: Cents;
		createdByMemberId: string;
	},
): Promise<CoverResult> {
	const { householdId, month, fromBucketId } = input;
	const sourceLeft =
		fromBucketId === null
			? freeToSpendSql(householdId, month)
			: bucketLeftSql(householdId, fromBucketId, month, input.fromRolledOverCents);
	await db
		.insert(moves)
		.select(
			db
				.select({
					id: sql<string>`${input.moveId}`.as("id"),
					householdId: buckets.householdId,
					kind: sql<"cover">`'cover'`.as("kind"),
					month: sql<string>`${month}`.as("month"),
					fromBucketId: sql<string | null>`${fromBucketId}`.as("from_bucket_id"),
					toBucketId: buckets.id,
					amountCents: sql<number>`${input.amountCents}`.as("amount_cents"),
					createdByMemberId: sql<string>`${input.createdByMemberId}`.as("created_by_member_id"),
					createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
					// Selected in the table's column order: insert … select is positional.
					toGoalId: sql<string | null>`null`.as("to_goal_id"),
				})
				.from(buckets)
				.where(
					and(
						bucketInPlan(householdId, input.toBucketId, month),
						// The other Parent's Personal Allowance is theirs to Cover, and to Cover from.
						assignableBy(input.createdByMemberId),
						fromBucketId === null
							? undefined
							: sql`${buckets.id} <> ${fromBucketId} and not ${othersAllowance(input.createdByMemberId, fromBucketId)}`,
						sql`${sourceLeft} >= ${input.amountCents}`,
					),
				),
		)
		.onConflictDoNothing({ target: moves.id });
	// Either this call or an earlier attempt with the same ID wrote it, or it was refused.
	const [written] = await db
		.select({ id: moves.id })
		.from(moves)
		.where(and(eq(moves.id, input.moveId), eq(moves.householdId, householdId)));
	return written ? { ok: true } : { ok: false, reason: "refused" };
}

/**
 * Undoes a Move to a Bucket in `month` by removing it. Undoing one already undone changes
 * nothing. Goal funding is undone with undoGoalFunding, which guards the Goal's Earmark.
 */
export async function undoMove(
	db: Db,
	input: { householdId: string; moveId: string; month: MonthKey },
): Promise<void> {
	await db
		.delete(moves)
		.where(
			and(
				eq(moves.id, input.moveId),
				eq(moves.householdId, input.householdId),
				eq(moves.month, input.month),
				isNotNull(moves.toBucketId),
			),
		);
}
