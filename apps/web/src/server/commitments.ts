import {
	addCommitment as addCommitmentInDb,
	addCommitmentPayment as addCommitmentPaymentInDb,
	endCommitment as endCommitmentInDb,
	updateCommitment as updateCommitmentInDb,
} from "@noodle/db";
import { CADENCES, dayKeyAt, MAX_CENTS } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { assertEditable, centsSchema, planScopeSchema } from "./plan";
import { dayKeySchema, ulidSchema } from "./schemas";

// Commitments in the Plan, and payments against them. Each change is idempotent, so the client
// can retry any of them safely, and tells both Parents' screens that every month changed.

export const commitmentNameSchema = z.string().trim().min(1).max(40);

const commitmentSchema = z.object({
	commitmentId: ulidSchema,
	month: monthKeySchema,
	name: commitmentNameSchema,
	amountCents: centsSchema,
	cadence: z.enum(CADENCES),
	dueDate: dayKeySchema,
});

export const addCommitment = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(commitmentSchema)
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await addCommitmentInDb(getDb(), { householdId: context.household.id, ...data });
		await notifyHousehold(context.household.id, ["months"]);
	});

/** Renames a Commitment, and sets what it expects from `month` onward, or just for `month`. */
export const updateCommitment = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(commitmentSchema.extend({ scope: planScopeSchema }))
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await updateCommitmentInDb(getDb(), { householdId: context.household.id, ...data });
		await notifyHousehold(context.household.id, ["months"]);
	});

export const endCommitment = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ commitmentId: ulidSchema, month: monthKeySchema }))
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await endCommitmentInDb(getDb(), { householdId: context.household.id, ...data });
		await notifyHousehold(context.household.id, ["months"]);
	});

/**
 * Records paying a Commitment today (in the Household's time zone) as a Quick Add assigned to
 * it. Idempotent per `transactionId` (a client ULID).
 */
export const addCommitmentPayment = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			transactionId: ulidSchema,
			commitmentId: ulidSchema,
			amountCents: z.number().int().min(1).max(MAX_CENTS),
		}),
	)
	.handler(async ({ data, context }) => {
		const result = await addCommitmentPaymentInDb(getDb(), {
			householdId: context.household.id,
			...data,
			date: dayKeyAt(new Date(), context.household.timeZone),
			createdByMemberId: context.parent.id,
		});
		if (!result.ok) throw new Error("That Commitment isn’t in this month’s Plan.");
		await notifyHousehold(context.household.id, ["months"]);
	});
