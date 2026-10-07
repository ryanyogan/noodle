import {
	answerWalletCard as answerWalletCardInDb,
	checkStatementBalance as checkStatementBalanceInDb,
	dismissWalletCard as dismissWalletCardInDb,
	loadBalanceChecksPutAway,
	loadWalletQuestions,
	putAwayBalanceCheck as putAwayBalanceCheckInDb,
	setCardKept as setCardKeptInDb,
	type WalletQuestion,
} from "@noodle/db";
import {
	type BalanceCheck,
	type Cents,
	dayKeyAt,
	MAX_CENTS,
	PURCHASES_GET_IN,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { notifyHousehold } from "./notify";
import { dayKeySchema, ulidSchema } from "./schemas";

// A card says how its purchases get into Noodle, and what follows for one kept by hand (issue
// 136): the Wallet card a capture names, and the monthly check of its statement's balance.

export type { WalletQuestion };

/** Records how a credit card's purchases get in, and the day of the month its statement closes. */
export const setCardKept = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			accountId: ulidSchema,
			purchases: z.enum(PURCHASES_GET_IN),
			statementDay: z.number().int().min(1).max(31).nullish(),
		}),
	)
	.handler(async ({ data, context }): Promise<{ ok: boolean }> => {
		const result = await setCardKeptInDb(getDb(), {
			householdId: context.household.id,
			accountId: data.accountId,
			purchases: data.purchases,
			...(data.statementDay === undefined ? {} : { statementDay: data.statementDay }),
		});
		// What's owed on it, and whether its Quick Adds wait for a bank copy, both follow the answer.
		if (result.ok) await notifyHousehold(context.household.id, ["goals", "months"]);
		return result;
	});

/** What the monthly balance check found, with what Noodle had recorded as owed on that day. */
export type StatementCheck =
	| { ok: true; check: BalanceCheck; recordedCents: Cents | null }
	| { ok: false };

/**
 * The monthly balance check: compares the statement's balance a Parent typed with what's recorded
 * as owed on the statement's day, and takes the statement's as the card's balance from then on.
 */
export const checkStatementBalance = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			balanceId: ulidSchema,
			accountId: ulidSchema,
			statementCents: z.number().int().min(0).max(MAX_CENTS),
			asOf: dayKeySchema,
		}),
	)
	.handler(async ({ data, context }): Promise<StatementCheck> => {
		const now = dayKeyAt(new Date(), context.household.timeZone);
		const result = await checkStatementBalanceInDb(getDb(), {
			householdId: context.household.id,
			createdByMemberId: context.parent.id,
			...data,
			asOf: data.asOf < now ? data.asOf : now,
		});
		if (result.ok) await notifyHousehold(context.household.id, ["goals"]);
		return result;
	});

/** The Balance checks the Household said "Not now" to, each as `account:statement day`. */
export const getBalanceChecksPutAway = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		({ context }): Promise<string[]> => loadBalanceChecksPutAway(getDb(), context.household.id),
	);

/**
 * "Not now" on a statement's Balance check: it stays away on every device of the Household until
 * the card's next statement closes, and its Nudge isn't sent if it hasn't been.
 */
export const putAwayBalanceCheck = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ accountId: ulidSchema, day: dayKeySchema }))
	.handler(async ({ data, context }): Promise<{ ok: boolean }> => {
		const result = await putAwayBalanceCheckInDb(getDb(), {
			householdId: context.household.id,
			...data,
		});
		if (result.ok) await notifyHousehold(context.household.id, ["goals"]);
		return result;
	});

/** The Wallet cards captures named that a Parent hasn't said the Account of. */
export const getWalletQuestions = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		({ context }): Promise<WalletQuestion[]> => loadWalletQuestions(getDb(), context.household.id),
	);

/** "None of these": the captures paid with that Wallet card stay on no Account, and it isn't asked again. */
export const dismissWalletCard = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ card: z.string().trim().min(1).max(80) }))
	.handler(async ({ data, context }): Promise<{ ok: boolean }> => {
		const result = await dismissWalletCardInDb(getDb(), {
			householdId: context.household.id,
			card: data.card,
		});
		if (result.ok) await notifyHousehold(context.household.id, ["months"]);
		return result;
	});

/** "Which Account is this Wallet card?": remembered, and the captures made with it move there. */
export const answerWalletCard = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ card: z.string().trim().min(1).max(80), accountId: ulidSchema }))
	.handler(async ({ data, context }): Promise<{ ok: boolean; moved: number }> => {
		const result = await answerWalletCardInDb(getDb(), {
			householdId: context.household.id,
			...data,
		});
		if (result.ok) await notifyHousehold(context.household.id, ["goals", "months"]);
		return result;
	});
