import {
	addCommitment as addCommitmentInDb,
	type CardPaymentFiling,
	endCommitment as endCommitmentInDb,
	fileCardPayment as fileCardPaymentInDb,
	undoCardPaymentMarks,
	undoCardPaymentRemembered,
	undoCardPaymentFiling as undoFilingInDb,
} from "@noodle/db";
import { type DayKey, type MonthKey, monthKeyAt } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { HouseholdChange } from "../household-changes";
import { queueAi } from "./ai-queue";
import { commitmentNameSchema, setPaysDown } from "./commitments";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { notifyHousehold } from "./notify";
import { assertEditable } from "./plan";
import { dayKeySchema, ulidSchema } from "./schemas";

// "It's a card payment" where the payment is the spending (issue 136): a card kept by hand that a
// Commitment pays down, or a card that isn't in Noodle, whose Commitment is made here in place.
// The Transfer answers are in ./transfers.

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/**
 * What changes when lines are filed in a Commitment or put back: their months, and the Rules;
 * with `paysDown`, what's owed on the card the Commitment pays down as well.
 */
const filingChanges = (months: string[], paysDown = false): HouseholdChange[] => [
	...months.map((month) => `month:${month}` as HouseholdChange),
	"months",
	"rules",
	...(paysDown ? (["goals"] as const) : []),
];

/**
 * Where a Commitment made for a payment starts. A past month's Plan is closed, so for a payment in
 * a month that has ended it starts in the running month, due on the same day of it (the month's
 * last day when it's shorter), and the payment itself stays as it is (`moved`).
 */
export function commitmentStart(
	payment: { month: MonthKey; dueDate: DayKey },
	running: MonthKey,
): { month: MonthKey; dueDate: DayKey; moved: boolean } {
	if (payment.month >= running) return { ...payment, moved: false };
	const [year, month] = running.split("-").map(Number) as [number, number];
	const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const day = Math.min(Number(payment.dueDate.slice(8, 10)), last);
	const dueDate = `${running}-${String(day).padStart(2, "0")}` as DayKey;
	return { month: running, dueDate, moved: true };
}

/** Pays nothing down: what a Commitment made for a card goes back to before it leaves the Plan. */
const UNLINKED = { accountId: null, carriedBalance: false };

/** What fileCardPayment answers: with `madeIn`, the first month of the Commitment it made. */
export type CardPaymentFiled = CardPaymentFiling & { madeIn?: MonthKey };

