import { looksPersonToPerson, type MonthKey, moneyInOnImport } from "@noodle/domain";
import { and, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { incomeCounts } from "./counting";
import { decidedSql, extraIncomeSql } from "./extra-income";
import type { Db } from "./index";
import { loadMoneyInRules } from "./money-in";
import { householdPasses, households, income } from "./schema";

// The one-time pass of ADR-0057: October 2026's person-to-person money in, which was counted as
// Income when it was imported, goes back to Review. It runs once per Household (the row in
// `household_passes` is written with the change, in one batch), takes a snapshot first, changes
// only `income.needs_review`, and deletes nothing. A line stays as it is while what's already been
// decided of October's Extra income would no longer be covered without it (ADR-0052): that one is
// left for a Parent.

export const MONEY_IN_PASS = "money-in-2026-10";
const PASS_MONTH: MonthKey = "2026-10";
const PASS_FROM = "2026-10-01";
const PASS_UNTIL = "2026-11-01";

/** The Households the pass hasn't run for yet. */
export async function householdsAwaitingMoneyInPass(db: Db): Promise<string[]> {
	const rows = await db
		.select({ id: households.id })
		.from(households)
		.where(
			sql`not exists (select 1 from household_passes p
				where p.household_id = ${households.id} and p.pass = ${MONEY_IN_PASS})`,
		);
	return rows.map((row) => row.id);
}

/**
 * A line the pass may send back: imported, still plain Income nobody has touched (never given a
 * kind, never a side of a Transfer, even one since unmarked, never changed by a Parent).
 */
const untouched = and(
	isNotNull(income.accountId),
	isNull(income.kind),
	eq(income.needsReview, false),
	eq(income.version, 0),
	sql`not exists (select 1 from transfers x where x.in_income_id = ${income.id})`,
);

export type MoneyInPassResult = {
	/** False when it had already run for the Household: nothing was read or written. */
	ran: boolean;
	/** How many lines went back to Review. */
	changed: number;
	snapshotId: string | null;
};

/**
 * Runs the pass for one Household, once. `snapshot` takes the Household's snapshot and returns
 * its ID; it is called only when there is something to change, and before anything is written
 * (if it fails, nothing is written and the pass runs another night). `runId` names this run:
 * only the run whose row lands changes anything, so two at once can't both.
 */
export async function runMoneyInPass(
	db: Db,
	householdId: string,
	input: { runId: string; snapshot: () => Promise<string> },
): Promise<MoneyInPassResult> {
	const ran = and(
		eq(householdPasses.householdId, householdId),
		eq(householdPasses.pass, MONEY_IN_PASS),
	);
	const [already] = await db
		.select({ runId: householdPasses.runId })
		.from(householdPasses)
		.where(ran);
	if (already) return { ran: false, changed: 0, snapshotId: null };

	const [rows, rules] = await Promise.all([
		db
			.select({ id: income.id, note: income.note })
			.from(income)
			.where(
				and(
					eq(income.householdId, householdId),
					gte(income.date, PASS_FROM),
					lt(income.date, PASS_UNTIL),
					untouched,
				),
			)
			.orderBy(income.date, income.id),
		loadMoneyInRules(db, householdId),
	]);
	// Person-to-person wording with no payroll and no Rule, whatever its memo says ("ZELLE FROM JOHN
	// refund for tickets" too). Only that: a store's refund or a payment that came back waits in
	// Review on Import from issue 141 on, but those already here were Income under the old rules
	// and are left as they are.
	const ids = rows
		.filter((row) => looksPersonToPerson(row.note) && moneyInOnImport(row.note, rules).review)
		.map((row) => row.id);
	const snapshotId = ids.length > 0 ? await input.snapshot() : null;

	const mine = sql`exists (select 1 from household_passes p where p.household_id = ${householdId}
		and p.pass = ${MONEY_IN_PASS} and p.run_id = ${input.runId})`;
	const inReview = sql`(select count(*) from income i, json_each(${JSON.stringify(ids)}) j
		where i.id = j.value and i.household_id = ${householdId} and i.needs_review = 1)`;
	await db.batch([
		db
			.insert(householdPasses)
			.values({ householdId, pass: MONEY_IN_PASS, runId: input.runId, snapshotId })
			.onConflictDoNothing(),
		// One line at a time, so each sees what the ones before it left of the Extra income.
		...ids.map((id) =>
			db
				.update(income)
				.set({ needsReview: true })
				.where(
					and(
						eq(income.id, id),
						eq(income.householdId, householdId),
						untouched,
						mine,
						sql`(not ${incomeCounts()} or ${extraIncomeSql(householdId, PASS_MONTH, sql.raw("income.amount_cents"))} >= ${decidedSql(householdId, PASS_MONTH)})`,
					),
				),
		),
		db
			.update(householdPasses)
			.set({ changed: inReview })
			.where(and(ran, eq(householdPasses.runId, input.runId))),
	]);
	const [row] = await db
		.select({ runId: householdPasses.runId, changed: householdPasses.changed })
		.from(householdPasses)
		.where(ran);
	// Another run got there first: this one changed nothing (its snapshot is just one more).
	if (row?.runId !== input.runId) return { ran: false, changed: 0, snapshotId: null };
	return { ran: true, changed: row.changed, snapshotId };
}
