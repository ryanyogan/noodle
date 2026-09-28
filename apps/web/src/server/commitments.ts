import {
	addCommitment as addCommitmentInDb,
	addCommitmentPayment as addCommitmentPaymentInDb,
	endCommitment as endCommitmentInDb,
	updateCommitment as updateCommitmentInDb,
} from "@noodle/db";
import { CADENCES, type DayKey, dayKeyAt, MAX_CENTS } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { monthKeySchema } from "./month";
import { assertEditable, centsSchema } from "./plan";
import { ulidSchema } from "./schemas";

// Commitments in the Plan, and payments against them. Each change is idempotent, so the client
// can retry any of them safely.

export const commitmentNameSchema = z.string().trim().min(1).max(40);

/** A real calendar day as "YYYY-MM-DD". */
const dayKeySchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
	.refine((day) => new Date(`${day}T00:00:00Z`).toISOString().startsWith(day), "Not a real day")
	.transform((day) => day as DayKey);

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
	});

/** Renames a Commitment, and sets what it expects from `month` onward. */
export const updateCommitment = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(commitmentSchema)
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await updateCommitmentInDb(getDb(), { householdId: context.household.id, ...data });
	});

export const endCommitment = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ commitmentId: ulidSchema, month: monthKeySchema }))
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await endCommitmentInDb(getDb(), { householdId: context.household.id, ...data });
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
	});
