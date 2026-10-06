import {
	addBucket as addBucketInDb,
	addBuckets as addBucketsInDb,
	addPersonalAllowance as addPersonalAllowanceInDb,
	archiveBucket as archiveBucketInDb,
	type BucketDeleteBlocker,
	bucketDeleteBlockers,
	bucketsWithAllowanceChanges,
	decideSuggestion as decideSuggestionInDb,
	deleteBucket as deleteBucketInDb,
	loadOpenSuggestion,
	loadPlanChanges,
	parentsWithPersonalAllowance,
	renameBucketGroup as renameBucketGroupInDb,
	reorderBuckets as reorderBucketsInDb,
	restoreBucket as restoreBucketInDb,
	setAllowance as setAllowanceInDb,
	setAllowances as setAllowancesInDb,
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
import { queueAi } from "./ai-queue";
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
/** A group's name as typed: more than it keeps is cut, not refused. */
const groupNameSchema = z.string().max(200);
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
		await queueAi({ ...viewerOf(context), kind: "buckets-changed" });
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
						/** The suggestion this row came from (ADR-0027), marked accepted once added. */
						suggestionId: z.string().min(1).max(64).optional(),
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
		const buckets = data.buckets.map(({ suggestionId: _, ...bucket }) => bucket);
		await addBucketsInDb(db, { ...author, month: data.month, buckets });
		if (data.personal) {
			await addPersonalAllowanceInDb(db, { ...author, month: data.month, ...data.personal });
		}
		// A suggested row, added, is that suggestion taken: not left for the next run to drop.
		const taken = data.buckets.flatMap((bucket) => bucket.suggestionId ?? []);
		for (const suggestionId of taken) {
			const row = await loadOpenSuggestion(db, viewerOf(context), suggestionId);
			if (row?.status === "open" && row.kind === "new-bucket") {
				await decideSuggestionInDb(db, viewerOf(context), row.id, "accepted");
			}
		}
		await notifyHousehold(
			context.household.id,
			taken.length > 0 ? ["months", "suggestions"] : ["months"],
		);
		// New Buckets may fit what waits in Review.
		await queueAi({ ...viewerOf(context), kind: "buckets-changed" });
	});

export const updateBucket = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			bucketId: ulidSchema,
			name: bucketNameSchema.optional(),
			color: colorSchema.optional(),
			// The group it is listed under (issue 98); null or empty for none. Trimmed and cut where
			// it is saved.
			group: groupNameSchema.nullable().optional(),
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
		// A renamed Bucket may now fit what waits in Review.
		if (data.name !== undefined) await queueAi({ ...viewerOf(context), kind: "buckets-changed" });
	});

/**
 * Renames a group of Buckets (issue 98): every Bucket in `from` goes to `to`. An empty `to` takes
 * them all out of the group.
 */
export const renameBucketGroup = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ from: groupNameSchema.min(1), to: groupNameSchema.nullable() }))
	.handler(async ({ data, context }) => {
		await renameBucketGroupInDb(getDb(), { householdId: context.household.id, ...data });
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
		await queueAi({ ...viewerOf(context), kind: "buckets-changed" });
	});

/**
 * The Parents who have a Personal Allowance, so Left to plan can note whose is still to set.
 * Whether one exists is all that's shared (ADR-0003).
 */
export const getAllowanceOwners = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(({ context }) => parentsWithPersonalAllowance(getDb(), context.household.id));

/** The Buckets whose allowance a Parent has changed by hand: ids only (#72). */
export const getEditedAllowances = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(({ context }) => bucketsWithAllowanceChanges(getDb(), context.household.id));

/**
 * "Apply suggested amounts" (#72): the starter Buckets' amounts from `month` onward, as one change.
 * A Bucket a Parent has changed by hand since is left as it is.
 */
export const applySuggestedAmounts = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			month: monthKeySchema,
			items: z
				.array(z.object({ bucketId: ulidSchema, amountCents: centsSchema }))
				.min(1)
				.max(60),
		}),
	)
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		const db = getDb();
		const edited = new Set(await bucketsWithAllowanceChanges(db, context.household.id));
		await setAllowancesInDb(db, {
			householdId: context.household.id,
			memberId: context.parent.id,
			month: data.month,
			items: data.items.filter((item) => !edited.has(item.bucketId)),
		});
		await notifyHousehold(context.household.id, ["months"]);
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
		// What Review guessed into it needs another home.
		await queueAi({ ...viewerOf(context), kind: "buckets-changed" });
	});

/**
 * What stops a Bucket being deleted (issue 98); empty when nothing does. One that has ever had
 * anything filed in it, money Moved in or out, a Rule, or a place in an earlier month's Plan is
 * archived instead, so nothing that happened changes.
 */
export const getBucketDeleteBlockers = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ bucketId: ulidSchema }))
	.handler(async ({ data, context }): Promise<BucketDeleteBlocker[]> => {
		const { household } = context;
		const blockers = await bucketDeleteBlockers(getDb(), {
			householdId: household.id,
			bucketId: data.bucketId,
			thisMonth: monthKeyAt(new Date(), household.timeZone),
		});
		if (blockers === null) throw new Error("That Bucket isn’t in this Household.");
		return blockers;
	});

/** Deletes a Bucket nothing points at; any other is left as it is and `blockers` says why. */
export const deleteBucket = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ bucketId: ulidSchema }))
	.handler(async ({ data, context }) => {
		const { household } = context;
		const result = await deleteBucketInDb(getDb(), {
			householdId: household.id,
			bucketId: data.bucketId,
			thisMonth: monthKeyAt(new Date(), household.timeZone),
		});
		if (result.deleted) {
			await notifyHousehold(household.id, ["months"]);
			// What Review guessed into it needs another home.
			await queueAi({ ...viewerOf(context), kind: "buckets-changed" });
		}
		return result;
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
		if (restored) await queueAi({ ...viewerOf(context), kind: "buckets-changed" });
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
