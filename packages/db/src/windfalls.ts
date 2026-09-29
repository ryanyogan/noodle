import type { Cents, DayKey, MonthKey, WindfallDestination } from "@noodle/domain";
import { addMonths } from "@noodle/domain";
import { and, eq, gte, isNull, lt, type SQL, sql } from "drizzle-orm";
import { earmarkSql } from "./goals";
import type { Db } from "./index";
import { bucketInPlan } from "./moves";
import { assignableBy } from "./privacy";
import { buckets, goals, income, moves } from "./schema";

// Income, and Windfall Moves: income beyond a month's Baseline Moved deliberately to a Goal or a
// Bucket (ADR-0001), never silently into Free to Spend. Every query is scoped by household_id.

/** Income with its ID and note. */
export type IncomeRecord = { id: string; amount: Cents; date: DayKey; note: string | null };

/** Income received in months from `from` up to, not including, `until`, oldest first. */
export async function loadIncome(
	db: Db,
	householdId: string,
	from: MonthKey,
	until: MonthKey,
): Promise<IncomeRecord[]> {
	const rows = await db
		.select({ id: income.id, amount: income.amountCents, date: income.date, note: income.note })
		.from(income)
		.where(
			and(
				eq(income.householdId, householdId),
				gte(income.date, `${from}-01`),
				lt(income.date, `${until}-01`),
			),
		)
		.orderBy(income.date, income.id);
	// Dates are always written as DayKeys.
	return rows as IncomeRecord[];
}

/** Records income a Parent received. Idempotent per `incomeId`. */
export async function addIncome(
	db: Db,
	input: {
		householdId: string;
		incomeId: string;
		date: DayKey;
		amountCents: Cents;
		note: string | null;
		createdByMemberId: string;
	},
): Promise<void> {
	await db
		.insert(income)
		.values({
			id: input.incomeId,
			householdId: input.householdId,
			date: input.date,
			amountCents: input.amountCents,
			note: input.note,
			createdByMemberId: input.createdByMemberId,
		})
		.onConflictDoNothing({ target: income.id });
}

// A month's Windfall, computed from the rows inside the write that depends on it, so a
// concurrent write by the other Parent can't make it wrong. Mirrors windfallOf in @noodle/domain
// (windfalls.test.ts holds it to it).

const receivedSql = (householdId: string, month: MonthKey) =>
	sql`coalesce((select sum(i.amount_cents) from income i
		where i.household_id = ${householdId}
		and i.date >= ${`${month}-01`} and i.date < ${`${addMonths(month, 1)}-01`}), 0)`;

const baselineSql = (householdId: string, month: MonthKey) =>
	sql`(select b.amount_cents from baselines b
		where b.household_id = ${householdId} and b.month <= ${month}
		order by b.month desc limit 1)`;

const decidedSql = (householdId: string, month: MonthKey) =>
	sql`coalesce((select sum(m.amount_cents) from moves m
		where m.household_id = ${householdId} and m.month = ${month} and m.kind = 'windfall'), 0)`;

/** The month's income beyond its Baseline; 0 without a Baseline. */
const windfallSql = (householdId: string, month: MonthKey, lessReceived: SQL | Cents = 0) =>
	sql`coalesce(max(0, ${receivedSql(householdId, month)} - ${lessReceived} - ${baselineSql(householdId, month)}), 0)`;

/** What's left of the month's Windfall to decide. */
export function windfallLeftSql(householdId: string, month: MonthKey): SQL {
	return sql`(${windfallSql(householdId, month)} - ${decidedSql(householdId, month)})`;
}

export type IncomeWriteResult = { ok: true } | { ok: false; reason: "refused" };

/**
 * Removes income recorded by mistake. Refused while what's already been decided of its month's
 * Windfall would no longer be covered without it. Removing it twice changes nothing.
 */
export async function removeIncome(
	db: Db,
	input: { householdId: string; incomeId: string; month: MonthKey },
): Promise<IncomeWriteResult> {
	const { householdId, month } = input;
	const own = and(
		eq(income.id, input.incomeId),
		eq(income.householdId, householdId),
		gte(income.date, `${month}-01`),
		lt(income.date, `${addMonths(month, 1)}-01`),
	);
	await db
		.delete(income)
		.where(
			and(
				own,
				sql`${windfallSql(householdId, month, sql.raw("income.amount_cents"))} >= ${decidedSql(householdId, month)}`,
			),
		);
	const [left] = await db.select({ id: income.id }).from(income).where(own);
	return left ? { ok: false, reason: "refused" } : { ok: true };
}

