import { env } from "cloudflare:workers";
import {
	addQuickAdd as addQuickAddInDb,
	countSameMerchant,
	type DeletionSummary,
	deleteTransaction as deleteTransactionInDb,
	type FiledBefore,
	type FilingResult,
	fileTransactions as fileTransactionsInDb,
	isCardKeptByHand,
	loadBucketsInMonths,
	loadBucketUses,
	loadRules,
	loadTransaction,
	loadTransactionsPage,
	loadUnfiledReceipt,
	nameSameMerchant as nameSameMerchantInDb,
	renameTransaction as renameTransactionInDb,
	setTransactionFor as setTransactionForInDb,
	splitTransaction as splitTransactionInDb,
	summarizeDeletion,
	type TransactionCursor,
	type TransactionRow,
	unfileTransactions,
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
import {
	changesAfterBulkDelete,
	deleteTransactionsWithSnapshot,
	newestMigration,
} from "./snapshot-store";

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
			// The card kept by hand it was paid with (issue 136): the Quick Add is the record there.
			accountId: ulidSchema.optional(),
		}),
	)
	.handler(async ({ data, context }) => {
		const db = getDb();
		const viewer = viewerOf(context);
		const today = dayKeyAt(new Date(), context.household.timeZone);
		// Only a card kept by hand takes a Quick Add as its record: any other Account is refused.
		if (data.accountId && !(await isCardKeptByHand(db, context.household.id, data.accountId))) {
			throw new Error("That isn’t a card this Household keeps by hand.");
		}
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
			accountId: data.accountId ?? null,
		});
		if (!result.ok) throw new Error("That Bucket isn’t in this month’s Plan.");
		// Every month: what's left can roll into later ones. On a card, what's owed there too.
		const onCard = data.accountId ? (["goals"] as const) : [];
		await notifyHousehold(
			context.household.id,
			result.matchedMonths.length > 0
				? ["months", "for-earlier", "bucket-uses", ...onCard]
				: ["months", "bucket-uses", ...onCard],
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
	/** The month's summary (issue 134), with `total`: whatever `review` narrows the list to. */
	summary: { outCents: number; needsReview: number } | null;
};

/** How the list is ordered; newest first when left out. */
export const transactionSortSchema = z.enum([
	"newest",
	"oldest",
	"largest",
	"smallest",
	"name-az",
	"name-za",
	"assigned-az",
	"assigned-za",
	"account-az",
	"account-za",
]);

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
			// More than a month (issue 99): from this month, or every month, up to the end of `month`.
			fromMonth: monthKeySchema.optional(),
			andEarlier: z.boolean().optional(),
			bucketId: ulidSchema.optional(),
			forMember: forFilterSchema.optional(),
			accountId: ulidSchema.optional(),
			search: z.string().trim().max(SEARCH_MAX).optional(),
			// Only spending that waits to be filed (issue 134).
			review: z.boolean().optional(),
			sort: transactionSortSchema.optional(),
			after: z
				.object({
					date: dayKeySchema,
					id: ulidSchema,
					amountCents: z.number().int().optional(),
					// What the last row sorted on, in a list by name, by what it's assigned to or by Account.
					key: z.string().max(500).optional(),
				})
				.optional(),
		}),
	)
	.handler(
		({ data, context }): Promise<TransactionsPage> =>
			loadTransactionsPage(getDb(), viewerOf(context), { ...data, limit: PAGE_SIZE }),
	);

/**
 * The Buckets of every month a list of more than a month covers (issue 117), each once, by name:
 * what its Bucket filter offers. Never the other Parent's Personal Allowance.
 */
export const getRangeBuckets = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			month: monthKeySchema,
			fromMonth: monthKeySchema.optional(),
			andEarlier: z.boolean().optional(),
		}),
	)
	.handler(({ data, context }) => loadBucketsInMonths(getDb(), viewerOf(context), data));

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

/**
 * A change, or a delete, that would move a month that has ended (issue 141, ADR-0058): refused,
 * and an answer rather than an error, so the screen says why in plain words.
 */
