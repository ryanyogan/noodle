import {
	CHECK_IN_ORDER,
	type CheckInCardKind,
	type CheckInStarted,
	type DayKey,
	type Weekday,
} from "@noodle/domain";
import { and, asc, eq, gte, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "./index";
import type { Viewer } from "./privacy";
import {
	checkInCards,
	checkIns,
	households,
	insights,
	members,
	monthCloses,
	moves,
} from "./schema";

// The weekly Check-in: the day it falls on, and which Parents have finished each week's. Every
// query is scoped by household_id; a Parent's own member ID only ever comes from their session.

/** Every Household with its time zone and Check-in day, for the nightly Check-in run. */
export function listCheckInHouseholds(
	db: Db,
): Promise<{ id: string; timeZone: string; checkInDay: Weekday }[]> {
	return db
		.select({ id: households.id, timeZone: households.timeZone, checkInDay: households.checkInDay })
		.from(households);
}

/** Chooses the Household's Check-in day. Choosing the same day again changes nothing. */
export async function setCheckInDay(db: Db, householdId: string, day: Weekday): Promise<void> {
	await db.update(households).set({ checkInDay: day }).where(eq(households.id, householdId));
}

/** A Parent, and when they finished the week's Check-in; null while they haven't. */
export type CheckInParent = { memberId: string; name: string; completedAt: Date | null };

/** Every Parent of the Household, with whether they've finished `week`'s Check-in. */
export function loadCheckIns(db: Db, householdId: string, week: DayKey): Promise<CheckInParent[]> {
	return db
		.select({ memberId: members.id, name: members.name, completedAt: checkIns.completedAt })
		.from(members)
		.leftJoin(
			checkIns,
			and(
				eq(checkIns.memberId, members.id),
				eq(checkIns.householdId, householdId),
				eq(checkIns.week, week),
			),
		)
		.where(and(eq(members.householdId, householdId), eq(members.kind, "parent")))
		.orderBy(asc(members.createdAt), asc(members.id));
}

/**
 * Records a Parent finishing `week`'s Check-in, only while they're a Parent of the Household.
 * Idempotent: finishing again keeps the first time. Returns whether this call recorded it.
 */
export async function completeCheckIn(
	db: Db,
	input: { householdId: string; memberId: string; week: DayKey },
): Promise<boolean> {
	const written = await db
		.insert(checkIns)
		.select(
			db
				.select({
					// Selected in the table's column order: insert … select is positional.
					householdId: members.householdId,
					memberId: members.id,
					week: sql<string>`${input.week}`.as("week"),
					completedAt: sql<Date>`(unixepoch() * 1000)`.as("completed_at"),
				})
				.from(members)
				.where(
					and(
						eq(members.id, input.memberId),
						eq(members.householdId, input.householdId),
						eq(members.kind, "parent"),
					),
				),
		)
		.onConflictDoNothing()
		.returning({ week: checkIns.week });
	return written.length > 0;
}

/** A card of the week's stack as it joined for one Parent: what it held then, and when. */
export type CheckInStackRow = CheckInStarted & { startedAt: Date };

/**
 * Adds to a Parent's stack for `week` each of `cards` it doesn't hold yet, as they are at `now`;
 * a card already there keeps what it started as. Only for a Parent of the Household. Returns how
 * many joined.
 */
export async function startCheckInStack(
	db: Db,
	input: {
		householdId: string;
		memberId: string;
		week: DayKey;
		cards: readonly CheckInStarted[];
		now: Date;
	},
): Promise<number> {
	const written = await Promise.all(
		input.cards.map((card) =>
			db
				.insert(checkInCards)
				.select(
					db
						.select({
							// Selected in the table's column order: insert … select is positional.
							householdId: members.householdId,
							memberId: members.id,
							week: sql<string>`${input.week}`.as("week"),
							kind: sql<CheckInCardKind>`${card.kind}`.as("kind"),
							started: sql<CheckInStarted>`${JSON.stringify(card)}`.as("started"),
							startedAt: sql<Date>`${input.now.getTime()}`.as("started_at"),
						})
						.from(members)
						.where(
							and(
								eq(members.id, input.memberId),
								eq(members.householdId, input.householdId),
								eq(members.kind, "parent"),
							),
						),
				)
				.onConflictDoNothing()
				.returning({ kind: checkInCards.kind }),
		),
	);
	return written.flat().length;
}

/**
 * `viewer`'s stack for `week`: the cards that have waited for them, each as it joined. The order
 * is the Household's, so both Parents meet the cards in one order: by when each kind first
 * joined for anyone, then the fixed order. Only `viewer`'s own rows are read back: what a card
 * held for the other Parent may rest on their Personal Allowance (ADR-0003).
 */
export async function loadCheckInStack(
	db: Db,
	viewer: Viewer,
	week: DayKey,
): Promise<CheckInStackRow[]> {
	const [mine, firsts] = await Promise.all([
		db
			.select({ started: checkInCards.started, startedAt: checkInCards.startedAt })
			.from(checkInCards)
			.where(
				and(
					eq(checkInCards.householdId, viewer.householdId),
					eq(checkInCards.memberId, viewer.memberId),
					eq(checkInCards.week, week),
				),
			),
		db
			.select({
				kind: checkInCards.kind,
				first: sql<number>`min(${checkInCards.startedAt})`.as("first"),
			})
			.from(checkInCards)
			.where(and(eq(checkInCards.householdId, viewer.householdId), eq(checkInCards.week, week)))
			.groupBy(checkInCards.kind),
	]);
	const first = new Map(firsts.map((row) => [row.kind, row.first]));
	const rank = (kind: CheckInCardKind) => CHECK_IN_ORDER.indexOf(kind);
	return mine
		.map((row): CheckInStackRow => ({ ...row.started, startedAt: row.startedAt }))
		.sort(
			(a, b) => (first.get(a.kind) ?? 0) - (first.get(b.kind) ?? 0) || rank(a.kind) - rank(b.kind),
		);
}

/**
 * Who is on record as having dealt with each of `cards`, as Member IDs in order: whoever closed
 * the month for Sweeps, whoever decided Extra income since the card joined, whoever decided the
 * card's Insights (only those `viewer` may read). A card with nobody on record is left out, as
 * Review always is: filing a Transaction keeps no record of who did it.
 */
export async function loadCheckInDoers(
	db: Db,
	viewer: Viewer,
	cards: readonly CheckInStackRow[],
): Promise<Partial<Record<CheckInCardKind, string[]>>> {
	const found = await Promise.all(
		cards.map(async (card): Promise<[CheckInCardKind, (string | null)[]]> => {
			switch (card.kind) {
				case "review":
					return [card.kind, []];
				case "insights": {
					if (card.ids.length === 0) return [card.kind, []];
					const rows = await db
						.selectDistinct({ by: insights.decidedByMemberId })
						.from(insights)
						.where(
							and(
								eq(insights.householdId, viewer.householdId),
								or(isNull(insights.ownerMemberId), eq(insights.ownerMemberId, viewer.memberId)),
								ne(insights.status, "new"),
								isNotNull(insights.decidedByMemberId),
								// One parameter however many Insights: D1 refuses more than 100.
								sql`${insights.id} in (select value from json_each(${JSON.stringify(card.ids)}))`,
							),
						);
					return [card.kind, rows.map((row) => row.by)];
				}
				case "sweeps": {
					const rows = await db
						.select({ by: monthCloses.decidedByMemberId })
						.from(monthCloses)
						.where(
							and(
								eq(monthCloses.householdId, viewer.householdId),
								eq(monthCloses.month, card.month),
							),
						);
					return [card.kind, rows.map((row) => row.by)];
				}
				case "windfalls": {
					const rows = await db
						.selectDistinct({ by: moves.createdByMemberId })
						.from(moves)
						.where(
							and(
								eq(moves.householdId, viewer.householdId),
								eq(moves.kind, "windfall"),
								// A decision is timed in whole seconds (the column's default), the card's
								// start to the millisecond: since the start's own second, or one made
								// straight after the card joined would be nobody's.
								gte(moves.createdAt, new Date(Math.floor(card.startedAt.getTime() / 1000) * 1000)),
								sql`${moves.month} in (select value from json_each(${JSON.stringify(card.months)}))`,
							),
						);
					return [card.kind, rows.map((row) => row.by)];
				}
			}
		}),
	);
	const doers: Partial<Record<CheckInCardKind, string[]>> = {};
	for (const [kind, by] of found) {
		const ids = [...new Set(by.filter((id): id is string => id !== null))].sort();
		if (ids.length > 0) doers[kind] = ids;
	}
	return doers;
}