/**
 * Moves `amountCents` of `month`'s Windfall to a Goal's Earmark or a Bucket. Idempotent per
 * `moveId`. Refused unless, at write time, the Windfall still has that much left, and the Goal is
 * the Household's and active, or the Bucket is in the month's Plan and isn't the other Parent's
 * Personal Allowance.
 */
export async function decideWindfall(
	db: Db,
	input: WindfallMoveInput & { createdByMemberId: string },
): Promise<IncomeWriteResult> {
	await insertWindfallMove(db, input);
	const [written] = await db
		.select({ id: moves.id })
		.from(moves)
		.where(and(eq(moves.id, input.moveId), eq(moves.householdId, input.householdId)));
	return written ? { ok: true } : { ok: false, reason: "refused" };
}

type WindfallMoveInput = {
	householdId: string;
	moveId: string;
	month: MonthKey;
	to: WindfallDestination;
	amountCents: Cents;
	/** Null when month-close applies it; then only Household Buckets can take it. */
	createdByMemberId: string | null;
};

/** A Windfall Move's guarded insert (see decideWindfall), also landing only if `guard` holds. */
export function insertWindfallMove(db: Db, input: WindfallMoveInput, guard?: SQL) {
	const { householdId, month, to } = input;
	// Selected in the table's column order: insert … select is positional.
	const row = <H, B, G>(owner: H, toBucketId: B, toGoalId: G) => ({
		id: sql<string>`${input.moveId}`.as("id"),
		householdId: owner,
		kind: sql<"windfall">`'windfall'`.as("kind"),
		month: sql<string>`${month}`.as("month"),
		fromBucketId: sql<string | null>`null`.as("from_bucket_id"),
		toBucketId,
		amountCents: sql<number>`${input.amountCents}`.as("amount_cents"),
		createdByMemberId: sql<string | null>`${input.createdByMemberId}`.as("created_by_member_id"),
		createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
		toGoalId,
	});
	const enough = sql`${windfallLeftSql(householdId, month)} >= ${input.amountCents}`;
	const select =
		to.kind === "goal"
			? db
					.select(row(goals.householdId, sql<string | null>`null`.as("to_bucket_id"), goals.id))
					.from(goals)
					.where(
						and(
							eq(goals.id, to.goalId),
							eq(goals.householdId, householdId),
							isNull(goals.completedAt),
							isNull(goals.archivedAt),
							enough,
							guard,
						),
					)
			: db
					.select(row(buckets.householdId, buckets.id, sql<string | null>`null`.as("to_goal_id")))
					.from(buckets)
					.where(
						and(
							bucketInPlan(householdId, to.bucketId, month),
							assignableBy(input.createdByMemberId ?? ""),
							enough,
							guard,
						),
					);
	return db.insert(moves).select(select).onConflictDoNothing({ target: moves.id });
}

/**
 * Undoes a Windfall Move, putting the money back in the Windfall. Refused if it went to a Goal
 * that has since spent it (its Earmark is less than the Move). Undoing it twice changes nothing.
 */
export async function undoWindfall(
	db: Db,
	input: { householdId: string; moveId: string; month: MonthKey },
): Promise<IncomeWriteResult> {
	const own = and(
		eq(moves.id, input.moveId),
		eq(moves.householdId, input.householdId),
		eq(moves.month, input.month),
		eq(moves.kind, "windfall"),
	);
	await db.delete(moves).where(
		and(
			own,
			// Correlated with the Move being deleted (the subqueries alias their own `moves`).
			sql`(moves.to_goal_id is null or ${earmarkSql(input.householdId, sql.raw("moves.to_goal_id"))} >= moves.amount_cents)`,
		),
	);
	const [left] = await db.select({ id: moves.id }).from(moves).where(own);
	return left ? { ok: false, reason: "refused" } : { ok: true };
}