export type MonthEndedAnswer = { status: "month-ended" };

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
			name: z.string().trim().min(1).max(80).optional(),
			forMemberIds: z.array(ulidSchema).max(20),
			expectedVersion: versionSchema,
		}),
	)
	.handler(async ({ data, context }): Promise<TransactionWriteAnswer | MonthEndedAnswer> => {
		const result = await updateTransactionInDb(getDb(), {
			today: dayKeyAt(new Date(), context.household.timeZone),
			householdId: context.household.id,
			memberId: context.parent.id,
			transactionId: data.transactionId,
			amountCents: data.amountCents,
			assignment: data.assignment,
			note: data.note || null,
			name: data.name,
			forMemberIds: data.forMemberIds,
			expectedVersion: data.expectedVersion,
		});
		if (!result.ok) {
			if (result.reason === "month-ended") return { status: "month-ended" };
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

/**
 * Changes only what a Transaction is called (issue 99: the Name cell of the Transactions table),
 * for the rows a whole-assignment edit can't take. `month` is the Transaction's own, so the right
 * month's lists refresh. Idempotent, so the client can retry it safely.
 */
export const renameTransaction = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			transactionId: ulidSchema,
			month: monthKeySchema,
			name: z.string().trim().min(1).max(80),
			expectedVersion: versionSchema,
		}),
	)
	.handler(async ({ data, context }): Promise<TransactionWriteAnswer> => {
		const result = await renameTransactionInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			transactionId: data.transactionId,
			name: data.name,
			expectedVersion: data.expectedVersion,
		});
		if (!result.ok) {
			if (result.reason === "changed-elsewhere")
				return changedElsewhere(viewerOf(context), data.transactionId);
			throw new Error("That Transaction can’t be renamed here.");
		}
		// The lists live under their month.
		await notifyHousehold(context.household.id, ["months"]);
		return saved(result.version);
	});

/**
 * Changes only who a Transaction is For (issue 141: the For chips of a row with no Bucket, or a
 * split one, where every Split takes it). Its assignment stays as it is, so one that waits in
 * Review still does. Refused for anything in the other Parent's Personal Allowance (ADR-0003).
 * `month` is the Transaction's own, so the right month's screens refresh. Safe to retry.
 */
export const setTransactionFor = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			transactionId: ulidSchema,
			month: monthKeySchema,
			forMemberIds: z.array(ulidSchema).max(20),
			expectedVersion: versionSchema,
		}),
	)
	.handler(async ({ data, context }): Promise<TransactionWriteAnswer> => {
		const result = await setTransactionForInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			transactionId: data.transactionId,
			forMemberIds: data.forMemberIds,
			expectedVersion: data.expectedVersion,
		});
		if (!result.ok) {
			if (result.reason === "changed-elsewhere")
				return changedElsewhere(viewerOf(context), data.transactionId);
			throw new Error(
				result.reason === "for-differs"
					? "Its Splits are For different people. Open it to change them."
					: "Who that Transaction is For can’t be changed here.",
			);
		}
		// Who spending was For is in every month's figures by person.
		await notifyHousehold(context.household.id, ["months", "for-earlier"]);
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
				name: z.string().trim().min(1).max(80).optional(),
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
	.handler(async ({ data, context }): Promise<TransactionWriteAnswer | MonthEndedAnswer> => {
		const result = await splitTransactionInDb(getDb(), {
			today: dayKeyAt(new Date(), context.household.timeZone),
			householdId: context.household.id,
			memberId: context.parent.id,
			transactionId: data.transactionId,
			amountCents: data.amountCents,
			note: data.note || null,
			name: data.name,
			splits: data.splits,
			expectedVersion: data.expectedVersion,
		});
		if (!result.ok) {
			if (result.reason === "month-ended") return { status: "month-ended" };
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
	.handler(async ({ data, context }): Promise<TransactionWriteAnswer | MonthEndedAnswer> => {
		const result = await deleteTransactionInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			transactionId: data.transactionId,
			expectedVersion: data.expectedVersion,
			today: dayKeyAt(new Date(), context.household.timeZone),
		});
		// Money back on it counted in a month that has ended: it stays, and the screen says why.
		if (!result.ok && result.reason === "month-ended") return { status: "month-ended" };
		if (!result.ok) return changedElsewhere(viewerOf(context), data.transactionId);
		await notifyHousehold(context.household.id, [
			// Every month: what's left can roll into later ones.
			"months",
			"for-earlier",
			"bucket-uses",
		]);
		return saved(null);
	});

const sameMerchantSchema = z.object({
	transactionId: ulidSchema,
	name: z.string().trim().min(1).max(80),
});

/**
 * How many other Transactions from the same merchant as this imported one could take the name a
 * Parent just gave it (#95): only those theirs to change.
 */
export const getSameMerchant = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(sameMerchantSchema)
	.handler(async ({ data, context }) => ({
		others: await countSameMerchant(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			transactionId: data.transactionId,
			name: data.name,
		}),
	}));

/**
 * Calls every other Transaction from the same merchant by the name a Parent gave this one, and
 * remembers it for the merchant's later Imports (ADR-0043). The bank's wording is kept, so Rules
 * still match. Idempotent.
 */
export const nameSameMerchant = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(sameMerchantSchema)
	.handler(async ({ data, context }) => {
		const renamed = await nameSameMerchantInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			transactionId: data.transactionId,
			name: data.name,
		});
		if (renamed === null) throw new Error("Only a Transaction from your bank has a name to share.");
		await notifyHousehold(context.household.id, ["months", "for-earlier", "bucket-uses"]);
		return { renamed };
	});

/** The most Transactions picked one by one in a single delete; "all that match" has no such list. */
export const PICKED_MAX = 1000;

