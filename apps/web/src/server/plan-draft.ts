import { decideDraft, finishDraft as finishDraftInDb } from "@noodle/db";
import { CADENCES, dayKeyAt, monthKeyAt, type PlanDraft } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { commitmentNameSchema } from "./commitments";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { notifyHousehold } from "./notify";
import { bucketNameSchema, centsSchema } from "./plan";
import { buildPlanDraft } from "./plan-draft-run";
import { dayKeySchema, ulidSchema } from "./schemas";

// The first Plan's draft for the screen (it's drafted in plan-draft-after-import.ts). Parents add
// each suggestion, as it is or changed, or skip it, from this month on, and finish when done.

/** What's left of the first Plan's draft, as the Parent sees it; null when there's nothing. */
export const getPlanDraft = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		({ context }): Promise<PlanDraft | null> =>
			buildPlanDraft(getDb(), viewerOf(context), dayKeyAt(new Date(), context.household.timeZone)),
	);

const keySchema = z.string().min(1).max(200);

/**
 * Adds suggestions to this month's Plan onward, as the Parent left them. Idempotent per the
 * client's IDs; a suggestion already decided is still hidden, never added twice.
 */
export const acceptDraft = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			baselineCents: centsSchema.nullable().optional(),
			commitments: z
				.array(
					z.object({
						key: keySchema,
						commitmentId: ulidSchema,
						name: commitmentNameSchema,
						amountCents: centsSchema,
						cadence: z.enum(CADENCES),
						dueDate: dayKeySchema,
					}),
				)
				.max(100)
				.optional(),
			buckets: z
				.array(
					z.object({
						key: keySchema,
						bucketId: ulidSchema,
						name: bucketNameSchema,
						allowanceCents: centsSchema,
					}),
				)
				.max(100)
				.optional(),
		}),
	)
	.handler(async ({ data, context }) => {
		await decideDraft(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			// Always this month: the draft is for the Plan from now on.
			month: monthKeyAt(new Date(), context.household.timeZone),
			...data,
		});
		await notifyHousehold(context.household.id, ["months", "plan-draft"]);
	});

/** Skips suggestions: they aren't made again. */
export const skipDraft = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ keys: z.array(keySchema).min(1).max(100) }))
	.handler(async ({ data, context }) => {
		await decideDraft(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			month: monthKeyAt(new Date(), context.household.timeZone),
			skipped: data.keys,
		});
		await notifyHousehold(context.household.id, ["plan-draft"]);
	});

/** A Parent is done with the draft: what's left of it stops showing, for both Parents. */
export const finishDraft = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.handler(async ({ context }) => {
		await finishDraftInDb(getDb(), context.household.id, context.parent.id);
		await notifyHousehold(context.household.id, ["plan-draft"]);
	});
