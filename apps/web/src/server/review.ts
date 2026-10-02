import {
	applyRule as applyRuleInDb,
	deleteRule as deleteRuleInDb,
	editRule as editRuleInDb,
	listRules,
	loadReview,
	type ReviewQueue,
	type RuleRow,
	returnToReview as returnToReviewInDb,
	saveRule as saveRuleInDb,
} from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { lookAgain } from "./categorize";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// Review and Rules. Review is read for the Parent looking, like every read of Transactions
// (ADR-0003); confirming or changing a card is an ordinary Transaction edit (server/transactions),
// which settles its categorization and teaches its merchant. A Rule into a Parent's own Personal
// Allowance is theirs alone, so saving one doesn't tell the other Parent's screens anything.

/** How many cards Review sends at once; its count says how many wait in all. */
const REVIEW_CARDS = 100;

/** What waits in Review, oldest first. */
export const getReview = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		({ context }): Promise<ReviewQueue> => loadReview(getDb(), viewerOf(context), REVIEW_CARDS),
	);

/**
 * "Look again": categorizes what waits in Review that this Parent imported once more, against the
 * Plan as it is now. Idempotent. Returns how many it filed and how many still wait with a guess.
 */
export const lookAgainAtReview = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.handler(async ({ context }) => {
		const result = await lookAgain(viewerOf(context));
		const guessed = result.review - result.methods.none;
		return { looked: result.filed + result.review, filed: result.filed, guessed };
	});

/**
 * Undoes a Parent's decision on a card: the Transaction goes back to Review unassigned, For whoever
 * it was For before, with categorization's guess. Idempotent.
 */
export const returnToReview = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			transactionId: ulidSchema,
			month: monthKeySchema,
			merchant: z.string().trim().min(1).max(64),
			guess: z
				.object({
					bucketId: ulidSchema,
					confidence: z.number().min(0).max(1).nullable(),
					method: z.enum(["rule", "similar", "model", "none"]).nullable().optional(),
					reason: z.string().max(80).nullable().optional(),
				})
				.nullable(),
			forMemberIds: z.array(ulidSchema).max(20),
		}),
	)
	.handler(async ({ data, context }) => {
		await returnToReviewInDb(getDb(), viewerOf(context), data);
		// Every month: what's left can roll into later ones.
		await notifyHousehold(context.household.id, ["months", "for-earlier", "bucket-uses"]);
	});

/** The Rules this Parent may see: the Household's and their own private ones. */
export const getRules = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(({ context }): Promise<RuleRow[]> => listRules(getDb(), viewerOf(context)));

const ruleSchema = z.object({
	ruleId: ulidSchema,
	pattern: z.string().trim().min(1).max(64),
	bucketId: ulidSchema,
	forMemberIds: z.array(ulidSchema).max(20),
});

/**
 * "Always file this merchant in this Bucket": states a Rule, replacing this Parent's (or the
 * Household's) Rule for the same pattern. With `apply`, it also files what's still unassigned
 * that it matches, like the rest of Review's cards for that merchant. Idempotent by `ruleId`, a
 * client ULID. Returns how many it filed.
 */
export const saveRule = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(ruleSchema.extend({ apply: z.boolean().default(false) }))
	.handler(async ({ data, context }) => {
		const result = await saveRuleInDb(getDb(), {
			id: data.ruleId,
			householdId: context.household.id,
			memberId: context.parent.id,
			pattern: data.pattern,
			bucketId: data.bucketId,
			forMemberIds: data.forMemberIds,
		});
		if (!result.ok) throw new Error("That Bucket isn’t yours to file into.");
		const { filed } = data.apply
			? await applyRuleInDb(getDb(), viewerOf(context), result.ruleId)
			: { filed: 0 };
		const changes = [
			...(result.private ? [] : (["rules"] as const)),
			...(filed > 0 ? (["months", "for-earlier", "bucket-uses"] as const) : []),
		];
		if (changes.length > 0) await notifyHousehold(context.household.id, changes);
		return { filed };
	});

/** Changes a Rule's pattern, Bucket, and For. */
export const editRule = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(ruleSchema)
	.handler(async ({ data, context }) => {
		const result = await editRuleInDb(getDb(), viewerOf(context), data);
		if (!result.ok) {
			throw new Error(
				result.reason === "duplicate"
					? "There’s already a Rule for that merchant."
					: "That Rule or Bucket isn’t yours to change.",
			);
		}
		// Even a private one: it may have just left the Household's Rules.
		await notifyHousehold(context.household.id, ["rules"]);
	});

/** Deletes a Rule. What it already filed stays where it is. Idempotent. */
export const deleteRule = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ ruleId: ulidSchema }))
	.handler(async ({ data, context }) => {
		await deleteRuleInDb(getDb(), viewerOf(context), data.ruleId);
		await notifyHousehold(context.household.id, ["rules"]);
	});

/** Files everything still unassigned that a Rule matches. Returns how many it filed. */
export const applyRule = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ ruleId: ulidSchema }))
	.handler(async ({ data, context }) => {
		const result = await applyRuleInDb(getDb(), viewerOf(context), data.ruleId);
		await notifyHousehold(
			context.household.id,
			result.filed > 0 ? ["months", "for-earlier", "bucket-uses", "rules"] : ["months"],
		);
		return { filed: result.filed };
	});
