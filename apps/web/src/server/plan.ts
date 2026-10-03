import {
	addBucket as addBucketInDb,
	addBuckets as addBucketsInDb,
	addPersonalAllowance as addPersonalAllowanceInDb,
	archiveBucket as archiveBucketInDb,
	loadPlanChanges,
	reorderBuckets as reorderBucketsInDb,
	restoreBucket as restoreBucketInDb,
	setAllowance as setAllowanceInDb,
	setCarriesOver as setCarriesOverInDb,
	setTakeHomePay as setTakeHomePayInDb,
	updateBucket as updateBucketInDb,
} from "@noodle/db";
import {
	type DayKey,
	dayKeyAt,
	MAX_CENTS,
	type MonthKey,
	monthKeyAt,
	type PlanChange,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { lookAgainAfterPlanChange } from "./categorize";
import { getDb } from "./db";
import { type HouseholdSummary, householdMiddleware, viewerOf } from "./household";
import { monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// Changes to the Plan. Each is idempotent, so the client can retry any of them safely, and
// each tells both Parents' screens that every month changed, since a Plan change carries forward.

export const centsSchema = z.number().int().min(0).max(MAX_CENTS);
export const bucketNameSchema = z.string().trim().min(1).max(40);
const colorSchema = z.number().int().min(1).max(8);
/** How far a change reaches: from its month onward (the default), or just that month. */
export const planScopeSchema = z.enum(["from-on", "just"]).optional();

/** Past months' Plans are closed; only this month and later can change. */
export function assertEditable(household: Pick<HouseholdSummary, "timeZone">, month: MonthKey) {
	if (month < monthKeyAt(new Date(), household.timeZone)) {
		throw new Error("Plans for past months can’t be changed.");
	}
}

/** Sets take-home pay from `month` onward, or just for `month`. */
export const setTakeHomePay = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ month: monthKeySchema, amountCents: centsSchema, scope: planScopeSchema }))
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await setTakeHomePayInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
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
			rolling: z.boolean().optional(),
		}),
	)
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await addBucketInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
		await notifyHousehold(context.household.id, ["months"]);
		// A new Bucket may fit what waits in Review.
		lookAgainAfterPlanChange(viewerOf(context));
	});

/**
 * Adds several Buckets, and the signed-in Parent's Personal Allowance, from `month` onward in one
 * call (#57's Add Buckets sheet). Each writes its Plan change; retrying with the same IDs adds none
 * twice.
 */
export const addBuckets = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			month: monthKeySchema,
			buckets: z
				.array(
					z.object({
						bucketId: ulidSchema,
						name: bucketNameSchema,
						color: colorSchema,
						allowanceCents: centsSchema,
						rolling: z.boolean().optional(),
					}),
				)
				.max(40),
			personal: z
				.object({
					bucketId: ulidSchema,
					name: bucketNameSchema,
					color: colorSchema,
					allowanceCents: centsSchema,
				})
				.optional(),
		}),
	)
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		const db = getDb();
		const author = { householdId: context.household.id, memberId: context.parent.id };
		await addBucketsInDb(db, { ...author, month: data.month, buckets: data.buckets });
		if (data.personal) {
			await addPersonalAllowanceInDb(db, { ...author, month: data.month, ...data.personal });
		}
		await notifyHousehold(context.household.id, ["months"]);
		// New Buckets may fit what waits in Review.
		lookAgainAfterPlanChange(viewerOf(context));
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
			month: monthKeyAt(new Date(), context.household.timeZone),
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
		// The new Personal Allowance may fit what waits in Review.
		lookAgainAfterPlanChange(viewerOf(context));
	});

/** Sets a Bucket's allowance from `month` onward, or just for `month`. */
export const setAllowance = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			bucketId: ulidSchema,
			month: monthKeySchema,
			amountCents: centsSchema,
			scope: planScopeSchema,
		}),
	)
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await setAllowanceInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
		await notifyHousehold(context.household.id, ["months"]);
	});

/** Sets a Bucket carries over or resets monthly from `month` onward; it changes what rolls into later months. */
export const setCarriesOver = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ bucketId: ulidSchema, month: monthKeySchema, rolling: z.boolean() }))
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await setCarriesOverInDb(getDb(), {
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
		await archiveBucketInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
		await notifyHousehold(context.household.id, ["months"]);
	});

/** Brings an archived Bucket back into the Plan from `month` on, with its allowance. */
export const restoreBucket = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ bucketId: ulidSchema, month: monthKeySchema, amountCents: centsSchema }))
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		const restored = await restoreBucketInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
		await notifyHousehold(context.household.id, ["months"]);
		// The restored Bucket may fit what waits in Review.
		if (restored) lookAgainAfterPlanChange(viewerOf(context));
		return { ok: restored };
	});

/** A Plan change with the day it was made, in the Household's time zone. */
export type DatedPlanChange = PlanChange & { day: DayKey };

/** Plan changes, newest first, and the day the Household's history starts (none before it). */
export type PlanHistoryView = { changes: DatedPlanChange[]; historyStart: DayKey | null };

/**
 * The Plan changes that take effect in `month`, or, with `targetId`, every one to that Bucket,
 * Commitment or Goal, as the signed-in Parent may see them (ADR-0003).
 */
export const getPlanHistory = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ month: monthKeySchema.optional(), targetId: ulidSchema.optional() }))
	.handler(async ({ data, context }): Promise<PlanHistoryView> => {
		const { household } = context;
		const history = await loadPlanChanges(
			getDb(),
			{ householdId: household.id, memberId: context.parent.id },
			data,
		);
		// Days in the Household's time zone, so server and browser render the same dates.
		const day = (at: number) => dayKeyAt(new Date(at), household.timeZone);
		return {
			changes: history.changes.map((change) => ({ ...change, day: day(change.at) })),
			historyStart: history.historyStart === null ? null : day(history.historyStart),
		};
	});
