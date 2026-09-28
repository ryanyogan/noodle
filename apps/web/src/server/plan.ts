import {
	addBucket as addBucketInDb,
	addPersonalAllowance as addPersonalAllowanceInDb,
	archiveBucket as archiveBucketInDb,
	reorderBuckets as reorderBucketsInDb,
	setAllowance as setAllowanceInDb,
	setBaseline as setBaselineInDb,
	setRolling as setRollingInDb,
	updateBucket as updateBucketInDb,
} from "@noodle/db";
import { MAX_CENTS, type MonthKey, monthKeyAt } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { type HouseholdSummary, householdMiddleware } from "./household";
import { monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// Changes to the Plan. Each is idempotent, so the client can retry any of them safely, and
// each tells both Parents' screens that every month changed, since a Plan change carries forward.

export const centsSchema = z.number().int().min(0).max(MAX_CENTS);
export const bucketNameSchema = z.string().trim().min(1).max(40);
const colorSchema = z.number().int().min(1).max(8);

/** Past months' Plans are closed; only this month and later can change. */
export function assertEditable(household: Pick<HouseholdSummary, "timeZone">, month: MonthKey) {
	if (month < monthKeyAt(new Date(), household.timeZone)) {
		throw new Error("Plans for past months can’t be changed.");
	}
}

export const setBaseline = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ month: monthKeySchema, amountCents: centsSchema }))
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await setBaselineInDb(getDb(), { householdId: context.household.id, ...data });
		await notifyHousehold(context.household.id, ["months"]);
	});

export const addBucket = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			bucketId: ulidSchema,
			month: monthKeySchema,
			name: bucketNameSchema,
			color: colorSchema,
			allowanceCents: centsSchema,
		}),
	)
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await addBucketInDb(getDb(), { householdId: context.household.id, ...data });
		await notifyHousehold(context.household.id, ["months"]);
	});

export const updateBucket = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			bucketId: ulidSchema,
			name: bucketNameSchema.optional(),
			color: colorSchema.optional(),
		}),
	)
	.handler(async ({ data, context }) => {
		await updateBucketInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
		await notifyHousehold(context.household.id, ["months"]);
	});

/** Adds the signed-in Parent's Personal Allowance to the Plan from `month` onward. */
export const addPersonalAllowance = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			bucketId: ulidSchema,
			month: monthKeySchema,
			name: bucketNameSchema,
			color: colorSchema,
			allowanceCents: centsSchema,
		}),
	)
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await addPersonalAllowanceInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
		await notifyHousehold(context.household.id, ["months"]);
	});

export const setAllowance = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ bucketId: ulidSchema, month: monthKeySchema, amountCents: centsSchema }))
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await setAllowanceInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
		await notifyHousehold(context.household.id, ["months"]);
	});

/** Sets a Bucket Rolling or Fresh-start from `month` onward; it changes what rolls into later months. */
export const setRolling = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ bucketId: ulidSchema, month: monthKeySchema, rolling: z.boolean() }))
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await setRollingInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
		await notifyHousehold(context.household.id, ["months"]);
	});

export const reorderBuckets = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ bucketIds: z.array(ulidSchema).min(1).max(100) }))
	.handler(async ({ data, context }) => {
		await reorderBucketsInDb(getDb(), { householdId: context.household.id, ...data });
		await notifyHousehold(context.household.id, ["months"]);
	});

export const archiveBucket = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ bucketId: ulidSchema, month: monthKeySchema }))
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await archiveBucketInDb(getDb(), { householdId: context.household.id, ...data });
		await notifyHousehold(context.household.id, ["months"]);
	});
