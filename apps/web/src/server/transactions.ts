import {
	addQuickAdd as addQuickAddInDb,
	deleteTransaction as deleteTransactionInDb,
	loadBucketUses,
	loadRules,
	loadTransaction,
	loadTransactionsPage,
	loadUnfiledReceipt,
	splitTransaction as splitTransactionInDb,
	type TransactionCursor,
	type TransactionRow,
	updateTransaction as updateTransactionInDb,
} from "@noodle/db";
import {
	type BucketUse,
	type DayKey,
	dayKeyAt,
	MAX_CENTS,
	type Rule,
	splitsBalance,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { ulid } from "ulid";
import { z } from "zod";
import { afterAssignment } from "./categorize";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

/** How far back Quick Add looks to order Buckets by likelihood. */
const LIKELY_WINDOW_DAYS = 90;

/**
 * Records a Quick Add, dated today in the Household's time zone, or with the Receipt the Parent
 * snapped for it (`receiptId`), dated as that is (or today, `datedToday`, when that month has no
 * Plan) and with it attached. Idempotent per `transactionId` (a client ULID), so the client can
 * retry it safely.
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
			receiptId: ulidSchema.optional(),
			// The Receipt's month has no Plan to add it to, and the Parent was told it's dated today.
			datedToday: z.boolean().default(false),
		}),
	)
	.handler(async ({ data, context }) => {
		const db = getDb();
		const viewer = viewerOf(context);
		const today = dayKeyAt(new Date(), context.household.timeZone);
		// A retry after the Receipt was attached finds it filed: the Quick Add is already written.
		const receipt = data.receiptId ? await loadUnfiledReceipt(db, viewer, data.receiptId) : null;
		const result = await addQuickAddInDb(db, {
			householdId: context.household.id,
			transactionId: data.transactionId,
			bucketId: data.bucketId,
			date: (data.datedToday ? null : receipt?.date) ?? today,
			amountCents: data.amountCents,
			note: data.note || null,
			forMemberIds: data.forMemberIds,
			createdByMemberId: context.parent.id,
			receipt: receipt && data.receiptId ? { id: data.receiptId, newId: ulid } : undefined,
		});
		if (!result.ok) throw new Error("That Bucket isn’t in this month’s Plan.");
		// Every month: what's left can roll into later ones.
		await notifyHousehold(
			context.household.id,
			result.matchedMonths.length > 0
				? ["months", "for-earlier", "bucket-uses"]
				: ["months", "bucket-uses"],
			[{ type: "quick-add", transactionId: data.transactionId }],
		);
	});

/** Recent spending's Buckets, so Quick Add can offer the likeliest first. */
export const getBucketUses = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<BucketUse[]> => {
		const since = new Date(Date.now() - LIKELY_WINDOW_DAYS * 86_400_000);
		const { timeZone } = context.household;
		return loadBucketUses(getDb(), viewerOf(context), dayKeyAt(since, timeZone), timeZone);
	});

/**
 * The Rules that file into a Bucket, so Quick Add's note can put that Bucket first. Only the ones
 * this Parent may see: the Household's and their own private ones, never the other Parent's.
 */
export const getQuickAddRules = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<Rule[]> => {
		const rules = await loadRules(getDb(), viewerOf(context));
		return rules
			.filter((rule) => rule.bucketId)
			.map((rule) => ({ pattern: rule.pattern, bucketId: rule.bucketId, private: rule.private }));
	});

/** How many Transactions one page of the list holds. */
const PAGE_SIZE = 50;

const dayKeySchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
	.transform((day) => day as DayKey);

/** Who the list is filtered to: a Member, or "everyone" for spending For the whole Household. */
export const forFilterSchema = z.union([ulidSchema, z.literal("everyone")]);

export type TransactionsPage = {
	transactions: TransactionRow[];
	next: TransactionCursor | null;
	/** What the filtered month spent; on a month's first page only. */
	total: number | null;
};

/** How the list is ordered; newest first when left out. */
export const transactionSortSchema = z.enum(["newest", "oldest", "largest", "smallest"]);

/** What a Transactions search looks for in notes, at most this long. */
export const SEARCH_MAX = 60;

/**
 * One page of a month's Transactions (or, with no month, every month's), newest first, filtered
 * by Bucket, by who it was For, by Account and by words in the note. Never the other Parent's
 * Personal Allowance Transactions, whatever the filters.
 */
