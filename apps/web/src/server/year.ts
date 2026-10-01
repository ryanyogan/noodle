import {
	type Db,
	type GoalRecords,
	loadBucketMonths,
	loadGoals,
	loadIncome,
	loadIncomeCells,
	loadMovesBetween,
	loadPlanRecords,
	loadSpendCells,
} from "@noodle/db";
import {
	addMonths,
	type DayKey,
	dayKeyAt,
	HEALTH_HABIT_MONTHS,
	HEALTH_MONTHS_AHEAD,
	MAX_PROJECTION_MONTHS,
	type MonthKey,
	mergeCells,
	monthOfDay,
	type PlanWarning,
	planHealth,
	setAsideOf,
	type YearMonth,
	yearGrid,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";

/** The year view's first year: nothing was planned before it. */
export const FIRST_YEAR = 2000;

/** The last year the year view projects to, from `month` (a Scenario's furthest). */
export const lastYearFrom = (month: MonthKey) =>
	Number(addMonths(month, MAX_PROJECTION_MONTHS - 1).slice(0, 4));

export type YearData = {
	year: number;
	current: MonthKey;
	/** The last year the view reaches. */
	lastYear: number;
	months: YearMonth[];
} | null;

/** The active Goals, as they stand now. */
const activeGoals = (goals: GoalRecords) => goals.goals.filter((g) => !g.completed && !g.archived);

const firstOf = (month: MonthKey) => `${month}-01` as DayKey;

/**
 * A year of the Plan, month by month, as the Parent may see it: the other Parent's Personal
 * Allowance spending counts only as its monthly total, folded into what the Buckets spent.
 */
export const getYear = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ year: z.number().int() }))
	.handler(async ({ data, context }): Promise<YearData> => {
		const db = getDb();
		const { household } = context;
		const viewer = viewerOf(context);
		const current = monthOfDay(dayKeyAt(new Date(), household.timeZone));
		const lastYear = lastYearFrom(current);
		// A year outside the Plan has nothing to show.
		if (data.year < FIRST_YEAR || data.year > lastYear) return null;
		const first = `${data.year}-01` as MonthKey;
		const last = addMonths(first, 11);
		// Actuals run from January up to the end of this month, or the year's end if earlier.
		const actualUntil = last < current ? addMonths(last, 1) : addMonths(current, 1);
		const range = { from: firstOf(first), until: firstOf(actualUntil) };
		const hasActuals = first <= current;
		const [records, goals, spending, income, moves] = await Promise.all([
			loadPlanRecords(db, household.id, last > current ? last : current),
			loadGoals(db, viewer),
			hasActuals ? loadSpendCells(db, { viewer, range, filters: {} }, "month") : null,
			hasActuals ? loadIncomeCells(db, household.id, range, "month") : [],
			hasActuals ? loadMovesBetween(db, household.id, first, actualUntil) : [],
		]);
		const months = yearGrid({
			year: data.year,
			current,
			records,
			goals: projectionGoals(goals, current),
			actuals: {
				spending: spending ? mergeCells(spending.cells, spending.privateMonths) : [],
				income: income.map((c) => ({ month: c.period as MonthKey, amount: c.amount })),
				goalFunding: goals.changes
					.filter((c) => c.kind === "funding" && c.from === undefined)
					.filter((c) => c.month >= first && c.month <= last),
				covers: moves.filter((m) => m.fromBucketId === null && !m.windfall),
			},
		});
		return { year: data.year, current, lastYear, months };
	});

/** The active Goals as a projection funds them from `month` on. */
function projectionGoals(goals: GoalRecords, month: MonthKey) {
	return activeGoals(goals).map((g) => ({
		id: g.id,
		target: g.target,
		targetDate: g.targetDate,
		saved: setAsideOf(g.id, goals.changes),
		fundedThisMonth: setAsideOf(
			g.id,
			goals.changes.filter((c) => c.kind === "funding" && c.month === month),
		),
	}));
}

export type PlanHealthData = { month: MonthKey; warnings: PlanWarning[] };

/** What in the Plan needs attention now, for the Parent signed in (see planHealth). */
export async function loadPlanHealth(
	db: Db,
	viewer: { householdId: string; memberId: string },
	asOf: DayKey,
): Promise<PlanHealthData> {
	const month = monthOfDay(asOf);
	const since = addMonths(month, -HEALTH_HABIT_MONTHS);
	const [records, goals, income, spent] = await Promise.all([
		loadPlanRecords(db, viewer.householdId, addMonths(month, HEALTH_MONTHS_AHEAD)),
		loadGoals(db, viewer),
		loadIncome(db, viewer.householdId, addMonths(month, -1), addMonths(month, 1)),
		loadBucketMonths(db, viewer, since, month),
	]);
	const warnings = planHealth({
		asOf,
		parentId: viewer.memberId,
		records,
		goals: activeGoals(goals),
		changes: goals.changes,
		income,
		spent,
	});
	return { month, warnings };
}

export const getPlanHealth = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(({ context }) =>
		loadPlanHealth(getDb(), viewerOf(context), dayKeyAt(new Date(), context.household.timeZone)),
	);
