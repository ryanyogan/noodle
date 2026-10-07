import {
	addCommitment as addCommitmentInDb,
	addCommitmentPayment as addCommitmentPaymentInDb,
	type CommitmentCharge,
	type CommitmentLinkResult,
	endCommitment as endCommitmentInDb,
	followedCards,
	linkCommitment,
	loadChargesBetween,
	loadPaymentHistory,
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
	monthKeyAt,
	monthOfDay,
	PAYMENT_HISTORY_MONTHS,
	type PaymentSuggestion,
	type PlanRecords,
	paymentsTo,
	planForMonth,
	suggestPayment,
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
	/** Its amount is "about" (true) or the same each time (false); left out, it stays as it is. */
	about: z.boolean().optional(),
	/** The credit card or loan its payments pay down (null for none); left out, it stays as it is. */
	paysDown: z.object({ accountId: ulidSchema.nullable(), carriedBalance: z.boolean() }).optional(),
});

/**
 * What saving a Commitment did about the card or loan it pays down: null when it wasn't asked to
 * change, else linkCommitment's answer. A refusal leaves the rest of the save in place, and the
 * form says why in plain words.
 */
export type CommitmentSaved = { paysDown: CommitmentLinkResult | null };

/** Sets what a Commitment pays down, through linkCommitment's guard and its Plan change. */
async function setPaysDown(
	context: { household: { id: string; timeZone: string }; parent: { id: string } },
	commitmentId: string,
	paysDown: { accountId: string | null; carriedBalance: boolean } | undefined,
): Promise<CommitmentLinkResult | null> {
	if (!paysDown) return null;
	const now = new Date();
	return linkCommitment(getDb(), {
		householdId: context.household.id,
		memberId: context.parent.id,
		commitmentId,
		accountId: paysDown.accountId,
		carriedBalance: paysDown.accountId !== null && paysDown.carriedBalance,
		month: monthKeyAt(now, context.household.timeZone),
		today: dayKeyAt(now, context.household.timeZone),
	});
}

export const addCommitment = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(commitmentSchema)
	.handler(async ({ data, context }): Promise<CommitmentSaved> => {
		assertEditable(context.household, data.month);
		await addCommitmentInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
		const paysDown = await setPaysDown(context, data.commitmentId, data.paysDown);
		// What's owed on the card or loan follows from the link, so Accounts and Goals refetch too.
		await notifyHousehold(context.household.id, paysDown ? ["months", "goals"] : ["months"]);
		await queueAi({
			householdId: context.household.id,
			memberId: context.parent.id,
			kind: "commitment-changed",
			ids: [data.commitmentId],
		});
		return { paysDown };
	});

/** Renames a Commitment, and sets what it expects from `month` onward, or just for `month`. */
export const updateCommitment = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(commitmentSchema.extend({ scope: planScopeSchema }))
	.handler(async ({ data, context }): Promise<CommitmentSaved> => {
		assertEditable(context.household, data.month);
		await updateCommitmentInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
		const paysDown = await setPaysDown(context, data.commitmentId, data.paysDown);
		// What's owed on the card or loan follows from the link, so Accounts and Goals refetch too.
		await notifyHousehold(context.household.id, paysDown ? ["months", "goals"] : ["months"]);
		await queueAi({
			householdId: context.household.id,
			memberId: context.parent.id,
			kind: "commitment-changed",
			ids: [data.commitmentId],
		});
		return { paysDown };
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

/**
 * The Household's credit cards in use that Noodle follows (it syncs with their bank, or a purchase
 * was brought in from one in the last 60 days): what's bought on them is already in Buckets, so a
 * Commitment may pay one down only as a set payment on a balance being carried (ADR-0050).
 */
export const getFollowedCards = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		async ({ context }): Promise<string[]> =>
			followedCards(
				getDb(),
				context.household.id,
				dayKeyAt(new Date(), context.household.timeZone),
			),
	);

/**
 * Keeps a Commitment that pays down a card Noodle has begun to follow, as a set payment on a
 * balance the Household is carrying (Plan health's "Keep it", ADR-0050). Through linkCommitment's
 * guard, like the form's own tick.
 */
export const keepCarriedBalance = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ commitmentId: ulidSchema, accountId: ulidSchema }))
	.handler(async ({ data, context }): Promise<CommitmentLinkResult> => {
		const result = await setPaysDown(context, data.commitmentId, {
			accountId: data.accountId,
			carriedBalance: true,
		});
		await notifyHousehold(context.household.id, ["months", "goals"]);
		return result ?? { ok: true };
	});

/**
 * What a Commitment paying down this card or loan might be set at: what the payments to it came
 * to a month over the last three full months, as the Parent may see them. The payments are found
 * as Review finds them (paymentsTo). Null with too little history (suggestPayment).
 */
export const getPaymentSuggestion = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ accountId: ulidSchema }))
	.handler(async ({ data, context }): Promise<PaymentSuggestion | null> => {
		const db = getDb();
		const today = dayKeyAt(new Date(), context.household.timeZone);
		const month = monthOfDay(today);
		const [history, followed, records] = await Promise.all([
			loadPaymentHistory(
				db,
				viewerOf(context),
				`${addMonths(month, -PAYMENT_HISTORY_MONTHS)}-01` as DayKey,
				`${month}-01` as DayKey,
			),
			followedCards(db, context.household.id, today),
			loadPlanRecords(db, context.household.id, month),
		]);
		if (!history.accounts.some((account) => account.id === data.accountId)) return null;
		const follows = new Set(followed);
		const accounts = history.accounts.map((account) => ({
			id: account.id,
			name: account.name,
			kind: account.kind,
			followed: account.kind === "credit-card" && (account.connected || follows.has(account.id)),
		}));
		const paying = planForMonth(records, month).commitments.flatMap((commitment) =>
			commitment.accountId
				? [
						{
							id: commitment.id,
							name: commitment.name,
							accountId: commitment.accountId,
							amountCents: commitment.amount,
							carriedBalance: commitment.carriedBalance ?? false,
						},
					]
				: [],
		);
		return suggestPayment(paymentsTo(data.accountId, history.lines, accounts, paying), month);
	});
