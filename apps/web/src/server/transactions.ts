import {
	addQuickAdd as addQuickAddInDb,
	deleteTransaction as deleteTransactionInDb,
	loadBucketUses,
	loadTransactionsPage,
	splitTransaction as splitTransactionInDb,
	type TransactionCursor,
	type TransactionRow,
	updateTransaction as updateTransactionInDb,
} from "@noodle/db";
import { type BucketUse, type DayKey, dayKeyAt, MAX_CENTS, splitsBalance } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

/** How far back Quick Add looks to order Buckets by likelihood. */
const LIKELY_WINDOW_DAYS = 90;

/**
 * Records a Quick Add, dated today in the Household's time zone. Idempotent per
 * `transactionId` (a client ULID), so the client can retry it safely.
 */
export const addQuickAdd = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			transactionId: ulidSchema,
			bucketId: ulidSchema,
			amountCents: z.number().int().min(1).max(MAX_CENTS),
			note: z.string().trim().max(80).optional(),
			// Who it was For; none means the whole Household.
			forMemberIds: z.array(ulidSchema).max(20).default([]),
		}),
	)
	.handler(async ({ data, context }) => {
		const date = dayKeyAt(new Date(), context.household.timeZone);
		const result = await addQuickAddInDb(getDb(), {
			householdId: context.household.id,
			transactionId: data.transactionId,
			bucketId: data.bucketId,
			date,
			amountCents: data.amountCents,
			note: data.note || null,
			forMemberIds: data.forMemberIds,
			createdByMemberId: context.parent.id,
		});
		if (!result.ok) throw new Error("That Bucket isn’t in this month’s Plan.");
		// Every month: what's left can roll into later ones.
		await notifyHousehold(context.household.id, ["months", "bucket-uses"]);
	});

/** Recent spending's Buckets, so Quick Add can offer the likeliest first. */
export const getBucketUses = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<BucketUse[]> => {
		const since = new Date(Date.now() - LIKELY_WINDOW_DAYS * 86_400_000);
		return loadBucketUses(
			getDb(),
			context.household.id,
			dayKeyAt(since, context.household.timeZone),
		);
	});

/** How many Transactions one page of the list holds. */
const PAGE_SIZE = 50;

const dayKeySchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
	.transform((day) => day as DayKey);

/** Who the list is filtered to: a Member, or "everyone" for spending For the whole Household. */
export const forFilterSchema = z.union([ulidSchema, z.literal("everyone")]);

export type TransactionsPage = { transactions: TransactionRow[]; next: TransactionCursor | null };

/** One page of a month's Transactions, newest first, filtered by Bucket and by who it was For. */
export const getTransactions = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			month: monthKeySchema,
			bucketId: ulidSchema.optional(),
			forMember: forFilterSchema.optional(),
			after: z.object({ date: dayKeySchema, id: ulidSchema }).optional(),
		}),
	)
	.handler(
		({ data, context }): Promise<TransactionsPage> =>
			loadTransactionsPage(getDb(), context.household.id, { ...data, limit: PAGE_SIZE }),
	);

/** What a Transaction, or one of its Splits, is assigned to. */
const assignmentSchema = z.union([
	z.object({ bucketId: ulidSchema }),
	z.object({ commitmentId: ulidSchema }),
]);

/**
 * Changes a Transaction's amount, assignment, note, and For. `month` is the Transaction's own,
 * so the right month's screens refresh. Idempotent, so the client can retry it safely.
 */
export const updateTransaction = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			transactionId: ulidSchema,
			month: monthKeySchema,
			amountCents: z.number().int().min(1).max(MAX_CENTS),
			assignment: assignmentSchema,
			note: z.string().trim().max(80).optional(),
			forMemberIds: z.array(ulidSchema).max(20),
		}),
	)
	.handler(async ({ data, context }) => {
		const result = await updateTransactionInDb(getDb(), {
			householdId: context.household.id,
			transactionId: data.transactionId,
			amountCents: data.amountCents,
			assignment: data.assignment,
			note: data.note || null,
			forMemberIds: data.forMemberIds,
		});
		if (!result.ok) throw new Error("That isn’t in the Plan for this Transaction’s month.");
		await notifyHousehold(context.household.id, [
			// Every month: what's left can roll into later ones.
			"months",
			"for-earlier",
			"bucket-uses",
		]);
	});

/** How many Splits one Transaction can have. */
const MAX_SPLITS = 20;

/**
 * Splits a Transaction: sets its amount and note and replaces its whole assignment and For (and
 * any Splits it had) with `splits`, which must add up to the amount. Idempotent by the Splits'
 * client IDs, so the client can retry it safely.
 */
export const splitTransaction = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z
			.object({
				transactionId: ulidSchema,
				month: monthKeySchema,
				amountCents: z.number().int().min(1).max(MAX_CENTS),
				note: z.string().trim().max(80).optional(),
				splits: z
					.array(
						z.object({
							id: ulidSchema,
							amountCents: z.number().int().min(1).max(MAX_CENTS),
							assignment: assignmentSchema,
							forMemberIds: z.array(ulidSchema).max(20),
						}),
					)
					.min(2)
					.max(MAX_SPLITS),
			})
			.refine(
				(data) =>
					splitsBalance(
						data.amountCents,
						data.splits.map((split) => ({ amount: split.amountCents })),
					),
				"Splits must add up to the Transaction’s amount.",
			),
	)
	.handler(async ({ data, context }) => {
		const result = await splitTransactionInDb(getDb(), {
			householdId: context.household.id,
			transactionId: data.transactionId,
			amountCents: data.amountCents,
			note: data.note || null,
			splits: data.splits,
		});
		if (!result.ok) {
			throw new Error(
				result.reason === "splits-unbalanced"
					? "Splits must add up to the Transaction’s amount."
					: "A Split isn’t in the Plan for this Transaction’s month.",
			);
		}
		await notifyHousehold(context.household.id, [
			// Every month: what's left can roll into later ones.
			"months",
			"for-earlier",
			"bucket-uses",
		]);
	});

/** Deletes a Transaction. Idempotent, so the client can retry it safely. */
export const deleteTransaction = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ transactionId: ulidSchema, month: monthKeySchema }))
	.handler(async ({ data, context }) => {
		await deleteTransactionInDb(getDb(), {
			householdId: context.household.id,
			transactionId: data.transactionId,
		});
		await notifyHousehold(context.household.id, [
			// Every month: what's left can roll into later ones.
			"months",
			"for-earlier",
			"bucket-uses",
		]);
	});
