import type { Cents, MonthKey, Sweep } from "@noodle/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { insertExtraIncomeMove } from "./extra-income";
import type { Db } from "./index";
import { bucketInPlan, bucketLeftSql } from "./moves";
import { buckets, households, monthCloses, moves } from "./schema";

// Month-close: the Sweeps and Windfall Moves decided for a month that has ended, written in one
// batch together with the month's `month_closes` row, and only while it has none (ADR-0004), so
// the Parents' decision and the defaults applied on timeout can never both land.

/** A Sweep with its ID. */
export type PlanSweep = Sweep & { id: string };

/** The month's Sweeps, oldest first. */
export async function loadSweeps(
	db: Db,
	householdId: string,
	month: MonthKey,
): Promise<PlanSweep[]> {
	const rows = await db
		.select({
			id: moves.id,
			bucketId: moves.fromBucketId,
			goalId: moves.toGoalId,
			amount: moves.amountCents,
			month: moves.month,
		})
		.from(moves)
		.where(and(eq(moves.householdId, householdId), eq(moves.month, month), eq(moves.kind, "sweep")))
		.orderBy(moves.id);
	// A Sweep always has both, and months are always written as MonthKeys.
	return rows as PlanSweep[];
}

/** How a month was closed: by a Parent, or by the defaults (`decidedBy` null). */
export type MonthCloseRecord = { decidedBy: string | null };

/** Whether (and how) the month has been closed; null while it hasn't. */
export async function loadMonthClose(
	db: Db,
	householdId: string,
	month: MonthKey,
): Promise<MonthCloseRecord | null> {
	const [row] = await db
		.select({ decidedBy: monthCloses.decidedByMemberId })
		.from(monthCloses)
		.where(and(eq(monthCloses.householdId, householdId), eq(monthCloses.month, month)));
	return row ?? null;
}

/** Every Household and its time zone, for starting each one's month-close. */
export function listHouseholds(db: Db): Promise<{ id: string; timeZone: string }[]> {
	return db.select({ id: households.id, timeZone: households.timeZone }).from(households);
}

/** The Household's emergency Goal, where leftovers are Swept by default; null without one. */
export async function loadEmergencyGoalId(db: Db, householdId: string): Promise<string | null> {
	const [row] = await db
		.select({ id: households.emergencyGoalId })
		.from(households)
		.where(eq(households.id, householdId));
	return row?.id ?? null;
}

export type MonthCloseResult = { ok: true } | { ok: false; reason: "already-closed" };

export type CloseMonthInput = {
	householdId: string;
	closeId: string;
	month: MonthKey;
	/** Null when the defaults are applied because nobody decided. */
	decidedByMemberId: string | null;
	sweeps: {
		moveId: string;
		bucketId: string;
		goalId: string;
		amountCents: Cents;
		/** What rolled into the Bucket from the month before (see rolledOver in @noodle/domain). */
		rolledOverCents: Cents;
	}[];
	windfall: { moveId: string; goalId: string; amountCents: Cents }[];
};

/**
 * Closes `month` with a decision: its Sweeps and Windfall Moves, and the `month_closes` row, in
 * one atomic batch. Every Move lands only while the month isn't closed yet, and each is guarded
 * as it would be alone: a Sweep only from a Household Bucket that is Fresh-start that month and
 * still has the amount left, into an active Goal of the Household's; a Windfall Move as in
 * decideWindfall. Idempotent per `closeId`; refused when the month was already closed otherwise.
 */
export async function closeMonth(db: Db, input: CloseMonthInput): Promise<MonthCloseResult> {
	const { householdId, month, decidedByMemberId } = input;
	const open = sql`not exists (select 1 from month_closes c
		where c.household_id = ${householdId} and c.month = ${month})`;
	const activeGoal = (goalId: string) =>
		sql`exists (select 1 from goals g where g.id = ${goalId} and g.household_id = ${householdId}
			and g.completed_at is null and g.archived_at is null)`;
	const resetsMonthly = sql`coalesce((select r.rolling from bucket_rolling r
		where r.bucket_id = ${buckets.id} and r.month <= ${month}
		order by r.month desc limit 1), 0) = 0`;
	const sweeps = input.sweeps.map((sweep) =>
		db
			.insert(moves)
			.select(
				db
					.select({
						// Selected in the table's column order: insert … select is positional.
						id: sql<string>`${sweep.moveId}`.as("id"),
						householdId: buckets.householdId,
						kind: sql<"sweep">`'sweep'`.as("kind"),
						month: sql<string>`${month}`.as("month"),
						fromBucketId: buckets.id,
						toBucketId: sql<string | null>`null`.as("to_bucket_id"),
						amountCents: sql<number>`${sweep.amountCents}`.as("amount_cents"),
						createdByMemberId: sql<string | null>`${decidedByMemberId}`.as("created_by_member_id"),
						createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
						toGoalId: sql<string>`${sweep.goalId}`.as("to_goal_id"),
					})
					.from(buckets)
					.where(
						and(
							bucketInPlan(householdId, sweep.bucketId, month),
							isNull(buckets.ownerMemberId),
							resetsMonthly,
							sql`${bucketLeftSql(householdId, sweep.bucketId, month, sweep.rolledOverCents)} >= ${sweep.amountCents}`,
							activeGoal(sweep.goalId),
							open,
						),
					),
			)
			.onConflictDoNothing({ target: moves.id }),
	);
	const extraIncome = input.windfall.map((w) =>
		insertExtraIncomeMove(
			db,
			{
				householdId,
				moveId: w.moveId,
				month,
				to: { kind: "goal", goalId: w.goalId },
				amountCents: w.amountCents,
				createdByMemberId: decidedByMemberId,
			},
			open,
		),
	);
	const close = db
		.insert(monthCloses)
		.values({ id: input.closeId, householdId, month, decidedByMemberId })
		.onConflictDoNothing();
	// The row goes last: every Move before it checks that the month isn't closed yet.
	const batch: BatchItem<"sqlite">[] = [...sweeps, ...extraIncome, close];
	await db.batch(batch as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
	const [row] = await db
		.select({ id: monthCloses.id })
		.from(monthCloses)
		.where(and(eq(monthCloses.householdId, householdId), eq(monthCloses.month, month)));
	return row?.id === input.closeId ? { ok: true } : { ok: false, reason: "already-closed" };
}
