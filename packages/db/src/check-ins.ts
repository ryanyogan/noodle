import type { DayKey, Weekday } from "@noodle/domain";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "./index";
import { checkIns, households, members } from "./schema";

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
