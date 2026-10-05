import {
	addDays,
	type Cents,
	type DayKey,
	MATCH_WINDOW,
	type MatchSide,
	type ReceiptLine,
} from "@noodle/domain";
import { and, eq, gt, gte, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { counts } from "./counting";
import type { Db } from "./index";
import { matchImported } from "./matches";
import { changeableBy, type Viewer } from "./privacy";
import { buckets, households, matches, members, receipts, transactions } from "./schema";
import { stillUndecided } from "./transactions";

// Receipts: what a Parent forwards to the Household's Receipt address, read by a model into lines
// and attached to the Transaction it's for (or a Quick Add it makes). Everything here is done for
// the Parent who sent it (the Viewer): a Receipt only attaches to a Transaction they may change,
// and only they, or the other Parent seeing that Transaction whole, read it back; a line's Bucket
// is only read back when the reader may assign to it (ADR-0003).

/** The Household's Receipt address key (what goes after `receipts+`), or null before it has one. */
export async function loadReceiptAddress(db: Db, householdId: string): Promise<string | null> {
	const [row] = await db
		.select({ key: households.receiptAddress })
		.from(households)
		.where(eq(households.id, householdId));
	return row?.key ?? null;
}

/**
 * Gives the Household the Receipt address key `key`: always when `replace` (the old address stops
 * working), else only when it has none yet. Returns the key it has now.
 */
export async function setReceiptAddress(
	db: Db,
	input: { householdId: string; key: string; replace: boolean },
): Promise<string | null> {
	await db
		.update(households)
		.set({ receiptAddress: input.key })
		.where(
			and(
				eq(households.id, input.householdId),
				input.replace ? undefined : isNull(households.receiptAddress),
			),
		);
	return loadReceiptAddress(db, input.householdId);
}

/** The Household a Receipt address key is for, and its time zone; null for any other. */
export async function findReceiptAddress(
	db: Db,
	key: string,
): Promise<{ householdId: string; timeZone: string } | null> {
	const [row] = await db
		.select({ householdId: households.id, timeZone: households.timeZone })
		.from(households)
		.where(eq(households.receiptAddress, key));
	return row ?? null;
}

/** The Transaction has no Receipt attached. */
const withoutReceipt = sql`not exists (select 1 from ${receipts} where ${receipts.transactionId} = ${transactions.id})`;

/**
 * Transactions a Receipt dated `date` might be for, as the Parent who sent it may change them:
 * money spent that counts (a Quick Add, or an imported Transaction no Quick Add stands in for),
 * within the Match window either side, with no Receipt yet. receiptTransaction picks one.
 */
export async function loadReceiptCandidates(
	db: Db,
	viewer: Viewer,
	date: DayKey,
): Promise<MatchSide[]> {
	const rows = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			amount: transactions.amountCents,
			text: transactions.note,
		})
		.from(transactions)
		.where(
			and(
				changeableBy(viewer),
				counts(),
				gt(transactions.amountCents, 0),
				gte(transactions.date, addDays(date, -MATCH_WINDOW.to)),
				lte(transactions.date, addDays(date, MATCH_WINDOW.to)),
				withoutReceipt,
			),
		);
	return rows as MatchSide[];
}

export type AddReceiptResult = {
	/** This call wrote it; false when an earlier delivery of the same Receipt already had. */
	added: boolean;
	/** The Transaction it's attached to, if any. */
	transactionId: string | null;
	/** The months whose Quick Adds the new Quick Add's Matching paired with a bank copy. */
	matchedMonths: string[];
};

/**
 * Records a Receipt the Parent `memberId` sent. Idempotent per `id`, so a redelivered email is
 * recorded once. It's attached to `transactionId` if that's a Transaction they may change with no
 * Receipt yet; with `quickAdd` instead, a Quick Add for it is made (captured_via 'receipt',
 * unassigned, For the whole Household) and attached, in the same batch, and its bank copy, if
 * already imported, is Matched right away. With neither, it's kept unattached.
 */
