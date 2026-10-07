import {
	type AddReceiptResult,
	addReceipt,
	type Db,
	listMembers,
	loadCategorizableBuckets,
	loadReceipt,
	loadReceiptCandidates,
	settleCategorization,
	splitTransaction,
	updateTransaction,
	type Viewer,
} from "@noodle/db";
import {
	addMonths,
	type Cents,
	canApply,
	type DayKey,
	monthOfDay,
	parseReceiptAmount,
	proposeSplits,
	type ReceiptLine,
	type ReceiptPart,
	type ReceiptProposal,
	receiptDate,
	receiptLine,
	receiptTransaction,
} from "@noodle/domain";
import type { ReceiptInput, ReceiptReader } from "./receipt-model";
import { idFor } from "./stable-id";

// Filing a Receipt, however it arrived (forwarded by email, or snapped in Quick Add): the model
// reads it, the domain parses and reconciles what it read, and it's attached to the Transaction
// it's for, or a Quick Add is made for it (a snapped one waits for the Parent to check it first).
// When the model was sure of every item and nobody has decided the Transaction's assignment yet,
// its Splits are applied on their own. Nothing here knows the Worker, so tests run it against a
// test D1 with the fake model.

/** A Receipt as read: what it says, parsed, and the Splits it proposes. */
export type ReadReceipt = {
	merchant: string | null;
	date: DayKey;
	/** Its total, money spent; null when none was read. */
	totalCents: Cents | null;
	lines: ReceiptLine[];
	/** Null when no total was read to reconcile its lines with. */
	proposal: ReceiptProposal | null;
};

/** What a Receipt proposes: nothing without a total, else its lines reconciled with it. */
export function receiptProposal(
	totalCents: Cents | null,
	lines: ReceiptLine[],
): ReceiptProposal | null {
	return totalCents === null ? null : proposeSplits(totalCents, lines);
}

/**
 * Reads a Receipt the Parent `viewer` sent, `received` on that day: each item's Bucket chosen
 * from those they may assign to in the Plan this month or last, and For from the Household's
 * Members. A read that fails reads as nothing, so the Receipt is still kept.
 */
export async function readReceipt(
	deps: { db: Db; reader: ReceiptReader },
	viewer: Viewer,
	input: ReceiptInput,
	received: DayKey,
): Promise<ReadReceipt> {
	const month = monthOfDay(received);
	const [buckets, members] = await Promise.all([
		loadCategorizableBuckets(deps.db, viewer, addMonths(month, -1), month),
		listMembers(deps.db, viewer.householdId),
	]);
	const reading = await deps.reader.read(
		input,
		buckets.map(({ id, name }) => ({ id, name })),
		members.filter((member) => !member.removed).map(({ id, name }) => ({ id, name })),
	);
	const lines = reading.lines.flatMap((read) => receiptLine(read) ?? []);
	const total = reading.total === null ? null : parseReceiptAmount(reading.total);
	const totalCents = total !== null && total > 0 ? total : null;
	return {
		merchant: reading.merchant,
		date: receiptDate(reading.date, received),
		totalCents,
		lines,
		proposal: receiptProposal(totalCents, lines),
	};
}

/** What filing a Receipt did. */
export type FiledReceipt = AddReceiptResult & {
	/** A Quick Add was made for it. */
	quickAdd: boolean;
	/** Its Splits were applied to its Transaction on their own. */
	applied: boolean;
};

/**
 * Files a Receipt `read` for the Parent `viewer` who sent it. Idempotent per `receipt.id`: a
 * redelivered email files it once and applies nothing twice.
 */
export async function fileReceipt(
	deps: {
		db: Db;
		newId: () => string;
		/** Files a new Quick Add the way a captured one is, when the Receipt doesn't. */
		categorize?: (transactionId: string) => Promise<unknown>;
		/**
		 * Keep a Receipt that matches no Transaction unattached, for the Parent to check and save as
		 * a Quick Add themselves (a snapped one), rather than making the Quick Add for it.
		 */
		keepUnmatched?: boolean;
	},
	viewer: Viewer,
	receipt: { id: string; source: "email" | "photo"; fileKey: string; thumbnailKey: string | null },
	read: ReadReceipt,
): Promise<FiledReceipt> {
	const { db } = deps;
	const { totalCents, date } = read;
	const merchant = read.merchant ?? "";
	const matched =
		totalCents === null
			? null
			: receiptTransaction(
					{ date, amount: totalCents, merchant },
					await loadReceiptCandidates(db, viewer, date),
				);
	const quickAdd =
		matched === null && totalCents !== null && !deps.keepUnmatched
			? {
					transactionId: await idFor(`${receipt.id}|quick-add`),
					date,
					amountCents: totalCents,
					note: read.merchant ?? "Receipt",
				}
			: undefined;
	const result = await addReceipt(db, {
		...receipt,
		householdId: viewer.householdId,
		memberId: viewer.memberId,
		merchant: read.merchant,
		date,
		totalCents,
		lines: read.lines,
		transactionId: matched,
		quickAdd,
		newId: deps.newId,
	});
	const applied =
		result.transactionId !== null &&
		(await applyOnItsOwn(db, viewer, receipt.id, result.transactionId, read));
	if (!applied && quickAdd && result.transactionId === quickAdd.transactionId) {
		await deps.categorize?.(quickAdd.transactionId);
	}
	return { ...result, quickAdd: quickAdd !== undefined, applied };
}

/**
 * Applies a confident Receipt's Splits to its Transaction, only while nobody has decided its
 * assignment and its amount is still the Receipt's total. One part assigns it whole.
 */
async function applyOnItsOwn(
	db: Db,
	viewer: Viewer,
	receiptId: string,
	transactionId: string,
	read: ReadReceipt,
): Promise<boolean> {
	const { proposal, totalCents } = read;
	if (proposal?.kind !== "parts" || !proposal.confident || !canApply(proposal.parts)) return false;
	const view = await loadReceipt(db, viewer, transactionId);
	const transaction = view?.transaction;
	if (!transaction?.undecided || transaction.amountCents !== totalCents) return false;
	const edit = {
		...viewer,
		transactionId: transaction.id,
		amountCents: transaction.amountCents,
		note: transaction.note,
		undecided: true,
	};
	const parts = proposal.parts as (ReceiptPart & { bucketId: string })[];
	const [whole] = parts;
	const result =
		parts.length === 1 && whole
			? await updateTransaction(db, {
					...edit,
					assignment: { bucketId: whole.bucketId },
					forMemberIds: whole.for,
				})
			: await splitTransaction(db, {
					...edit,
					splits: await Promise.all(
						parts.map(async (part, i) => ({
							id: await idFor(`${receiptId}|split|${i}`),
							amountCents: part.amount,
							assignment: { bucketId: part.bucketId },
							forMemberIds: part.for,
						})),
					),
				});
	if (!result.ok) return false;
	// Decided now: out of categorization and Review.
	await settleCategorization(db, viewer.householdId, transaction.id, viewer.memberId);
	return true;
}
