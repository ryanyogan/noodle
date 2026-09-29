import {
	linkRefund as link,
	loadRefund,
	loadTransfer,
	type MoneyPeer,
	type MoneyResult,
	markTransfer as mark,
	type RefundView,
	type TransferView,
	unlinkRefund as unlink,
	unmarkTransfer as unmark,
} from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { HouseholdChange } from "../household-changes";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// Transfers and Refunds, from a Transaction's detail. Imports mark clear Transfers automatically
// (importStatement); a Parent marks or unmarks one, and links money back to its purchase as a
// Refund or unlinks it.

export type { MoneyPeer, MoneyResult, RefundView, TransferView };

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

/** Marks an imported Transaction as a Transfer. Idempotent per `transferId`. */
export const markTransfer = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ transferId: ulidSchema, transactionId: ulidSchema }))
	.handler(async ({ data, context }): Promise<MoneyResult> => {
		const result = await mark(getDb(), viewerOf(context), data);
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
