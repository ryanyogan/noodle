import {
	compareLogNames,
	LOG_EVENT_KINDS,
	type LogCursor,
	type LogEventKind,
	type LogItemKind,
	type LogRow,
	type LogSnapshotKind,
	type LogSort,
	logItemOfEvent,
	logItemOfPlanChange,
	type MonthKey,
} from "@noodle/domain";
import {
	type AnyColumn,
	and,
	asc,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import type { Db } from "./index";
import { visibleLogEvent } from "./log-events";
import { planChangeOf, selectPlanChanges } from "./plan-log";
import type { Viewer } from "./privacy";
import {
	accounts,
	bankConnections,
	buckets,
	cardPaymentRules,
	commitments,
	freshStarts,
	householdSnapshots,
	logEvents,
	members,
	moneyInPairs,
	moneyInRules,
	planChanges,
	rules,
} from "./schema";

// The Log (issue 139): every change made to the Household that is on record, newest first, a
// page at a time. It reads what is already kept, each from its own table: Plan changes, Rules,
// Rules for money in and card payments remembered (each as made), Household snapshots other than
// the nightly ones, Fresh starts and Bank Connections; and its own record (`log_events`, issue
// 141) of what leaves no row behind: a Rule removed, with the Rule as it was made, a Bank
// Connection disconnected, an Account archived or brought back. Changes to single Transactions are not in it.
//
// The order is when (newest first), then the source in the order below, then the row's own ID
// (newest first). Each source gives its next few rows after the cursor and the page is the
// newest of them all, so no read is ever larger than a page.
//
// Asked for oldest first, the order is that one backwards. Asked for by who, it is the Member's
// name (A to Z, or Z to A; nobody on record counts as "") and each Member's changes in the
// order above. Every order is total, so a cursor names one place in it and paging neither
// repeats nor skips a row. Names compare as SQLite compares them (by bytes, which is by code
// point), in the selects and in the merge alike (`compareLogNames`).

const SOURCES = [
	"plan",
	"rule",
	"snapshot",
	"fresh-start",
	"bank-connection",
	"money-in-rule",
	"card-payment-rule",
	"event",
	// Last, so a cursor made before pairs had a table of their own still names its place.
	"money-in-pair",
] as const;
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
	/** Newest first when left out. */
	sort?: LogSort;
	after?: LogCursor;
	limit?: number;
};

const NEWEST_FIRST: LogSort = { by: "when", desc: true };

/** Who made a row, as the order by who reads it: nobody on record sorts as "". */
const whoKey = sql<string>`coalesce(${members.name}, '')`;

export type LogPage = { rows: LogRow[]; next: LogCursor | null };

/** The sources that hold changes to one kind of item. */
const sourcesOf = (item: LogItemKind): readonly Source[] => {
	if (item === "rule")
		return ["rule", "money-in-rule", "money-in-pair", "card-payment-rule", "event"];
	if (item === "bank-connection") return ["bank-connection", "event"];
	if (item === "account") return ["event"];
	return item === "snapshot" || item === "fresh-start" ? [item] : ["plan"];
};

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
const newestFirst = (a: Ranked, b: Ranked) => {
	if (a.row.at !== b.row.at) return b.row.at - a.row.at;
	if (a.rank !== b.rank) return a.rank - b.rank;
	if (a.numeric) return Number(b.id) - Number(a.id);
	return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};

/** The Log's order for `sort`, the same one its selects and cursors keep to. */
const inOrder = (sort: LogSort) => (a: Ranked, b: Ranked) => {
	if (sort.by === "when") return sort.desc ? newestFirst(a, b) : newestFirst(b, a);
	const [x, y] = [a.row.memberName ?? "", b.row.memberName ?? ""];
	if (x !== y) return compareLogNames(x, y) * (sort.desc ? -1 : 1);
	return newestFirst(a, b);
};

/**
 * A page of the Household's Log as `viewer` may see it, newest first. A Plan change to the other
 * Parent's Personal Allowance says only that it changed, and a Rule that files into it is left
 * out, so neither its amounts nor its wording leave the database (ADR-0003).
 */
