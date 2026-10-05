import {
	type BetweenUsIncome,
	type BucketSpend,
	type CommitmentCharge,
	type Db,
	type IncomeRecord,
	loadBetweenUsIncome,
	loadCharges,
	loadExtraToFree,
	loadFreeCarryMonths,
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
	type ExtraToFree,
	firstPlanMonth,
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
	/** The Plan in force the month before, to show what this month's Plan changed. */
	planBefore: Plan;
	spending: BucketSpend[];
	charges: CommitmentCharge[];
	moves: PlanMove[];
	/**
	 * Per Bucket ID, what rolled over from last month. It depends only on earlier months, and a
	 * Plan change this month only changes what rolls into later ones.
	 */
	rolledOver: Record<string, Cents>;
	/**
	 * What the months before left for this month's Free to Spend, or were short by (issue 113);
	 * 0 for the first month with a Plan. Like `rolledOver`, it depends only on earlier months.
	 */
	freeCarriedIn?: Cents;
	/**
	 * What each of the last months (six at most, oldest first, ending with last month) handed on,
	 * since the first month with a Plan.
	 */
	freeBuiltUp?: { month: MonthKey; amount: Cents }[];
	/** For an ended month, what it handed on to the next: what it actually ended with. */
	freeHandedOn?: Cents;
	/** Moves from Free to Spend into what Goals have set aside. */
	goalFunding: (GoalFunding & { id: string })[];
	/** Extra income a Parent added to the month's Free to Spend. */
	extraToFree?: (ExtraToFree & { id: string })[];
	/** Buckets that reset monthly' leftovers Swept into Goals as the month closed. */
	sweeps: PlanSweep[];
	/** How the month was closed (see month-close), or null while it hasn't been. */
	closed: MonthCloseRecord | null;
	/** Income received this month and last (last month's sets what's expected by now). */
	income: IncomeRecord[];
	/** This month's income a Parent marked as between the two of them: listed, never counted. */
	betweenUs?: BetweenUsIncome[];
	asOf: DayKey;
	/** Past months' Plans are closed; this month and later can be changed. */
	editable: boolean;
	/** The first month with a Plan (firstPlanMonth): months before it have nothing to show. */
	firstMonth: MonthKey;
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
	const [
		records,
		spending,
		charges,
		moves,
		goalFunding,
		sweeps,
		closed,
		income,
		extraToFree,
		betweenUs,
	] = await Promise.all([
		loadPlanRecords(db, household.id, month),
		loadSpending(db, viewer, month),
		loadCharges(db, viewer, month),
		loadMoves(db, household.id, month),
		loadGoalFunding(db, household.id, month),
		loadSweeps(db, household.id, month),
		loadMonthClose(db, household.id, month),
		loadIncome(db, household.id, addMonths(month, -1), addMonths(month, 1)),
		loadExtraToFree(db, household.id, month),
		loadBetweenUsIncome(db, household.id, month, addMonths(month, 1)),
	]);
	const now = new Date();
	const current = monthKeyAt(now, household.timeZone);
	const [rolledOver, carried] = await Promise.all([
		loadRolledOver(db, household.id, records, month),
		loadFreeCarryMonths(db, viewer, records, month, current),
	]);
	const own = carried.find((m) => m.month === month);
	const freeBuiltUp = carried
		.filter((m) => m.month < month)
		.slice(-6)
		.map((m) => ({ month: m.month, amount: m.left }));
	const freeCarriedIn = own?.carriedIn ?? 0;
	return {
		plan: planForMonth(records, month),
		planBefore: planForMonth(records, addMonths(month, -1)),
		spending,
		charges,
		moves,
		rolledOver,
		freeCarriedIn,
		freeBuiltUp,
		...(own?.ended ? { freeHandedOn: own.left } : {}),
		goalFunding,
		extraToFree,
		sweeps,
		closed,
		income,
		betweenUs,
		asOf: dayKeyAt(now, household.timeZone),
		editable: month >= current,
		firstMonth: firstPlanMonth(records, current),
	};
}

export const getMonth = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ month: monthKeySchema }))
	.handler(
		({ data, context }): Promise<MonthData> =>
			loadMonth(getDb(), context.household, context.parent.id, data.month),
	);
