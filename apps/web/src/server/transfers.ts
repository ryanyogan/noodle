import {
	followedCards,
	forgetCardPayment as forgetCard,
	type IncomeTransferResult,
	linkRefund as link,
	loadCardPaymentRules,
	loadCreditCards,
	loadPlanRecords,
	loadRefund,
	loadTransfer,
	type MoneyPeer,
	type MoneyResult,
	markTransfer as mark,
	markCardPayment as markCard,
	markIncomeTransfer as markIncome,
	type RefundView,
	type TransferView,
	unlinkRefund as unlink,
	unmarkTransfer as unmark,
} from "@noodle/db";
import {
	type CardKept,
	cardKept,
	cardPaymentIsSpending,
	type DayKey,
	dayKeyAt,
	monthOfDay,
	planForMonth,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { ulid } from "ulid";
import { z } from "zod";
import type { HouseholdChange } from "../household-changes";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// Transfers and Refunds, from a Transaction's detail. Imports mark clear Transfers automatically
// (importStatement); a Parent marks or unmarks one, and links money back to its purchase as a
// Refund or unlinks it.

export type { IncomeTransferResult, MoneyPeer, MoneyResult, RefundView, TransferView };

/** A Transaction's Transfer and Refund link, or what a Parent may do about either. */
export const getTransactionMoney = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ transactionId: ulidSchema }))
	.handler(async ({ data, context }): Promise<{ transfer: TransferView; refund: RefundView }> => {
		const db = getDb();
		const viewer = viewerOf(context);
		const [transfer, refund] = await Promise.all([
			loadTransfer(db, viewer, data.transactionId),
			loadRefund(db, viewer, data.transactionId),
		]);
		return { transfer, refund };
	});

/** What changes with a Transfer or Refund: its sides' months (spending, income), and what rolls on. */
const moneyChanges = (months: string[]): HouseholdChange[] => [
	...months.map((month) => `month:${month}` as HouseholdChange),
	"months",
	"bucket-uses",
];

/**
 * Marks an imported Transaction as a Transfer; with `reason`, as money between the two Parents
 * when only this side is in Noodle. Idempotent per `transferId`.
 */
export const markTransfer = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			transferId: ulidSchema,
			transactionId: ulidSchema,
			reason: z.literal("between-us").optional(),
		}),
	)
	.handler(async ({ data, context }): Promise<MoneyResult> => {
		const result = await mark(getDb(), viewerOf(context), {
			...data,
			today: dayKeyAt(new Date(), context.household.timeZone),
		});
		if (result.ok) await notifyHousehold(context.household.id, moneyChanges(result.months));
		return result;
	});

/** A card "It's a card payment" may name, and the Commitment its payment is filed in instead. */
export type CardPaymentCard = {
	id: string;
	name: string;
	/**
	 * Set for a card kept by hand (no Bank Connection, no statement lately) that a Commitment pays
	 * down: the payment is its spending, so it's filed there. Null: the payment is a Transfer.
	 */
	commitment: { id: string; name: string } | null;
	/** How its purchases get in (cardKept): its bank, statements, by hand, not at all; null: not asked. */
	kept: CardKept | null;
};

/** The Household's cards, for "It's a card payment" to ask which one. */
export const getCardPaymentCards = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		({ context }): Promise<CardPaymentCard[]> =>
			loadCardPaymentCards(
				getDb(),
				context.household.id,
				dayKeyAt(new Date(), context.household.timeZone),
			),
	);

/** getCardPaymentCards for a Household on its day `today`: its cards, read and offered. */
export async function loadCardPaymentCards(
	db: ReturnType<typeof getDb>,
	householdId: string,
	today: DayKey,
): Promise<CardPaymentCard[]> {
	const month = monthOfDay(today);
	const [cards, followed, records] = await Promise.all([
		loadCreditCards(db, householdId),
		followedCards(db, householdId, today),
		loadPlanRecords(db, householdId, month),
	]);
	return cardPaymentCardsOf(cards, followed, planForMonth(records, month).commitments);
}

/**
 * Each of the Household's cards as "It's a card payment" offers it: how its purchases get in, and
 * the Commitment its payment is filed in when the payment is the spending (cardPaymentIsSpending:
 * a Commitment of this month's Plan pays the card down and its purchases don't come in from its
 * bank or its statements). `followed`: the cards a statement's purchases came in for lately.
 */
