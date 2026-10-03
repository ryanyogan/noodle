import {
	addCommitment as addCommitmentInDb,
	addCommitmentPayment as addCommitmentPaymentInDb,
	type CommitmentCharge,
	endCommitment as endCommitmentInDb,
	loadChargesBetween,
	loadPlanRecords,
	updateCommitment as updateCommitmentInDb,
} from "@noodle/db";
import {
	addDays,
	addMonths,
	CADENCES,
	type DayKey,
	dayKeyAt,
	MAX_CENTS,
	monthOfDay,
	type PlanRecords,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { queueAi } from "./ai-queue";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
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
		await addCommitmentInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
		await notifyHousehold(context.household.id, ["months"]);
		await queueAi({
			householdId: context.household.id,
			memberId: context.parent.id,
			kind: "commitment-changed",
			ids: [data.commitmentId],
		});
	});

/** Renames a Commitment, and sets what it expects from `month` onward, or just for `month`. */
export const updateCommitment = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(commitmentSchema.extend({ scope: planScopeSchema }))
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await updateCommitmentInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
		await notifyHousehold(context.household.id, ["months"]);
		await queueAi({
			householdId: context.household.id,
			memberId: context.parent.id,
			kind: "commitment-changed",
			ids: [data.commitmentId],
		});
	});

export const endCommitment = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ commitmentId: ulidSchema, month: monthKeySchema }))
	.handler(async ({ data, context }) => {
		assertEditable(context.household, data.month);
		await endCommitmentInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
		await notifyHousehold(context.household.id, ["months"]);
		await queueAi({
			householdId: context.household.id,
			memberId: context.parent.id,
			kind: "commitment-changed",
			ids: [data.commitmentId],
		});
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

/** How far back a Commitment's charges are read, and how far ahead its schedule is. */
export const COMMITMENT_MONTHS = 12;

/**
 * Every Commitment, ended ones too, with its terms over time, and the charges against them over
 * the last year and until the end of next month, as the Parent may see them (ADR-0003).
 * Enough for Coming up, lumpy months, and each Commitment's page.
 */
export type CommitmentsData = Pick<PlanRecords, "commitments" | "commitmentTerms"> & {
	charges: CommitmentCharge[];
	asOf: DayKey;
};

export const getCommitments = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<CommitmentsData> => {
		const db = getDb();
		const asOf = dayKeyAt(new Date(), context.household.timeZone);
		const month = monthOfDay(asOf);
		const [records, charges] = await Promise.all([
			loadPlanRecords(db, context.household.id, addMonths(month, COMMITMENT_MONTHS)),
			loadChargesBetween(
				db,
				viewerOf(context),
				`${addMonths(month, -COMMITMENT_MONTHS)}-01` as DayKey,
				addDays(`${addMonths(month, 2)}-01` as DayKey, -1),
			),
		]);
		return {
			commitments: records.commitments,
			commitmentTerms: records.commitmentTerms,
			charges,
			asOf,
		};
	});