export async function addReceipt(
	db: Db,
	input: {
		id: string;
		householdId: string;
		memberId: string;
		source: "email" | "photo";
		fileKey: string;
		thumbnailKey: string | null;
		merchant: string | null;
		date: DayKey | null;
		totalCents: Cents | null;
		lines: ReceiptLine[];
		transactionId: string | null;
		quickAdd?: { transactionId: string; date: DayKey; amountCents: Cents; note: string };
		newId: () => string;
	},
): Promise<AddReceiptResult> {
	const { householdId, memberId } = input;
	const viewer = { householdId, memberId };
	const attachTo = input.quickAdd?.transactionId ?? input.transactionId;
	const attachable = attachTo
		? sql`(select ${transactions.id} from ${transactions} where ${and(
				eq(transactions.id, attachTo),
				changeableBy(viewer),
				withoutReceipt,
			)})`
		: sql`null`;
	const insertReceipt = db
		.insert(receipts)
		.select(
			db
				.select({
					// Selected in the table's column order: insert … select is positional.
					id: sql<string>`${input.id}`.as("id"),
					householdId: members.householdId,
					memberId: members.id,
					source: sql<"email" | "photo">`${input.source}`.as("source"),
					transactionId: sql<string | null>`${attachable}`.as("transaction_id"),
					fileKey: sql<string>`${input.fileKey}`.as("file_key"),
					thumbnailKey: sql<string | null>`${input.thumbnailKey}`.as("thumbnail_key"),
					merchant: sql<string | null>`${input.merchant}`.as("merchant"),
					date: sql<string | null>`${input.date}`.as("date"),
					totalCents: sql<number | null>`${input.totalCents}`.as("total_cents"),
					lines: sql<string>`${JSON.stringify(input.lines)}`.as("lines"),
					createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
				})
				.from(members)
				// Written only by a Parent of the Household.
				.where(
					and(
						eq(members.id, memberId),
						eq(members.householdId, householdId),
						eq(members.kind, "parent"),
					),
				),
		)
		.onConflictDoNothing({ target: receipts.id })
		.returning({ id: receipts.id });
	const { quickAdd } = input;
	let added: { id: string }[];
	if (quickAdd) {
		const insertQuickAdd = db
			.insert(transactions)
			.select(
				db
					.select({
						// Selected in the table's column order: insert … select is positional.
						id: sql<string>`${quickAdd.transactionId}`.as("id"),
						householdId: members.householdId,
						source: sql<"quick-add">`'quick-add'`.as("source"),
						date: sql<string>`${quickAdd.date}`.as("date"),
						amountCents: sql<number>`${quickAdd.amountCents}`.as("amount_cents"),
						bucketId: sql<string | null>`null`.as("bucket_id"),
						note: sql<string>`${quickAdd.note}`.as("note"),
						createdByMemberId: members.id,
						createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
						commitmentId: sql<string | null>`null`.as("commitment_id"),
						accountId: sql<string | null>`null`.as("account_id"),
						goalId: sql<string | null>`null`.as("goal_id"),
						importId: sql<string | null>`null`.as("import_id"),
						externalId: sql<string | null>`null`.as("external_id"),
						capturedVia: sql<"receipt">`'receipt'`.as("captured_via"),
						pending: sql<boolean>`0`.as("pending"),
						merchant: sql<string | null>`null`.as("merchant"),
						version: sql<number>`0`.as("version"),
					})
					.from(members)
					.where(
						and(
							eq(members.id, memberId),
							eq(members.householdId, householdId),
							eq(members.kind, "parent"),
							// Once: a redelivered Receipt makes no second Quick Add.
							sql`not exists (select 1 from ${receipts} where ${receipts.id} = ${input.id})`,
						),
					),
			)
			.onConflictDoNothing({ target: transactions.id });
		[, added] = await db.batch([insertQuickAdd, insertReceipt]);
	} else {
		added = await insertReceipt;
	}
	const [written] = await db
		.select({ transactionId: receipts.transactionId })
		.from(receipts)
		.where(and(eq(receipts.id, input.id), eq(receipts.householdId, householdId)));
	const transactionId = written?.transactionId ?? null;
	let matchedMonths: string[] = [];
	if (quickAdd && transactionId === quickAdd.transactionId) {
		// A bank copy imported before the Receipt arrived, dated within the Match window.
		const matched = await matchImported(
			db,
			householdId,
			addDays(quickAdd.date, MATCH_WINDOW.from),
			addDays(quickAdd.date, MATCH_WINDOW.to),
			input.newId,
		);
		matchedMonths = matched.months;
	}
	return { added: added.length > 0, transactionId, matchedMonths };
}

