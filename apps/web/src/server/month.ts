import {
	type BucketSpend,
	type CommitmentCharge,
	type Db,
	type IncomeRecord,
	loadCharges,
	loadGoalFunding,
	loadIncome,
	loadMonthClose,
	loadMoves,
	loadPlanRecords,
	loadRolledOver,
	loadSpending,
	loadSweeps,
	type MonthCloseRecord,
	type PlanMove,
	type PlanSweep,
} from "@noodle/db";
import {
	addMonths,
	type Cents,
	type DayKey,
	dayKeyAt,
	type GoalFunding,
	type MonthKey,
	monthKeyAt,
	type Plan,
	planForMonth,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { type HouseholdSummary, householdMiddleware, viewerOf } from "./household";

export const monthKeySchema = z
	.string()
	.regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM")
	.transform((month) => month as MonthKey);

/**
 * The inputs to a month's state: its Plan, the spending, Commitment payments, Moves, Goal
 * funding, and income recorded in it, what each Bucket carried in from earlier months, and today
 * in the Household's time zone. Components derive the state with `monthState` from @noodle/domain, so
 * an optimistic edit to these inputs updates every number the same way the server would.
 */
export type MonthData = {
	plan: Plan;
	spending: BucketSpend[];
	charges: CommitmentCharge[];
	moves: PlanMove[];
	/**
	 * Per Bucket ID, what rolled over from last month. It depends only on earlier months, and a
	 * Plan change this month only changes what rolls into later ones.
	 */
	rolledOver: Record<string, Cents>;
	/** Moves from Free to Spend into Goals' Earmarks. */
	goalFunding: (GoalFunding & { id: string })[];
	/** Fresh-start Buckets' leftovers Swept into Goals as the month closed. */
	sweeps: PlanSweep[];
	/** How the month was closed (see month-close), or null while it hasn't been. */
	closed: MonthCloseRecord | null;
	/** Income received this month and last (last month's sets what's expected by now). */
	income: IncomeRecord[];
	asOf: DayKey;
	/** Past months' Plans are closed; this month and later can be changed. */
	editable: boolean;
};

/**
 * A month's inputs as the Parent `parentId` may see them, read from D1 now: the other Parent's
 * Personal Allowance spending only as its total.
 */
export async function loadMonth(
	db: Db,
	household: Pick<HouseholdSummary, "id" | "timeZone">,
	parentId: string,
	month: MonthKey,
): Promise<MonthData> {
	const viewer = viewerOf({ household, parent: { id: parentId } });
	const [records, spending, charges, moves, goalFunding, sweeps, closed, income] =
		await Promise.all([
			loadPlanRecords(db, household.id, month),
			loadSpending(db, viewer, month),
			loadCharges(db, viewer, month),
			loadMoves(db, household.id, month),
			loadGoalFunding(db, household.id, month),
			loadSweeps(db, household.id, month),
			loadMonthClose(db, household.id, month),
			loadIncome(db, household.id, addMonths(month, -1), addMonths(month, 1)),
		]);
	const rolledOver = await loadRolledOver(db, household.id, records, month);
	const now = new Date();
	return {
		plan: planForMonth(records, month),
		spending,
		charges,
		moves,
		rolledOver,
		goalFunding,
		sweeps,
		closed,
		income,
		asOf: dayKeyAt(now, household.timeZone),
		editable: month >= monthKeyAt(now, household.timeZone),
	};
}

export const getMonth = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ month: monthKeySchema }))
	.handler(
		({ data, context }): Promise<MonthData> =>
			loadMonth(getDb(), context.household, context.parent.id, data.month),
	);