export const getTransactions = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			month: monthKeySchema.optional(),
			bucketId: ulidSchema.optional(),
			forMember: forFilterSchema.optional(),
			accountId: ulidSchema.optional(),
			search: z.string().trim().max(SEARCH_MAX).optional(),
			sort: transactionSortSchema.optional(),
			after: z
				.object({ date: dayKeySchema, id: ulidSchema, amountCents: z.number().int().optional() })
				.optional(),
		}),
	)
	.handler(
		({ data, context }): Promise<TransactionsPage> =>
			loadTransactionsPage(getDb(), viewerOf(context), { ...data, limit: PAGE_SIZE }),
	);

/**
 * One Transaction by its ID, as the list shows it, for its own address
 * (`/transactions/$month/$transactionId`) when the list hasn't loaded it. Null for what the list
 * would never show this Parent: another Household's, a deleted one, or one in the other Parent's
 * Personal Allowance (ADR-0003).
 */
export const getTransaction = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ transactionId: ulidSchema }))
	.handler(
		({ data, context }): Promise<TransactionRow | null> =>
			loadTransaction(getDb(), viewerOf(context), data.transactionId),
	);

/**
 * How a Parent's change to a Transaction ended (ADR-0041): saved, with the version it is at now
 * (null once deleted), or left alone because it had changed since the version the change was made
 * on, with the Transaction as it is now (null: gone, or no longer this Parent's to see). An
 * answer, not an error: the screen shows what is there now instead of a failure.
 */
export type TransactionWriteAnswer =
	| { status: "saved"; version: number | null }
	| { status: "changed-elsewhere"; current: TransactionRow | null };

const saved = (version: number | null): TransactionWriteAnswer => ({ status: "saved", version });

async function changedElsewhere(
	viewer: Parameters<typeof loadTransaction>[1],
	transactionId: string,
): Promise<TransactionWriteAnswer> {
	return {
		status: "changed-elsewhere",
		current: await loadTransaction(getDb(), viewer, transactionId),
	};
}

/** The version of the Transaction the change was made on; left out by a caller that has none. */
const versionSchema = z.number().int().min(0).optional();

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
			expectedVersion: versionSchema,
		}),
	)
	.handler(async ({ data, context }): Promise<TransactionWriteAnswer> => {
		const result = await updateTransactionInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			transactionId: data.transactionId,
			amountCents: data.amountCents,
			assignment: data.assignment,
			note: data.note || null,
			forMemberIds: data.forMemberIds,
			expectedVersion: data.expectedVersion,
		});
		if (!result.ok) {
			if (result.reason === "changed-elsewhere")
				return changedElsewhere(viewerOf(context), data.transactionId);
			throw new Error("That isn’t in the Plan for this Transaction’s month.");
		}
		// Changed or confirmed: categorization's marker goes, and its merchant is learned.
		await afterAssignment(viewerOf(context), data.transactionId);
		await notifyHousehold(context.household.id, [
			// Every month: what's left can roll into later ones.
			"months",
			"for-earlier",
			"bucket-uses",
		]);
		return saved(result.version);
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
				expectedVersion: versionSchema,
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
	.handler(async ({ data, context }): Promise<TransactionWriteAnswer> => {
		const result = await splitTransactionInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			transactionId: data.transactionId,
			amountCents: data.amountCents,
			note: data.note || null,
			splits: data.splits,
			expectedVersion: data.expectedVersion,
		});
		if (!result.ok) {
			if (result.reason === "changed-elsewhere")
				return changedElsewhere(viewerOf(context), data.transactionId);
			throw new Error(
				result.reason === "splits-unbalanced"
					? "Splits must add up to the Transaction’s amount."
					: "A Split isn’t in the Plan for this Transaction’s month.",
			);
		}
		// Decided by a Parent: it leaves categorization, and Review.
		await afterAssignment(viewerOf(context), data.transactionId);
		await notifyHousehold(context.household.id, [
			// Every month: what's left can roll into later ones.
			"months",
			"for-earlier",
			"bucket-uses",
		]);
		return saved(result.version);
	});

/** Deletes a Transaction. Idempotent, so the client can retry it safely. */
export const deleteTransaction = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			transactionId: ulidSchema,
			month: monthKeySchema,
			expectedVersion: versionSchema,
		}),
	)
	.handler(async ({ data, context }): Promise<TransactionWriteAnswer> => {
		const result = await deleteTransactionInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			transactionId: data.transactionId,
			expectedVersion: data.expectedVersion,
		});
		if (!result.ok) return changedElsewhere(viewerOf(context), data.transactionId);
		await notifyHousehold(context.household.id, [
			// Every month: what's left can roll into later ones.
			"months",
			"for-earlier",
			"bucket-uses",
		]);
		return saved(null);
	});
