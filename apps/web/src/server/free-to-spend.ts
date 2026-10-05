import {
	setFreeToSpendCarry as setFreeToSpendCarryInDb,
	setFreeToSpendKeepBack as setFreeToSpendKeepBackInDb,
} from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { assertEditable, centsSchema } from "./plan";

// What happens to Free to Spend at the end of the month (issue 113, ADR-0054). Both are
// idempotent, and both tell every screen that every month changed: what a month carries over is
// part of the next month's Free to Spend.

/**
 * Sets Free to Spend to build up (or to start fresh) from `month` onward. Like every Plan change,
 * only this month and later can change, and it is written to the Plan's history.
 */
export const setFreeToSpendBuildsUp = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ month: monthKeySchema, buildsUp: z.boolean() }))
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await setFreeToSpendCarryInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			month: data.month,
			carries: data.buildsUp,
		});
		await notifyHousehold(context.household.id, ["months"]);
	});

/** Sets the Household's "Keep back" amount: what stays in Free to Spend when a month is closed. */
export const setFreeToSpendKeepBack = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ amountCents: centsSchema }))
	.handler(async ({ data, context }) => {
		await setFreeToSpendKeepBackInDb(getDb(), {
			householdId: context.household.id,
			amountCents: data.amountCents,
		});
		await notifyHousehold(context.household.id, ["months"]);
	});
