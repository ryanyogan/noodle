import { sql } from "drizzle-orm";
import { markCardPayments } from "./card-payments";
import type { Db } from "./index";
import { householdPasses, households } from "./schema";

// The one-time pass of issue 136: payments that arrived on a Household's credit cards before the
// card's side of a payment was read by its words ("PAYMENT THANK YOU") said "Money back". Once per
// Household they are marked as Transfers, paired with the line that paid them when it is here.
// It only adds rows to `transfers` (markCardPayments), so nothing is deleted, "Unmark" undoes each
// one, and no snapshot is taken first. The row in `household_passes` stops the nightly cron from
// looking again; an Import or bank sync still marks what comes in later.

export const CARD_PAYMENT_PASS = "card-payments-2026-10";

/** The Households the pass hasn't run for yet. */
export async function householdsAwaitingCardPaymentPass(db: Db): Promise<string[]> {
	const rows = await db
		.select({ id: households.id })
		.from(households)
		.where(
			sql`not exists (select 1 from household_passes p
				where p.household_id = ${households.id} and p.pass = ${CARD_PAYMENT_PASS})`,
		);
	return rows.map((row) => row.id);
}

export type CardPaymentPassResult = {
	/** False when it had already run for the Household: nothing was read or written. */
	ran: boolean;
	/** How many lines were marked or paired. */
	marked: number;
	months: string[];
};

/**
 * Runs the pass for one Household, once. Marking is idempotent, so two runs at once mark each
 * line once between them; the marker is written after the marks, so a run that fails part way is
 * tried again.
 */
export async function runCardPaymentPass(
	db: Db,
	householdId: string,
	input: { runId: string; newId: () => string },
): Promise<CardPaymentPassResult> {
	const [already] = await db
		.select({ runId: householdPasses.runId })
		.from(householdPasses)
		.where(
			sql`${householdPasses.householdId} = ${householdId} and ${householdPasses.pass} = ${CARD_PAYMENT_PASS}`,
		);
	if (already) return { ran: false, marked: 0, months: [] };
	const result = await markCardPayments(db, householdId, input.newId);
	await db
		.insert(householdPasses)
		.values({
			householdId,
			pass: CARD_PAYMENT_PASS,
			runId: input.runId,
			snapshotId: null,
			changed: result.marked,
		})
		.onConflictDoNothing();
	return { ran: true, ...result };
}

/**
 * The pass for every Household it hasn't run for, from the nightly cron. One Household failing is
 * logged and tried again the next night.
 */
export async function runCardPaymentPasses(db: Db, newId: () => string) {
	const waiting = await householdsAwaitingCardPaymentPass(db);
	let marked = 0;
	let failed = 0;
	for (const householdId of waiting) {
		try {
			marked += (await runCardPaymentPass(db, householdId, { runId: newId(), newId })).marked;
		} catch (error) {
			failed++;
			console.error(`Couldn’t run the card-payment pass for Household ${householdId}`, error);
		}
	}
	return { households: waiting.length, marked, failed };
}
