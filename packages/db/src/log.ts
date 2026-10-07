import {
	type LogCursor,
	type LogItemKind,
	type LogRow,
	type LogSnapshotKind,
	logItemOfPlanChange,
	type MonthKey,
} from "@noodle/domain";
import { type AnyColumn, and, desc, eq, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import type { Db } from "./index";
import { planChangeOf, selectPlanChanges } from "./plan-log";
import type { Viewer } from "./privacy";
import {
	bankConnections,
	buckets,
	commitments,
	freshStarts,
	householdSnapshots,
	members,
	planChanges,
	rules,
} from "./schema";

// The Log (issue 139): every change made to the Household that is on record, newest first, a
// page at a time. It reads what is already kept, each from its own table: Plan changes, Rules
// (as made; a removed Rule leaves no record), Household snapshots other than the nightly ones,
// Fresh starts and Bank Connections. Changes to single Transactions are not in it.
//
// The order is when (newest first), then the source in the order below, then the row's own ID
// (newest first). Each source gives its next few rows after the cursor and the page is the
// newest of them all, so no read is ever larger than a page.

const SOURCES = ["plan", "rule", "snapshot", "fresh-start", "bank-connection"] as const;
type Source = (typeof SOURCES)[number];
const rankOf = (source: Source) => SOURCES.indexOf(source);

/** How many rows a page of the Log has unless asked otherwise, and the most it may have. */
export const LOG_PAGE = 25;
const LOG_PAGE_MAX = 100;

export type LogFilter = {
	/** Only what takes effect in this month, which only Plan changes do. */
	month?: MonthKey;
	/** Only what this Member changed. */
	memberId?: string;
	item?: LogItemKind;
	after?: LogCursor;
	limit?: number;
};

export type LogPage = { rows: LogRow[]; next: LogCursor | null };

const sourceOf = (item: LogItemKind): Source =>
	item === "rule" || item === "snapshot" || item === "fresh-start" || item === "bank-connection"
		? item
		: "plan";

/** Plan changes about one kind of item, told from the kind stored (never the masked one). */
const planItem = (item: LogItemKind): SQL => {
	const kind = planChanges.kind;
	if (item === "take-home-pay") return sql`${kind} = 'baseline'`;
	if (item === "goal") return sql`${kind} like 'goal%'`;
	if (item === "commitment") return sql`${kind} like 'commitment%'`;
	return sql`(${kind} <> 'baseline' and ${kind} not like 'goal%' and ${kind} not like 'commitment%')`;
};

type Ranked = { rank: number; id: string; numeric: boolean; row: LogRow };

/** Newest first; at the same moment by source, then the newer ID first. */
const inOrder = (a: Ranked, b: Ranked) => {
	if (a.row.at !== b.row.at) return b.row.at - a.row.at;
	if (a.rank !== b.rank) return a.rank - b.rank;
	if (a.numeric) return Number(b.id) - Number(a.id);
	return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};

/**
 * A page of the Household's Log as `viewer` may see it, newest first. A Plan change to the other
 * Parent's Personal Allowance says only that it changed, and a Rule that files into it is left
 * out, so neither its amounts nor its wording leave the database (ADR-0003).
 */
export async function loadLog(db: Db, viewer: Viewer, filter: LogFilter = {}): Promise<LogPage> {
	const limit = Math.max(1, Math.min(filter.limit ?? LOG_PAGE, LOG_PAGE_MAX));
	const { after, memberId } = filter;
	const only = filter.item === undefined ? null : sourceOf(filter.item);
	// A source the filters leave out is still asked, for nothing: the batch keeps its shape.
	const wanted = (source: Source): SQL | undefined =>
		(only === null || only === source) && (filter.month === undefined || source === "plan")
			? undefined
			: sql`0`;
	/** Rows of `source` that come after the cursor, by its `at` and `id` columns. */
	const afterCursor = (source: Source, at: AnyColumn, id: AnyColumn): SQL | undefined => {
		if (!after) return undefined;
		const rank = rankOf(source);
		if (rank > after.rank) return sql`${at} <= ${after.at}`;
		if (rank < after.rank) return sql`${at} < ${after.at}`;
		const earlier =
			source === "plan" ? sql`${id} < cast(${after.id} as integer)` : sql`${id} < ${after.id}`;
		return sql`(${at} < ${after.at} or (${at} = ${after.at} and ${earlier}))`;
	};
	const by = (column: AnyColumn) => (memberId === undefined ? undefined : eq(column, memberId));
	const who = (column: AnyColumn) => eq(members.id, column);

	const [plan, ruleRows, snapshotRows, freshStartRows, bankRows] = await db.batch([
		selectPlanChanges(
			db,
			viewer,
			and(
				wanted("plan"),
				filter.month === undefined ? undefined : eq(planChanges.month, filter.month),
				filter.item === undefined || only !== "plan" ? undefined : planItem(filter.item),
				by(planChanges.memberId),
				afterCursor("plan", planChanges.createdAt, planChanges.id),
			),
		)
			.orderBy(desc(planChanges.createdAt), desc(planChanges.id))
			.limit(limit + 1),
		db
			.select({
				id: rules.id,
				at: rules.createdAt,
				memberId: rules.createdByMemberId,
				// Aliased: D1 keys batch rows by column name (see plan-log.ts).
				memberName: sql<string | null>`${members.name}`.as("member_name"),
				pattern: rules.pattern,
				targetName: sql<string | null>`coalesce(${buckets.name}, ${commitments.name})`.as(
					"target_name",
				),
			})
			.from(rules)
			.leftJoin(members, who(rules.createdByMemberId))
			.leftJoin(buckets, eq(buckets.id, rules.bucketId))
			.leftJoin(commitments, eq(commitments.id, rules.commitmentId))
			.where(
				and(
					eq(rules.householdId, viewer.householdId),
					// A Rule that files into a Personal Allowance is its Parent's alone.
					or(isNull(rules.ownerMemberId), eq(rules.ownerMemberId, viewer.memberId)),
					wanted("rule"),
					by(rules.createdByMemberId),
					afterCursor("rule", rules.createdAt, rules.id),
				),
			)
			.orderBy(desc(rules.createdAt), desc(rules.id))
			.limit(limit + 1),
		db
			.select({
				id: householdSnapshots.id,
				at: householdSnapshots.createdAt,
				memberId: householdSnapshots.takenBy,
				memberName: sql<string | null>`${members.name}`.as("member_name"),
				kind: householdSnapshots.kind,
				note: householdSnapshots.note,
			})
			.from(householdSnapshots)
			.leftJoin(members, who(householdSnapshots.takenBy))
			.where(
				and(
					eq(householdSnapshots.householdId, viewer.householdId),
					// One a night that nobody asked for: they would bury the rest.
					ne(householdSnapshots.kind, "nightly"),
					wanted("snapshot"),
					by(householdSnapshots.takenBy),
					afterCursor("snapshot", householdSnapshots.createdAt, householdSnapshots.id),
				),
			)
			.orderBy(desc(householdSnapshots.createdAt), desc(householdSnapshots.id))
			.limit(limit + 1),
		db
			.select({
				id: freshStarts.id,
				at: freshStarts.createdAt,
				memberId: freshStarts.requestedBy,
				memberName: sql<string | null>`${members.name}`.as("member_name"),
				status: freshStarts.status,
			})
			.from(freshStarts)
			.leftJoin(members, who(freshStarts.requestedBy))
			.where(
				and(
					eq(freshStarts.householdId, viewer.householdId),
					eq(freshStarts.level, "fresh-start"),
					wanted("fresh-start"),
					by(freshStarts.requestedBy),
					afterCursor("fresh-start", freshStarts.createdAt, freshStarts.id),
				),
			)
			.orderBy(desc(freshStarts.createdAt), desc(freshStarts.id))
			.limit(limit + 1),
		db
			.select({
				id: bankConnections.id,
				at: bankConnections.createdAt,
				memberId: bankConnections.createdByMemberId,
				memberName: sql<string | null>`${members.name}`.as("member_name"),
				institution: bankConnections.institution,
				status: bankConnections.status,
			})
			.from(bankConnections)
			.leftJoin(members, who(bankConnections.createdByMemberId))
			.where(
				and(
					eq(bankConnections.householdId, viewer.householdId),
					wanted("bank-connection"),
					by(bankConnections.createdByMemberId),
					afterCursor("bank-connection", bankConnections.createdAt, bankConnections.id),
				),
			)
			.orderBy(desc(bankConnections.createdAt), desc(bankConnections.id))
			.limit(limit + 1),
	]);

	const ranked = <S extends Source>(source: S, id: string | number, row: LogRow): Ranked => ({
		rank: rankOf(source),
		id: String(id),
		numeric: source === "plan",
		row,
	});
	const head = (
		source: Source,
		row: { id: string | number; at: Date; memberId: string | null; memberName: string | null },
	) => ({
		key: `${source}:${row.id}`,
		at: row.at.getTime(),
		memberId: row.memberId,
		memberName: row.memberName,
	});
	const all: Ranked[] = [
		...plan.map((row) => {
			const change = planChangeOf(row);
			// A masked change is the other Parent's Personal Allowance, which is a Bucket.
			const item =
				change.kind === "personal-allowance" ? "bucket" : logItemOfPlanChange(change.kind);
			return ranked("plan", row.id, {
				...head("plan", row),
				item,
				month: change.month,
				source: "plan",
				change,
			});
		}),
		...ruleRows.map((row) =>
			ranked("rule", row.id, {
				...head("rule", row),
				item: "rule",
				month: null,
				source: "rule",
				pattern: row.pattern,
				targetName: row.targetName,
			}),
		),
		...snapshotRows.map((row) =>
			ranked("snapshot", row.id, {
				...head("snapshot", row),
				item: "snapshot",
				month: null,
				source: "snapshot",
				kind: row.kind as LogSnapshotKind,
				note: row.note,
			}),
		),
		...freshStartRows.map((row) =>
			ranked("fresh-start", row.id, {
				...head("fresh-start", row),
				item: "fresh-start",
				month: null,
				source: "fresh-start",
				status: row.status,
			}),
		),
		...bankRows.map((row) =>
			ranked("bank-connection", row.id, {
				...head("bank-connection", row),
				item: "bank-connection",
				month: null,
				source: "bank-connection",
				institution: row.institution,
				disconnected: row.status === "disconnected",
			}),
		),
	].sort(inOrder);

	const page = all.slice(0, limit);
	const last = page[page.length - 1];
	return {
		rows: page.map((r) => r.row),
		next: all.length > limit && last ? { at: last.row.at, rank: last.rank, id: last.id } : null,
	};
}
