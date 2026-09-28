import {
	type BucketSpend,
	type CommitmentCharge,
	type Db,
	loadCharges,
	loadMoves,
	loadPlanRecords,
	loadRolledOver,
	loadSpending,
	type PlanMove,
} from "@noodle/db";
import {
	type Cents,
	type DayKey,
	dayKeyAt,
	type MonthKey,
	monthKeyAt,
	type Plan,
	planForMonth,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { type HouseholdSummary, householdMiddleware } from "./household";

export const monthKeySchema = z
	.string()
	.regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM")
	.transform((month) => month as MonthKey);

/**
 * The inputs to a month's state: its Plan, the spending, Commitment payments, and Moves recorded
 * in it, what each Bucket carried in from earlier months, and today in the Household's time
 * zone. Components derive the state with `monthState` from @noodle/domain, so an optimistic edit
 * to these inputs updates every number the same way the server would.
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
	asOf: DayKey;
	/** Past months' Plans are closed; this month and later can be changed. */
	editable: boolean;
};

/** A month's inputs, read from D1 now. */
export async function loadMonth(
	db: Db,
	household: Pick<HouseholdSummary, "id" | "timeZone">,
	month: MonthKey,
): Promise<MonthData> {
	const [records, spending, charges, moves] = await Promise.all([
		loadPlanRecords(db, household.id, month),
		loadSpending(db, household.id, month),
		loadCharges(db, household.id, month),
		loadMoves(db, household.id, month),
	]);
	const rolledOver = await loadRolledOver(db, household.id, records, month);
	const now = new Date();
	return {
		plan: planForMonth(records, month),
		spending,
		charges,
		moves,
		rolledOver,
		asOf: dayKeyAt(now, household.timeZone),
		editable: month >= monthKeyAt(now, household.timeZone),
	};
}

export const getMonth = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ month: monthKeySchema }))
	.handler(
		({ data, context }): Promise<MonthData> => loadMonth(getDb(), context.household, data.month),
	);
