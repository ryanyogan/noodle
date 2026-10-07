import type {
	MonthKey,
	PlanChange,
	PlanChangeKind,
	PlanChangeSource,
	PlanChangeValue,
	PlanScope,
} from "@noodle/domain";
import { type AnyColumn, and, desc, eq, is, SQL, sql } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Db } from "./index";
import type { Viewer } from "./privacy";
import { buckets, commitments, goals, members, planChanges, scenarios } from "./schema";

// The Plan's history (ADR-0014). Each Plan write appends a row here in the same db.batch, as an
// `insert … select … where` carrying the write's own guard, placed before the write: a refused
// write logs nothing, and `before` reads what was in force before it. Each also only logs if the
// value really changes, so a retried write, which changes nothing the second time, logs once.

/**
 * Who made a Plan change: a Parent, in the Plan or by applying a Scenario (`source` "scenario",
 * with the Scenario's ID when it was saved).
 */
export type Author = {
	memberId: string;
	source?: PlanChangeSource;
	scenarioId?: string | null;
};

export type LogEntry = Author & {
	householdId: string;
	kind: PlanChangeKind;
	targetId: string | null;
	month: MonthKey;
	scope?: PlanScope;
	/** SQL for what was in force (read before the write), or the value itself. */
	before: SQL | PlanChangeValue | null;
	/** The value itself, or SQL for it (read in the same statement). */
	after: SQL | PlanChangeValue | null;
	/** The Parent whose Personal Allowance this is, if it is one. */
	owner?: AnyColumn | string | null;
};

const jsonValue = (value: SQL | PlanChangeValue | null): SQL => {
	if (value === null) return sql`null`;
	return is(value, SQL) ? value : sql`${JSON.stringify(value)}`;
};

/**
 * insert into plan_changes select … from `table` where `where`: one row for the Plan change if
 * `table` has a row matching `where` (the write's guard and "it changes something").
 */
export const logChange = (db: Db, table: SQLiteTable, where: SQL | undefined, entry: LogEntry) =>
	db.insert(planChanges).select(
		db
			.select({
				id: sql<number>`null`.as("id"),
				householdId: sql<string>`${entry.householdId}`.as("household_id"),
				memberId: sql<string>`${entry.memberId}`.as("member_id"),
				kind: sql<PlanChangeKind>`${entry.kind}`.as("kind"),
				targetId: sql<string | null>`${entry.targetId}`.as("target_id"),
				month: sql<string>`${entry.month}`.as("month"),
				scope: sql<PlanScope>`${entry.scope ?? "from-on"}`.as("scope"),
				before: sql<PlanChangeValue | null>`${jsonValue(entry.before)}`.as("before"),
				after: sql<PlanChangeValue | null>`${jsonValue(entry.after)}`.as("after"),
				ownerMemberId: sql<string | null>`${entry.owner ?? null}`.as("owner_member_id"),
				source: sql<PlanChangeSource>`${entry.source ?? "plan"}`.as("source"),
				scenarioId: sql<string | null>`${entry.scenarioId ?? null}`.as("scenario_id"),
				createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
			})
			.from(table)
			.where(where),
	);

/**
 * `column` of the effective-dated record in force at `month`: the latest of `table`'s rows
 * matching `where` from `month` or before. Null when there is none.
 */
export const inForce = (
	table: SQLiteTable,
	column: AnyColumn | SQL,
	monthColumn: AnyColumn,
	where: SQL | undefined,
	month: MonthKey,
) =>
	sql`(select ${column} from ${table} where ${where} and ${monthColumn} <= ${month} order by ${monthColumn} desc limit 1)`;

/** Plan changes as the Viewer may see them, and when the Household's history starts. */
export type PlanHistory = {
	/** Newest first. */
	changes: PlanChange[];
	/** When the first Plan change was logged (ms since the epoch); none before it were kept. */
	historyStart: number | null;
};

/** A Plan change's row as it was read, before its values are parsed. */
type PlanChangeRow = Omit<PlanChange, "at" | "month" | "before" | "after"> & {
	at: Date;
	month: string;
	before: string | null;
	after: string | null;
};

const parseValue = (value: string | null) =>
	value === null ? null : (JSON.parse(value) as PlanChangeValue);

/** A Plan change from its row. */
export const planChangeOf = (row: PlanChangeRow): PlanChange => ({
	...row,
	at: row.at.getTime(),
	month: row.month as MonthKey,
	before: parseValue(row.before),
	after: parseValue(row.after),
});

/**
 * The Household's Plan changes matching `where`, as `viewer` may see them: the other Parent's
 * Personal Allowance reads as "personal-allowance", with no values and no name (ADR-0003). The
 * values never leave the database for them. Every read of Plan changes for a Viewer is this one.
 */
export const selectPlanChanges = (db: Db, viewer: Viewer, where?: SQL) => {
	const hidden = sql`(${planChanges.ownerMemberId} is not null and ${planChanges.ownerMemberId} <> ${viewer.memberId})`;
	const ownTarget = (table: typeof buckets | typeof commitments | typeof goals) =>
		and(eq(table.id, planChanges.targetId), eq(table.householdId, planChanges.householdId));
	return db
		.select({
			id: planChanges.id,
			at: planChanges.createdAt,
			memberId: planChanges.memberId,
			memberName: members.name,
			kind: sql<
				PlanChange["kind"]
			>`case when ${hidden} then 'personal-allowance' else ${planChanges.kind} end`,
			targetId: planChanges.targetId,
			targetName: sql<
				string | null
			>`case when ${hidden} then null else coalesce(${buckets.name}, ${commitments.name}, ${goals.name}) end`,
			month: planChanges.month,
			scope: planChanges.scope,
			source: planChanges.source,
			scenarioId: planChanges.scenarioId,
			// Aliased: D1 keys batch rows by column name, and a second bare `name` would collide with
			// members.name and shift the columns after it.
			scenarioName: sql<string | null>`${scenarios.name}`.as("scenario_name"),
			before: sql<string | null>`case when ${hidden} then null else ${planChanges.before} end`,
			after: sql<string | null>`case when ${hidden} then null else ${planChanges.after} end`,
		})
		.from(planChanges)
		.innerJoin(members, eq(members.id, planChanges.memberId))
		.leftJoin(buckets, ownTarget(buckets))
		.leftJoin(commitments, ownTarget(commitments))
		.leftJoin(goals, ownTarget(goals))
		.leftJoin(
			scenarios,
			and(
				eq(scenarios.id, planChanges.scenarioId),
				eq(scenarios.householdId, planChanges.householdId),
			),
		)
		.where(and(eq(planChanges.householdId, viewer.householdId), where));
};

/**
 * The Household's Plan changes that take effect in `month`, or that changed `targetId`, as
 * `viewer` may see them (ADR-0003), newest first.
 */
export async function loadPlanChanges(
	db: Db,
	viewer: Viewer,
	filter: { month?: MonthKey; targetId?: string },
): Promise<PlanHistory> {
	const [rows, [start]] = await db.batch([
		selectPlanChanges(
			db,
			viewer,
			and(
				filter.month === undefined ? undefined : eq(planChanges.month, filter.month),
				filter.targetId === undefined ? undefined : eq(planChanges.targetId, filter.targetId),
			),
		).orderBy(desc(planChanges.id)),
		db
			.select({ at: sql<number | null>`min(${planChanges.createdAt})` })
			.from(planChanges)
			.where(eq(planChanges.householdId, viewer.householdId)),
	]);
	return { changes: rows.map(planChangeOf), historyStart: start?.at ?? null };
}
