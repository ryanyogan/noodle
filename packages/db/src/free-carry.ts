import {
	type Cents,
	freeCarriedIn,
	freeCarrySince,
	type MonthAmount,
	type MonthKey,
	type PlanRecords,
} from "@noodle/domain";
import { and, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import type { Db } from "./index";
import { loadPlanRecords } from "./plan";
import { freeToSpendCarry, households, moves } from "./schema";

// Free to Spend that builds up (issue 113, ADR-0054): the setting's rows, and the amounts the
// walk in @noodle/domain (free-carry.ts) needs. What is carried is never stored.

/**
 * What earlier months carried into `month`'s Free to Spend (see freeCarriedIn in @noodle/domain),
 * from each of those months' Moves out of Free to Spend and Extra income added to it. Reads no
 * history when the month before starts fresh, which it does for every Household that never
 * turned building up on. `records` must include every Plan record before `month`.
 */
export async function loadFreeCarriedIn(
	db: Db,
	householdId: string,
	records: PlanRecords,
	month: MonthKey,
): Promise<Cents> {
	const since = freeCarrySince(records, month);
	if (since === null) return 0;
	const inHistory = and(
		eq(moves.householdId, householdId),
		gte(moves.month, since),
		lt(moves.month, month),
	);
	const total = { month: moves.month, amount: sql<number>`sum(${moves.amountCents})` };
	// The same two sums as freeToSpendSql (moves.ts), a month at a time.
	const [outOfFree, extraToFree] = await Promise.all([
		db
			.select(total)
			.from(moves)
			.where(and(inHistory, isNull(moves.fromBucketId), ne(moves.kind, "windfall")))
			.groupBy(moves.month),
		db
			.select(total)
			.from(moves)
			.where(
				and(
					inHistory,
					eq(moves.kind, "windfall"),
					isNull(moves.toBucketId),
					isNull(moves.toGoalId),
				),
			)
			.groupBy(moves.month),
	]);
	// Months are always written as MonthKeys.
	return freeCarriedIn({
		records,
		outOfFree: outOfFree as MonthAmount[],
		extraToFree: extraToFree as MonthAmount[],
		month,
	});
}

/**
 * The same, for a caller without the Plan's records: they are only read when the month before
 * builds up, so a Household whose Free to Spend starts fresh costs one small query.
 */
export async function loadFreeCarriedInto(
	db: Db,
	householdId: string,
	month: MonthKey,
): Promise<Cents> {
	const settings = await db
		.select({ month: freeToSpendCarry.month, carries: freeToSpendCarry.carries })
		.from(freeToSpendCarry)
		.where(and(eq(freeToSpendCarry.householdId, householdId), lt(freeToSpendCarry.month, month)));
	const freeCarries = settings as NonNullable<PlanRecords["freeCarries"]>;
	if (freeCarrySince({ freeCarries }, month) === null) return 0;
	return loadFreeCarriedIn(db, householdId, await loadPlanRecords(db, householdId, month), month);
}

/**
 * Sets whether Free to Spend builds up (true) or starts fresh (false) from `month` onward, until
 * it is set again for a later month. Setting it again for the same month replaces it.
 */
export async function setFreeToSpendCarry(
	db: Db,
	input: { householdId: string; month: MonthKey; carries: boolean },
): Promise<void> {
	await db
		.insert(freeToSpendCarry)
		.values(input)
		.onConflictDoUpdate({
			target: [freeToSpendCarry.householdId, freeToSpendCarry.month],
			set: { carries: input.carries },
		});
}

/** The Household's "Keep back" amount: 0 until a Parent sets one. */
export async function loadFreeToSpendKeepBack(db: Db, householdId: string): Promise<Cents> {
	const [row] = await db
		.select({ keep: households.freeToSpendKeepCents })
		.from(households)
		.where(eq(households.id, householdId));
	return row?.keep ?? 0;
}

/** Sets the Household's "Keep back" amount; below zero is stored as none. */
export async function setFreeToSpendKeepBack(
	db: Db,
	input: { householdId: string; amountCents: Cents },
): Promise<void> {
	await db
		.update(households)
		.set({ freeToSpendKeepCents: Math.max(0, Math.round(input.amountCents)) })
		.where(eq(households.id, input.householdId));
}
