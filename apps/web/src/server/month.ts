import {
	type BucketSpend,
	type CommitmentCharge,
	loadCharges,
	loadPlanRecords,
	loadSpending,
} from "@noodle/db";
import {
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
import { householdMiddleware } from "./household";

export const monthKeySchema = z
	.string()
	.regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM")
	.transform((month) => month as MonthKey);

/**
 * The inputs to a month's state: its Plan, the spending and Commitment payments recorded in it,
 * and today in the Household's time zone. Components derive the state with `monthState` from
 * @noodle/domain, so an optimistic edit to these inputs updates every number the same way the
 * server would.
 */
export type MonthData = {
	plan: Plan;
	spending: BucketSpend[];
	charges: CommitmentCharge[];
	asOf: DayKey;
	/** Past months' Plans are closed; this month and later can be changed. */
	editable: boolean;
};

export const getMonth = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ month: monthKeySchema }))
	.handler(async ({ data, context }): Promise<MonthData> => {
		const { id, timeZone } = context.household;
		const db = getDb();
		const [records, spending, charges] = await Promise.all([
			loadPlanRecords(db, id, data.month),
			loadSpending(db, id, data.month),
			loadCharges(db, id, data.month),
		]);
		const now = new Date();
		return {
			plan: planForMonth(records, data.month),
			spending,
			charges,
			asOf: dayKeyAt(now, timeZone),
			editable: data.month >= monthKeyAt(now, timeZone),
		};
	});
