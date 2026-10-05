import {
	actualFigures,
	addMonths,
	type Cents,
	type DayKey,
	type FreeCarryMonth,
	firstCarryMonth,
	freeCarryMonths,
	type MonthAmount,
	type MonthKey,
	mergeCells,
	type PlanRecords,
} from "@noodle/domain";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { Db } from "./index";
import { loadPlanRecords } from "./plan";
import { loadIncomeCells, loadSpendCells } from "./reports";
import { moves } from "./schema";

// Free to Spend is carried over (issue 113, ADR-0054): the amounts the walk in @noodle/domain
// (free-carry.ts) needs. What is carried is never stored.

type Viewer = { householdId: string; memberId: string };

const firstOf = (month: MonthKey) => `${month}-01` as DayKey;

/**
 * Free to Spend month by month (see freeCarryMonths in @noodle/domain) from the Household's first
 * month with a Plan through `through`. `current` is the Household's month; `records` must reach
 * `through`.
 *
 * Whatever the number of months, this is three round trips: the months' Moves grouped by month
 * (one statement), and for the ended months the same two reads Plan › Year's "Actual" makes,
 * spending grouped by month and Target (one batch) and income grouped by month, so what an ended
 * month hands on is the Actual Free to Spend the Parent sees there. The viewer only decides which
 * spending arrives as a private total; the sum is the same for both Parents.
 */
export async function loadFreeCarryMonths(
	db: Db,
	viewer: Viewer,
	records: PlanRecords,
	through: MonthKey,
	current: MonthKey,
): Promise<FreeCarryMonth[]> {
	const from = firstCarryMonth(records, through);
	if (from === null) return [];
	// Ended months: from the first planned month up to the Household's month, or `through`.
	const endedUntil = current <= through ? current : addMonths(through, 1);
	const range = { from: firstOf(from), until: firstOf(endedUntil) };
	const hasEnded = from < endedUntil;
	const [moved, spending, income] = await Promise.all([
		db
			.select({
				month: moves.month,
				// The same two sums as freeToSpendSql (moves.ts), a month at a time.
				outOfFree: sql<number>`coalesce(sum(case when ${moves.fromBucketId} is null and ${moves.kind} <> 'windfall' then ${moves.amountCents} end), 0)`,
				extraToFree: sql<number>`coalesce(sum(case when ${moves.kind} = 'windfall' and ${moves.toBucketId} is null and ${moves.toGoalId} is null then ${moves.amountCents} end), 0)`,
				// Goal funding: Moves from Free to Spend into Goals, as Plan › Year's Actual counts it.
				goalFunding: sql<number>`coalesce(sum(case when ${moves.kind} = 'goal-funding' and ${moves.toGoalId} is not null then ${moves.amountCents} end), 0)`,
			})
			.from(moves)
			.where(
				and(
					eq(moves.householdId, viewer.householdId),
					gte(moves.month, from),
					lte(moves.month, through),
				),
			)
			.groupBy(moves.month),
		hasEnded ? loadSpendCells(db, { viewer, range, filters: {} }, "month") : null,
		hasEnded ? loadIncomeCells(db, viewer.householdId, range, "month") : [],
	]);
	// Months are always written as MonthKeys.
	const byMonth = (key: "outOfFree" | "extraToFree" | "goalFunding") =>
		moved.map((row) => ({ month: row.month as MonthKey, amount: row[key] }));
	const actuals = {
		spending: spending ? mergeCells(spending.cells, spending.privateMonths) : [],
		income: income.map((cell) => ({ month: cell.period as MonthKey, amount: cell.amount })),
		goalFunding: byMonth("goalFunding"),
	};
	const actual: MonthAmount[] = [];
	for (let month = from; month < endedUntil; month = addMonths(month, 1)) {
		actual.push({ month, amount: actualFigures(actuals, month).freeToSpend });
	}
	return freeCarryMonths({
		records,
		current,
		actual,
		outOfFree: byMonth("outOfFree"),
		extraToFree: byMonth("extraToFree"),
		to: through,
	});
}

/**
 * What the months before `month` left for its Free to Spend, or were short by (see freeCarriedIn
 * in @noodle/domain). `records` must include every Plan record before `month`.
 */
export async function loadFreeCarriedIn(
	db: Db,
	viewer: Viewer,
	records: PlanRecords,
	month: MonthKey,
	current: MonthKey,
): Promise<Cents> {
	const months = await loadFreeCarryMonths(db, viewer, records, addMonths(month, -1), current);
	return months[months.length - 1]?.left ?? 0;
}

/** The same, for a caller without the Plan's records. */
export async function loadFreeCarriedInto(
	db: Db,
	viewer: Viewer,
	month: MonthKey,
	current: MonthKey,
): Promise<Cents> {
	const records = await loadPlanRecords(db, viewer.householdId, month);
	return loadFreeCarriedIn(db, viewer, records, month, current);
}