export function cardPaymentCardsOf(
	cards: (Parameters<typeof cardKept>[0] & { id: string; name: string })[],
	followed: Iterable<string>,
	commitments: { id: string; name: string; accountId?: string | null }[],
): CardPaymentCard[] {
	const follows = new Set(followed);
	return cards.map((card) => {
		// The Parent's answer when the card was added, else what Noodle can see of it (issue 136).
		const kept = cardKept({ ...card, followed: follows.has(card.id) });
		const paysDown = commitments.find((commitment) => commitment.accountId === card.id);
		const paying = cardPaymentIsSpending(kept, paysDown !== undefined) ? paysDown : undefined;
		return {
			id: card.id,
			name: card.name,
			kept,
			commitment: paying ? { id: paying.id, name: paying.name } : null,
		};
	});
}

/**
 * "It's a card payment": marks money out as a Transfer to `cardAccountId` (null: a card that
 * isn't in Noodle) and remembers its wording, so later payments are marked as they come in.
 * Idempotent per `transferId`.
 */
export const markCardPayment = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			transferId: ulidSchema,
			transactionId: ulidSchema,
			cardAccountId: ulidSchema.nullable(),
			ruleId: ulidSchema,
		}),
	)
	.handler(
		async ({ data, context }): Promise<MoneyResult & { remembered?: string; also?: string[] }> => {
			// The lines already here that say the same are marked with it (`also`, for its Undo).
			const result = await markCard(getDb(), viewerOf(context), {
				...data,
				newId: ulid,
				today: dayKeyAt(new Date(), context.household.timeZone),
			});
			if (result.ok) await notifyHousehold(context.household.id, moneyChanges(result.months));
			return result;
		},
	);

/** A remembered card-payment wording and the card it names (null: one that isn't in Noodle). */
export type CardPaymentRule = { id: string; pattern: string; card: string | null };

/** The wordings the Household said are card payments, for the Rules page. */
export const getCardPaymentRules = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		async ({ context }): Promise<CardPaymentRule[]> =>
			(await loadCardPaymentRules(getDb(), context.household.id)).map(({ id, pattern, card }) => ({
				id,
				pattern,
				card,
			})),
	);

/** Forgets a card-payment wording. Transfers already marked stay as they are. */
export const forgetCardPayment = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ pattern: z.string().min(1).max(200) }))
	.handler(async ({ data, context }) => {
		await forgetCard(getDb(), context.household.id, data.pattern, context.parent.id);
		// The other Parent's Rules page, and a Log left open, read it again.
		await notifyHousehold(context.household.id, ["rules"]);
		return { ok: true };
	});

/**
 * Marks income as money from the other Parent ("Between us"): no longer Income or Extra income.
 * Refused while Extra income already decided in its month needs it. Idempotent per `transferId`.
 */
export const markIncomeTransfer = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ transferId: ulidSchema, incomeId: ulidSchema }))
	.handler(async ({ data, context }): Promise<IncomeTransferResult> => {
		const result = await markIncome(getDb(), viewerOf(context), data);
		if (result.ok) await notifyHousehold(context.household.id, moneyChanges(result.months));
		return result;
	});

/** Unmarks a Transfer: both sides count again, and are never paired again automatically. */
export const unmarkTransfer = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ transferId: ulidSchema }))
	.handler(async ({ data, context }): Promise<MoneyResult> => {
		const result = await unmark(getDb(), viewerOf(context), data.transferId);
		if (result.ok) await notifyHousehold(context.household.id, moneyChanges(result.months));
		return result;
	});

/** Links money back to the purchase it refunds. Idempotent per `refundId`. */
export const linkRefund = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			refundId: ulidSchema,
			refundTransactionId: ulidSchema,
			originalTransactionId: ulidSchema,
		}),
	)
	.handler(async ({ data, context }): Promise<MoneyResult> => {
		const result = await link(getDb(), viewerOf(context), data);
		if (result.ok) await notifyHousehold(context.household.id, moneyChanges(result.months));
		return result;
	});

/** Unlinks a Refund: the money back is unassigned again. */
export const unlinkRefund = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ refundId: ulidSchema }))
	.handler(async ({ data, context }): Promise<MoneyResult> => {
		const result = await unlink(getDb(), viewerOf(context), data.refundId);
		if (result.ok) await notifyHousehold(context.household.id, moneyChanges(result.months));
		return result;
	});