/** A Receipt as a Parent reads it from its Transaction, with what applying it needs. */
export type ReceiptView = {
	id: string;
	source: "email" | "photo";
	merchant: string | null;
	date: DayKey | null;
	totalCents: Cents | null;
	/** Its lines; a line's Bucket only when the reader may assign to it. */
	lines: ReceiptLine[];
	thumbnailKey: string | null;
	transaction: {
		id: string;
		date: DayKey;
		amountCents: Cents;
		note: string | null;
		/**
		 * Nobody has decided its assignment: it's not split, and unassigned or only as
		 * categorization filed it. A confident Receipt applies its Splits on its own only then.
		 */
		undecided: boolean;
	};
};

/**
 * The Receipt of a Transaction `viewer` may change (so sees whole): one attached to it, or, for a
 * Quick Add, to its Matched bank copy. Null for any other, or one without a Receipt.
 */
export async function loadReceipt(
	db: Db,
	viewer: Viewer,
	transactionId: string,
): Promise<ReceiptView | null> {
	const [transaction] = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			amountCents: transactions.amountCents,
			note: transactions.note,
			undecided: sql<number>`${stillUndecided(eq(transactions.id, transactionId))}`,
		})
		.from(transactions)
		.where(and(eq(transactions.id, transactionId), changeableBy(viewer)));
	if (!transaction) return null;
	const [receipt] = await db
		.select()
		.from(receipts)
		.where(
			and(
				eq(receipts.householdId, viewer.householdId),
				or(
					eq(receipts.transactionId, transactionId),
					sql`${receipts.transactionId} in (select ${matches.importedId} from ${matches} where ${matches.quickAddId} = ${transactionId} and ${matches.removedAt} is null)`,
				),
			),
		);
	if (!receipt) return null;
	// Never another Parent's Personal Allowance, even as a suggestion.
	const unassignable = await db
		.select({ id: buckets.id })
		.from(buckets)
		.where(
			and(
				eq(buckets.householdId, viewer.householdId),
				isNotNull(buckets.ownerMemberId),
				ne(buckets.ownerMemberId, viewer.memberId),
			),
		);
	const hidden = new Set(unassignable.map((bucket) => bucket.id));
	return {
		id: receipt.id,
		source: receipt.source,
		merchant: receipt.merchant,
		date: receipt.date as DayKey | null,
		totalCents: receipt.totalCents,
		lines: receipt.lines.map((line) =>
			line.bucketId && hidden.has(line.bucketId)
				? { ...line, bucketId: null, confidence: 0 }
				: line,
		),
		thumbnailKey: receipt.thumbnailKey,
		transaction: {
			id: transaction.id,
			date: transaction.date as DayKey,
			amountCents: transaction.amountCents,
			note: transaction.note,
			undecided: Boolean(transaction.undecided),
		},
	};
}

/**
 * A Receipt the Parent `viewer` snapped and hasn't filed yet (attached to nothing): the day it's
 * dated, which its Quick Add takes. Null for anyone else's, or one already attached.
 */
export async function loadUnfiledReceipt(
	db: Db,
	viewer: Viewer,
	receiptId: string,
): Promise<{ date: DayKey | null } | null> {
	const [row] = await db
		.select({ date: receipts.date })
		.from(receipts)
		.where(
			and(
				eq(receipts.id, receiptId),
				eq(receipts.householdId, viewer.householdId),
				eq(receipts.memberId, viewer.memberId),
				isNull(receipts.transactionId),
			),
		);
	return row ? { date: row.date as DayKey | null } : null;
}