/**
 * Files a card payment in the Commitment that is its spending, with the lines already here that
 * say the same, and states the Rule that files later ones. With `create`, the Commitment is made
 * first, in the line's month: the payment's amount, monthly, due on the payment's day, paying
 * down `create.paysDown` (a card that is an Account here but isn't followed) or nothing (the card
 * isn't in Noodle). When the line's month has ended the Commitment starts
 * this month instead and the line stays as it is (`stays`): later payments are filed.
 * Idempotent per `commitmentId` and `ruleId`.
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
					paysDown: ulidSchema.optional(),
				})
				.optional(),
		}),
	)
	.handler(async ({ data, context }): Promise<CardPaymentFiled> => {
		const db = getDb();
		const author = { householdId: context.household.id, memberId: context.parent.id };
		const running = monthKeyAt(new Date(), context.household.timeZone);
		const start =
			data.create &&
			commitmentStart(
				{ month: data.create.month as MonthKey, dueDate: data.create.dueDate as DayKey },
				running,
			);
		const made = data.create && start && { ...data.create, ...start };
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
			// Refused (the Account isn't a card or loan in use, or Noodle follows it): nothing is made.
			const link = made.paysDown
				? await setPaysDown(context, data.commitmentId, {
						accountId: made.paysDown,
						carriedBalance: false,
					})
				: null;
			if (link && !link.ok) {
				await endCommitmentInDb(db, {
					...author,
					commitmentId: data.commitmentId,
					month: made.month,
				});
				return { ok: false };
			}
		}
		const result = await fileCardPaymentInDb(db, viewerOf(context), {
			transactionId: data.transactionId,
			commitmentId: data.commitmentId,
			ruleId: data.ruleId,
			leaveBefore: made?.moved ? running : undefined,
		});
		if (!result.ok) {
			// Nothing half-made is left: a Commitment made for a line that couldn't go in leaves again.
			if (made) {
				if (made.paysDown) await setPaysDown(context, data.commitmentId, UNLINKED);
				await endCommitmentInDb(db, {
					...author,
					commitmentId: data.commitmentId,
					month: made.month,
				});
			}
			return result;
		}
		await notifyHousehold(
			context.household.id,
			filingChanges(result.months, made?.paysDown !== undefined),
		);
		if (made) {
			await queueAi({ ...author, kind: "commitment-changed", ids: [data.commitmentId] });
		}
		return made ? { ...result, madeIn: made.month } : result;
	});

/**
 * Undo for fileCardPayment: the lines go back where they were, the Rule is forgotten (or files
 * where it did before the answer, `ruleBefore`), and a
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
			ruleBefore: z
				.object({
					bucketId: ulidSchema.nullable(),
					commitmentId: ulidSchema.nullable(),
					for: z.array(ulidSchema).max(20),
				})
				.nullish(),
			months: z.array(monthSchema).max(240),
			created: z
				.object({
					commitmentId: ulidSchema,
					month: monthSchema,
					/** It was made paying a card down: the link goes too. */
					paysDown: z.boolean().optional(),
				})
				.optional(),
			// The lines the answer took out of Review (fileCardPayment's `waited`): they wait again.
			waited: z
				.array(
					z.object({
						id: ulidSchema,
						merchant: z.string().min(1).max(200),
						method: z.enum(["rule", "similar", "model", "none"]).nullable(),
						bucketId: ulidSchema.nullable(),
						confidence: z.number().min(0).max(1).nullable(),
						reason: z.string().max(200).nullable(),
					}),
				)
				.max(2000)
				.optional(),
			// Answered from its card in Review: the line waits there again (as returnToReview's).
			review: z
				.object({
					transactionId: ulidSchema,
					merchant: z.string().trim().min(1).max(64),
					guess: z
						.object({
							bucketId: ulidSchema,
							confidence: z.number().min(0).max(1).nullable(),
							method: z.enum(["rule", "similar", "model", "none"]).nullable().optional(),
							reason: z.string().max(80).nullable().optional(),
						})
						.nullable(),
					for: z.array(ulidSchema).max(20),
				})
				.optional(),
		}),
	)
	.handler(async ({ data, context }) => {
		const db = getDb();
		const { restored, reviewVersion } = await undoFilingInDb(db, viewerOf(context), {
			undo: data.undo.map((entry) => ({ ...entry, for: entry.for ?? undefined })),
			ruleId: data.ruleId,
			ruleBefore: data.ruleBefore,
			review: data.review,
			waited: data.waited,
		});
		if (data.created) {
			if (data.created.paysDown) await setPaysDown(context, data.created.commitmentId, UNLINKED);
			await endCommitmentInDb(db, {
				householdId: context.household.id,
				memberId: context.parent.id,
				commitmentId: data.created.commitmentId,
				month: data.created.month as MonthKey,
			});
		}
		await notifyHousehold(
			context.household.id,
			filingChanges(data.months, data.created?.paysDown === true),
		);
		// The line's version once it waits in Review again; null when it wasn't put back there.
		return { restored, reviewVersion: reviewVersion ?? null };
	});

/**
 * Undo for the rest of a Transfer answer: the wording is forgotten (or names the card it named
 * before the answer, `replaced`), and the other lines it marked
 * (`also`) are as they were. The line answered is unmarked by the screen, as any Transfer is.
 */
export const undoCardPaymentAnswer = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			pattern: z.string().min(1).max(200),
			also: z.array(ulidSchema).max(2000),
			replaced: z.object({ accountId: ulidSchema.nullable() }).optional(),
		}),
	)
	.handler(async ({ data, context }) => {
		const db = getDb();
		await undoCardPaymentRemembered(db, context.household.id, data.pattern, data.replaced);
		await undoCardPaymentMarks(db, context.household.id, data.also);
		if (data.also.length > 0) await notifyHousehold(context.household.id, ["months"]);
		return { ok: true };
	});