/**
 * Transactions picked on the Transactions page: these ones, or all the page's filters match in a
 * month (and, with `andEarlier`, every month before it) except some.
 */
const selectionSchema = z
	.object({
		ids: z.array(z.string().min(1).max(64)).max(PICKED_MAX).optional(),
		all: z
			.object({
				month: monthKeySchema,
				andEarlier: z.boolean().optional(),
				fromMonth: monthKeySchema.optional(),
				bucketId: ulidSchema.optional(),
				forMember: forFilterSchema.optional(),
				accountId: ulidSchema.optional(),
				search: z.string().trim().max(SEARCH_MAX).optional(),
				review: z.boolean().optional(),
			})
			.optional(),
		except: z.array(z.string().min(1).max(64)).max(PICKED_MAX).optional(),
	})
	.refine((selection) => (selection.ids === undefined) !== (selection.all === undefined));

export type { DeletionSummary };

/** What deleting a selection would touch, counted now, for the confirm sheet. Changes nothing. */
export const getDeletionSummary = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(selectionSchema)
	.handler(
		({ data, context }): Promise<DeletionSummary> =>
			summarizeDeletion(getDb(), viewerOf(context), data),
	);

/**
 * Deletes the selected Transactions that are this Parent's to delete, as they are now, after a
 * "Before deleting Transactions" snapshot (ADR-0045): nothing goes if that can't be taken. Says
 * how many went. Safe to retry: what is already gone is not counted or deleted again.
 */
export const deleteTransactions = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(selectionSchema)
	.handler(
		async ({
			data,
			context,
		}): Promise<{
			deleted: number;
			/** Left as they are: money back on them counted in a month that has ended. */
			kept: number;
			snapshot: boolean;
		}> => {
			const result = await deleteTransactionsWithSnapshot(
				{ db: getDb(), bucket: env.BACKUPS, migration: await newestMigration(env.DB) },
				viewerOf(context),
				data,
				new Date(),
				dayKeyAt(new Date(), context.household.timeZone),
			);
			const changes = changesAfterBulkDelete(result);
			if (changes.length > 0) await notifyHousehold(context.household.id, changes);
			return { deleted: result.deleted, kept: result.kept, snapshot: result.snapshotId !== null };
		},
	);

/** What "File in…" did: how many were filed, what was left and why, and what Undo puts back. */
export type FilingAnswer = Extract<FilingResult, { ok: true }>;

/**
 * Files the selected Transactions that one Bucket or Commitment can take whole in it (issue 99,
 * ADR-0055): inside `month` only. `versions` are those of the rows the screen had loaded; one that
 * has moved on is left alone and counted. Nothing is learned from it: no Rule, no merchant memory,
 * no signal to background AI, unlike a Transaction filed on its own. With `forMemberIds` each one
 * filed is For those Members too. Safe to retry.
 */
export const fileTransactions = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			selection: selectionSchema,
			month: monthKeySchema,
			assignment: assignmentSchema,
			versions: z.record(z.string().min(1).max(64), versionSchema).optional(),
			// Who they are For as well (issue 138); left out, For stays as it is.
			forMemberIds: z.array(ulidSchema).max(20).optional(),
		}),
	)
	.handler(async ({ data, context }): Promise<FilingAnswer> => {
		const versions: Record<string, number> = {};
		for (const [id, version] of Object.entries(data.versions ?? {})) {
			if (version !== undefined) versions[id] = version;
		}
		const result = await fileTransactionsInDb(getDb(), viewerOf(context), {
			selection: data.selection,
			month: data.month,
			assignment: data.assignment,
			versions,
			forMemberIds: data.forMemberIds,
			today: dayKeyAt(new Date(), context.household.timeZone),
		});
		if (!result.ok) {
			throw new Error(
				result.reason === "more-than-a-month"
					? "Transactions are filed one month at a time."
					: "That isn’t in the Plan for this month.",
			);
		}
		if (result.filed > 0) {
			await notifyHousehold(context.household.id, ["months", "for-earlier", "bucket-uses"]);
		}
		return result;
	});

/** Undo for "File in…": each goes back where it was, unless it has changed since (ADR-0055). */
export const undoFiling = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			entries: z
				.array(
					z.object({
						id: z.string().min(1).max(64),
						bucketId: ulidSchema.nullable(),
						commitmentId: ulidSchema.nullable(),
						version: z.number().int().min(0),
						for: z.array(z.string().min(1).max(64)).max(50).optional(),
					}),
				)
				.max(5000),
		}),
	)
	.handler(async ({ data, context }): Promise<{ restored: number; kept: number }> => {
		const entries: FiledBefore[] = data.entries;
		const result = await unfileTransactions(getDb(), viewerOf(context), entries, {
			today: dayKeyAt(new Date(), context.household.timeZone),
		});
		if (result.restored > 0) {
			await notifyHousehold(context.household.id, ["months", "for-earlier", "bucket-uses"]);
		}
		return result;
	});
