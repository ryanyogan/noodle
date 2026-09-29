import { env } from "cloudflare:workers";
import { closeMonth as closeMonthInDb, type MonthCloseResult } from "@noodle/db";
import {
	fitsProposal,
	MAX_CENTS,
	type MonthKey,
	monthCloseProposal,
	monthKeyAt,
	monthState,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { loadMonth, monthKeySchema } from "./month";
import { closeMonthInput, MONTH_CLOSE_DECIDED, monthCloseInstanceId } from "./month-close-run";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// The Parents' decision as a month closes; the Month-close Workflow (month-close-run) waits for it
// and applies the defaults when it doesn't come.

export type CloseMonthOutcome = MonthCloseResult | { ok: false; reason: "changed" };

const amountSchema = z.number().int().min(1).max(MAX_CENTS);

/**
 * The Parents' decision for a month that has ended: which leftovers are Swept into which Goals,
 * and where the pending Windfall goes. Everything left out stays where it is. Refused once the
 * month is closed, and when the decision no longer fits what the month has left.
 */
export const closeMonth = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			closeId: ulidSchema,
			month: monthKeySchema,
			sweeps: z.array(
				z.object({ bucketId: ulidSchema, goalId: ulidSchema, amountCents: amountSchema }),
			),
			windfall: z.array(
				z.object({ moveId: ulidSchema, goalId: ulidSchema, amountCents: amountSchema }),
			),
		}),
	)
	.handler(async ({ data, context }): Promise<CloseMonthOutcome> => {
		const { household } = context;
		if (data.month >= monthKeyAt(new Date(), household.timeZone)) {
			throw new Error("That month hasn’t ended.");
		}
		const db = getDb();
		const month = await loadMonth(db, household, context.parent.id, data.month);
		if (month.closed) return { ok: false, reason: "already-closed" };
		const decision = {
			sweeps: data.sweeps.map((s) => ({
				bucketId: s.bucketId,
				goalId: s.goalId,
				amount: s.amountCents,
			})),
			windfall: data.windfall.map((w) => ({ goalId: w.goalId, amount: w.amountCents })),
		};
		if (!fitsProposal(monthCloseProposal(monthState(month)), decision)) {
			return { ok: false, reason: "changed" };
		}
		const result = await closeMonthInDb(
			db,
			closeMonthInput({
				householdId: household.id,
				month: data.month,
				closeId: data.closeId,
				decidedByMemberId: context.parent.id,
				decision,
				rolledOver: month.rolledOver,
				moveId: (bucketId) => `${data.closeId}:${bucketId}`,
				windfallMoveIds: data.windfall.map((w) => w.moveId),
			}),
		);
		if (!result.ok) return result;
		await Promise.all([
			tellWorkflow(household.id, data.month, data.closeId),
			notifyHousehold(household.id, ["goals", `month:${data.month}`]),
		]);
		return result;
	});

/** Lets the month's Workflow finish; there's none when the month closed before it started. */
async function tellWorkflow(householdId: string, month: MonthKey, closeId: string) {
	try {
		const instance = await env.MONTH_CLOSE.get(monthCloseInstanceId(householdId, month));
		await instance.sendEvent({ type: MONTH_CLOSE_DECIDED, payload: { closeId } });
	} catch {
		// No instance (or it has finished): nothing is waiting for the decision.
	}
}
