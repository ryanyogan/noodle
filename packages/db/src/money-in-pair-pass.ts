import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "./index";
import { householdPasses, households, moneyInPairs, moneyInRules } from "./schema";

// The one-time pass of issue 142: a pair of Accounts remembered before pairs had a table of their
// own is kept on its money-in Rule (`money_in_rules` with `into_account_id` set) until a Parent
// says it again, and saying it again makes a new pair dated that day. Once per Household each old
// pair is carried to `money_in_pairs` as it was made: the same id, wording, Accounts, Parent and
// day. The Log reads a live pair from its own row, so it goes on showing the pair as made when it
// was, and a later removal records that day too (moneyInPairRemovedEvents). Nothing is written to
// `log_events`: a row there as well would show the pair made twice.
//
// It moves Rules only: no line of money, Transfer or month is read or changed. The marker, the
// copy and the clearing of the old row are one batch, and the old row goes only once its copy is
// there. An old pair whose wording and Account have been remembered again since is left where it
// is (loadMoneyInRules already reads the newer one), as is one that names no other Account.

export const MONEY_IN_PAIR_PASS = "money-in-pairs-2026-10";

/** The Households the pass hasn't run for yet. */
export async function householdsAwaitingMoneyInPairPass(db: Db): Promise<string[]> {
	const rows = await db
		.select({ id: households.id })
		.from(households)
		.where(
			sql`not exists (select 1 from household_passes p
				where p.household_id = ${households.id} and p.pass = ${MONEY_IN_PAIR_PASS})`,
		);
	return rows.map((row) => row.id);
}

export type MoneyInPairPassResult = {
	/** False when it had already run for the Household: nothing was written. */
	ran: boolean;
	/** How many pairs were carried to their own table. */
	carried: number;
};

/**
 * Runs the pass for one Household, once. `runId` names this run: only the run whose row lands in
 * `household_passes` carries anything, so two at once can't both.
 */
export async function runMoneyInPairPass(
	db: Db,
	householdId: string,
	input: { runId: string },
): Promise<MoneyInPairPassResult> {
	const ran = and(
		eq(householdPasses.householdId, householdId),
		eq(householdPasses.pass, MONEY_IN_PAIR_PASS),
	);
	const [already] = await db
		.select({ runId: householdPasses.runId })
		.from(householdPasses)
		.where(ran);
	if (already) return { ran: false, carried: 0 };

	const mine = sql`exists (select 1 from household_passes p where p.household_id = ${householdId}
		and p.pass = ${MONEY_IN_PAIR_PASS} and p.run_id = ${input.runId})`;
	const oldPairs = and(
		eq(moneyInRules.householdId, householdId),
		eq(moneyInRules.kind, "transfer"),
		isNotNull(moneyInRules.intoAccountId),
		isNotNull(moneyInRules.otherAccountId),
	);
	/** The old pairs still to carry, counted before any is: what this run will have carried. */
	const waiting = sql<number>`(select count(*) from money_in_rules r
		where r.household_id = ${householdId} and r.kind = 'transfer'
			and r.into_account_id is not null and r.other_account_id is not null
			and not exists (select 1 from money_in_pairs p where p.household_id = r.household_id
				and p.pattern = r.pattern and p.into_account_id = r.into_account_id))`;
	await db.batch([
		db
			.insert(householdPasses)
			.values({
				householdId,
				pass: MONEY_IN_PAIR_PASS,
				runId: input.runId,
				snapshotId: null,
				changed: waiting,
			})
			.onConflictDoNothing(),
		// The fields in the table's own order. One already remembered for the wording and Account
		// (the unique index) keeps its place: nothing is copied over it.
		db
			.insert(moneyInPairs)
			.select(
				db
					.select({
						id: moneyInRules.id,
						householdId: moneyInRules.householdId,
						pattern: moneyInRules.pattern,
						intoAccountId: sql<string>`${moneyInRules.intoAccountId}`.as("into_account_id"),
						otherAccountId: sql<string>`${moneyInRules.otherAccountId}`.as("other_account_id"),
						createdByMemberId: moneyInRules.createdByMemberId,
						createdAt: moneyInRules.createdAt,
					})
					.from(moneyInRules)
					.where(and(oldPairs, mine)),
			)
			.onConflictDoNothing(),
		// Only an old row whose copy is there goes.
		db.delete(moneyInRules).where(
			and(
				oldPairs,
				mine,
				sql`exists (select 1 from money_in_pairs p where p.id = ${moneyInRules.id}
						and p.household_id = ${moneyInRules.householdId}
						and p.pattern = ${moneyInRules.pattern}
						and p.into_account_id = ${moneyInRules.intoAccountId}
						and p.created_at = ${moneyInRules.createdAt})`,
			),
		),
	]);
	const [row] = await db
		.select({ runId: householdPasses.runId, changed: householdPasses.changed })
		.from(householdPasses)
		.where(ran);
	// Another run got there first: this one carried nothing.
	if (row?.runId !== input.runId) return { ran: false, carried: 0 };
	return { ran: true, carried: row.changed };
}

/**
 * The pass for every Household it hasn't run for, from the nightly cron. One Household failing is
 * logged and tried again the next night.
 */
export async function runMoneyInPairPasses(db: Db, newId: () => string) {
	const waiting = await householdsAwaitingMoneyInPairPass(db);
	let carried = 0;
	let failed = 0;
	for (const householdId of waiting) {
		try {
			carried += (await runMoneyInPairPass(db, householdId, { runId: newId() })).carried;
		} catch (error) {
			failed++;
			console.error(`Couldn’t carry remembered pairs for Household ${householdId}`, error);
		}
	}
	return { households: waiting.length, carried, failed };
}