export async function loadLog(db: Db, viewer: Viewer, filter: LogFilter = {}): Promise<LogPage> {
	const limit = Math.max(1, Math.min(filter.limit ?? LOG_PAGE, LOG_PAGE_MAX));
	const { after, memberId } = filter;
	const sort = filter.sort ?? NEWEST_FIRST;
	// Within one Member's changes the order by who is newest first.
	const newest = sort.by === "who" || sort.desc;
	const only = filter.item === undefined ? null : sourcesOf(filter.item);
	// A source the filters leave out is still asked, for nothing: the batch keeps its shape.
	const wanted = (source: Source): SQL | undefined =>
		(only === null || only.includes(source)) && (filter.month === undefined || source === "plan")
			? undefined
			: sql`0`;
	/** Rows of `source` that come after the cursor, by its `at` and `id` columns. */
	const afterCursor = (source: Source, at: AnyColumn, id: AnyColumn): SQL | undefined => {
		if (!after) return undefined;
		const when = afterWhen(source, at, id, after);
		if (sort.by === "when") return when;
		const name = after.who ?? "";
		return sort.desc
			? sql`(${whoKey} < ${name} or (${whoKey} = ${name} and ${when}))`
			: sql`(${whoKey} > ${name} or (${whoKey} = ${name} and ${when}))`;
	};
	/** The same, by when alone: later in the order than the cursor's moment, source and ID. */
	const afterWhen = (source: Source, at: AnyColumn, id: AnyColumn, cursor: LogCursor): SQL => {
		const rank = rankOf(source);
		const cursorId = source === "plan" ? sql`cast(${cursor.id} as integer)` : sql`${cursor.id}`;
		if (newest) {
			if (rank > cursor.rank) return sql`${at} <= ${cursor.at}`;
			if (rank < cursor.rank) return sql`${at} < ${cursor.at}`;
			return sql`(${at} < ${cursor.at} or (${at} = ${cursor.at} and ${id} < ${cursorId}))`;
		}
		if (rank < cursor.rank) return sql`${at} >= ${cursor.at}`;
		if (rank > cursor.rank) return sql`${at} > ${cursor.at}`;
		return sql`(${at} > ${cursor.at} or (${at} = ${cursor.at} and ${id} > ${cursorId}))`;
	};
	/** A source's rows in the Log's order. */
	const ordered = (at: AnyColumn, id: AnyColumn): SQL[] => {
		const when = newest ? [desc(at), desc(id)] : [asc(at), asc(id)];
		return sort.by === "who" ? [sort.desc ? desc(whoKey) : asc(whoKey), ...when] : when;
	};
	const by = (column: AnyColumn) => (memberId === undefined ? undefined : eq(column, memberId));
	const who = (column: AnyColumn) => eq(members.id, column);

	const [
		plan,
		ruleRows,
		snapshotRows,
		freshStartRows,
		bankRows,
		moneyInRows,
		cardPaymentRows,
		eventRows,
		pairRows,
	] = await db.batch([
		selectPlanChanges(
			db,
			viewer,
			and(
				wanted("plan"),
				filter.month === undefined ? undefined : eq(planChanges.month, filter.month),
				filter.item === undefined || !only?.includes("plan") ? undefined : planItem(filter.item),
				by(planChanges.memberId),
				afterCursor("plan", planChanges.createdAt, planChanges.id),
			),
		)
			.orderBy(...ordered(planChanges.createdAt, planChanges.id))
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
			.orderBy(...ordered(rules.createdAt, rules.id))
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
			.orderBy(...ordered(householdSnapshots.createdAt, householdSnapshots.id))
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
			.orderBy(...ordered(freshStarts.createdAt, freshStarts.id))
			.limit(limit + 1),
		db
			.select({
				id: bankConnections.id,
				at: bankConnections.createdAt,
				memberId: bankConnections.createdByMemberId,
				memberName: sql<string | null>`${members.name}`.as("member_name"),
				institution: bankConnections.institution,
				status: bankConnections.status,
				// Its disconnecting has a row of its own in the Log (since issue 141).
				recorded:
					sql<number>`exists (select 1 from log_events le where le.household_id = ${bankConnections.householdId}
						and le.kind in ('bank-connection-removed', 'bank-connection-disconnected')
						and substr(le.id, 1, length(${bankConnections.id}) + 1) = ${bankConnections.id} || ':')`.as(
						"recorded",
					),
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
			.orderBy(...ordered(bankConnections.createdAt, bankConnections.id))
			.limit(limit + 1),
		// Rules for money in are the Household's, never private (ADR-0057).
		db
			.select({
				id: moneyInRules.id,
				at: moneyInRules.createdAt,
				memberId: moneyInRules.createdByMemberId,
				memberName: sql<string | null>`${members.name}`.as("member_name"),
				pattern: moneyInRules.pattern,
				kind: moneyInRules.kind,
				pair: sql<number>`${isNotNull(moneyInRules.intoAccountId)}`.as("pair"),
			})
			.from(moneyInRules)
			.leftJoin(members, who(moneyInRules.createdByMemberId))
			.where(
				and(
					eq(moneyInRules.householdId, viewer.householdId),
					wanted("money-in-rule"),
					by(moneyInRules.createdByMemberId),
					afterCursor("money-in-rule", moneyInRules.createdAt, moneyInRules.id),
				),
			)
			.orderBy(...ordered(moneyInRules.createdAt, moneyInRules.id))
			.limit(limit + 1),
		db
			.select({
				id: cardPaymentRules.id,
				at: cardPaymentRules.createdAt,
				memberId: cardPaymentRules.createdByMemberId,
				memberName: sql<string | null>`${members.name}`.as("member_name"),
				pattern: cardPaymentRules.pattern,
				cardName: sql<string | null>`${accounts.name}`.as("card_name"),
			})
			.from(cardPaymentRules)
			.leftJoin(members, who(cardPaymentRules.createdByMemberId))
			.leftJoin(accounts, eq(accounts.id, cardPaymentRules.accountId))
			.where(
				and(
					eq(cardPaymentRules.householdId, viewer.householdId),
					wanted("card-payment-rule"),
					by(cardPaymentRules.createdByMemberId),
					afterCursor("card-payment-rule", cardPaymentRules.createdAt, cardPaymentRules.id),
				),
			)
			.orderBy(...ordered(cardPaymentRules.createdAt, cardPaymentRules.id))
			.limit(limit + 1),
		db
			.select({
				id: logEvents.id,
				at: logEvents.createdAt,
				memberId: logEvents.memberId,
				memberName: sql<string | null>`${members.name}`.as("member_name"),
				event: sql<LogEventKind>`${logEvents.kind}`.as("event"),
				itemName: sql<string | null>`${logEvents.name}`.as("item_name"),
				detail: logEvents.detail,
			})
			.from(logEvents)
			.leftJoin(members, who(logEvents.memberId))
			.where(
				and(
					// A removed Rule into a Personal Allowance is its Parent's alone (ADR-0003).
					visibleLogEvent(viewer),
					wanted("event"),
					filter.item === undefined
						? undefined
						: inArray(
								logEvents.kind,
								LOG_EVENT_KINDS.filter((kind) => logItemOfEvent(kind) === filter.item),
							),
					by(logEvents.memberId),
					afterCursor("event", logEvents.createdAt, logEvents.id),
				),
			)
			.orderBy(...ordered(logEvents.createdAt, logEvents.id))
			.limit(limit + 1),
		// Remembered pairs of Accounts in their own table (issue 141); ones kept before it are
		// money-in Rules above.
		db
			.select({
				id: moneyInPairs.id,
				at: moneyInPairs.createdAt,
				memberId: moneyInPairs.createdByMemberId,
				memberName: sql<string | null>`${members.name}`.as("member_name"),
				pattern: moneyInPairs.pattern,
			})
			.from(moneyInPairs)
			.leftJoin(members, who(moneyInPairs.createdByMemberId))
			.where(
				and(
					eq(moneyInPairs.householdId, viewer.householdId),
					wanted("money-in-pair"),
					by(moneyInPairs.createdByMemberId),
					afterCursor("money-in-pair", moneyInPairs.createdAt, moneyInPairs.id),
				),
			)
			.orderBy(...ordered(moneyInPairs.createdAt, moneyInPairs.id))
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
				// One disconnected before the Log kept such rows says so here, or nothing would.
				disconnected: row.status === "disconnected" && !row.recorded,
			}),
		),
		...moneyInRows.map((row) =>
			ranked("money-in-rule", row.id, {
				...head("money-in-rule", row),
				item: "rule",
				month: null,
				source: "money-in-rule",
				pattern: row.pattern,
				kind: row.kind,
				pair: Boolean(row.pair),
			}),
		),
		...cardPaymentRows.map((row) =>
			ranked("card-payment-rule", row.id, {
				...head("card-payment-rule", row),
				item: "rule",
				month: null,
				source: "card-payment-rule",
				pattern: row.pattern,
				cardName: row.cardName,
			}),
		),
		...eventRows.map((row) =>
			ranked("event", row.id, {
				...head("event", row),
				item: logItemOfEvent(row.event),
				month: null,
				source: "event",
				event: row.event,
				name: row.itemName,
				detail: row.detail,
			}),
		),
		...pairRows.map((row) =>
			ranked("money-in-pair", row.id, {
				...head("money-in-pair", row),
				item: "rule",
				month: null,
				source: "money-in-rule",
				pattern: row.pattern,
				kind: "transfer",
				pair: true,
			}),
		),
	].sort(inOrder(sort));

	const page = all.slice(0, limit);
	const last = page[page.length - 1];
	return {
		rows: page.map((r) => r.row),
		next:
			all.length > limit && last
				? {
						at: last.row.at,
						rank: last.rank,
						id: last.id,
						...(sort.by === "who" ? { who: last.row.memberName ?? "" } : {}),
					}
				: null,
	};
}
