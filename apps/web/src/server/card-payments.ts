import {
	addCommitment as addCommitmentInDb,
	type CardPaymentFiling,
	endCommitment as endCommitmentInDb,
	fileCardPayment as fileCardPaymentInDb,
	forgetCardPayment as forgetCardPaymentInDb,
	undoCardPaymentMarks,
	undoCardPaymentFiling as undoFilingInDb,
} from "@noodle/db";
import type { MonthKey } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { HouseholdChange } from "../household-changes";
import { queueAi } from "./ai-queue";
import { commitmentNameSchema } from "./commitments";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { notifyHousehold } from "./notify";
import { assertEditable } from "./plan";
import { dayKeySchema, ulidSchema } from "./schemas";

// "It's a card payment" where the payment is the spending (issue 136): a card kept by hand that a
// Commitment pays down, or a card that isn't in Noodle, whose Commitment is made here in place.
// The Transfer answers are in ./transfers.

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** What changes when lines are filed in a Commitment or put back: their months, and the Rules. */
const filingChanges = (months: string[]): HouseholdChange[] => [
	...months.map((month) => `month:${month}` as HouseholdChange),
	"months",
	"rules",
];

/**
 * Files a card payment in the Commitment that is its spending, with the lines already here that
 * say the same, and states the Rule that files later ones. With `create`, the Commitment is made
 * first, in the line's month: the payment's amount, monthly, due on the payment's day, paying
 * nothing down (the card isn't in Noodle). Idempotent per `commitmentId` and `ruleId`.
 */
export const fileCardPayment = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			transactionId: ulidSchema,
			commitmentId: ulidSchema,
			ruleId: ulidSchema,
			create: z
				.object({
					name: commitmentNameSchema,
					month: monthSchema,
					amountCents: z.number().int().positive(),
					dueDate: dayKeySchema,
				})
				.optional(),
		}),
	)
	.handler(async ({ data, context }): Promise<CardPaymentFiling> => {
		const db = getDb();
		const author = { householdId: context.household.id, memberId: context.parent.id };
		const made = data.create && { ...data.create, month: data.create.month as MonthKey };
		if (made) {
			assertEditable(context.household, made.month);
			await addCommitmentInDb(db, {
				...author,
				commitmentId: data.commitmentId,
				name: made.name,
				month: made.month,
				amountCents: made.amountCents,
				cadence: "monthly",
				dueDate: made.dueDate,
			});
		}
		const result = await fileCardPaymentInDb(db, viewerOf(context), data);
		if (!result.ok) {
			// Nothing half-made is left: a Commitment made for a line that couldn't go in leaves again.
			if (made) {
				await endCommitmentInDb(db, {
					...author,
					commitmentId: data.commitmentId,
					month: made.month,
				});
			}
			return result;
		}
		await notifyHousehold(context.household.id, filingChanges(result.months));
		if (made) {
			await queueAi({ ...author, kind: "commitment-changed", ids: [data.commitmentId] });
		}
		return result;
	});

/**
 * Undo for fileCardPayment: the lines go back where they were, the Rule is forgotten, and a
 * Commitment made for the answer (`created`) leaves the Plan from the month it was made in.
 */
export const undoCardPaymentFiling = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			undo: z
				.array(
					z.object({
						id: ulidSchema,
						bucketId: ulidSchema.nullable(),
						commitmentId: ulidSchema.nullable(),
						version: z.number().int().min(0),
						for: z.array(ulidSchema).max(20).optional(),
					}),
				)
				.max(2000),
			ruleId: ulidSchema.nullable(),
			months: z.array(monthSchema).max(240),
			created: z.object({ commitmentId: ulidSchema, month: monthSchema }).optional(),
		}),
	)
	.handler(async ({ data, context }) => {
		const db = getDb();
		const { restored } = await undoFilingInDb(db, viewerOf(context), {
			undo: data.undo.map((entry) => ({ ...entry, for: entry.for ?? undefined })),
			ruleId: data.ruleId,
		});
		if (data.created) {
			await endCommitmentInDb(db, {
				householdId: context.household.id,
				memberId: context.parent.id,
				commitmentId: data.created.commitmentId,
				month: data.created.month as MonthKey,
			});
		}
		await notifyHousehold(context.household.id, filingChanges(data.months));
		return { restored };
	});

/**
 * Undo for the rest of a Transfer answer: the wording is forgotten, and the other lines it marked
 * (`also`) are as they were. The line answered is unmarked by the screen, as any Transfer is.
 */
export const undoCardPaymentAnswer = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ pattern: z.string().min(1).max(200), also: z.array(ulidSchema).max(2000) }))
	.handler(async ({ data, context }) => {
		const db = getDb();
		await forgetCardPaymentInDb(db, context.household.id, data.pattern);
		await undoCardPaymentMarks(db, context.household.id, data.also);
		if (data.also.length > 0) await notifyHousehold(context.household.id, ["months"]);
		return { ok: true };
	});
