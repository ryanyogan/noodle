import {
	nameOf,
	type TransactionEdit,
	type TransactionRename,
	type TransactionRow,
} from "./transactions";

// Editing in a cell of the Transactions table (issue 99): which rows can be renamed or refiled
// without opening them, and the change each one writes. Pure, so the rules are tested alone.

/** The longest name a Transaction can be given (the server's limit for a name and for a note). */
export const NAME_MAX = 80;

type Row = Pick<
	TransactionRow,
	| "amountCents"
	| "bucketId"
	| "commitmentId"
	| "goal"
	| "note"
	| "merchantName"
	| "importedFrom"
	| "transfer"
	| "refundOf"
	| "for"
	| "splits"
	| "partlyPrivate"
>;

/**
 * What a row's cells offer. Its name: "edit" where the whole Transaction is assigned to one
 * Bucket or Commitment (the write the row's form makes), "rename" where only a name-only write
 * can take it (unassigned, split, a side of a Transfer, money back, a Refund), null where it
 * can't be changed here at all. `refile`: its Assigned to cell opens the Bucket picker.
 *
 * Goal spending changes only from its Goal, and one partly in the other Parent's Personal
 * Allowance is theirs to change (it arrives without its name). A split, a side of a Transfer,
 * money back and a Refund have no single Bucket to swap: they are refiled in the opened row.
 */
export function cellEdits(row: Row): { name: "edit" | "rename" | null; refile: boolean } {
	if (row.goal || row.partlyPrivate) return { name: null, refile: false };
	const special =
		row.splits.length > 0 || row.transfer !== null || row.refundOf !== null || row.amountCents < 1;
	if (special) return { name: "rename", refile: false };
	const whole = row.bucketId !== null || row.commitmentId !== null;
	return { name: whole ? "edit" : "rename", refile: true };
}

/** What the Name cell's field starts from: a bank row's name, a by-hand row's note as typed. */
export const cellName = (row: Pick<TransactionRow, "importedFrom" | "note" | "merchantName">) =>
	row.importedFrom !== null ? nameOf(row) : (row.note ?? "");

const assignmentOf = (row: Pick<TransactionRow, "bucketId" | "commitmentId">) =>
	row.bucketId
		? { bucketId: row.bucketId }
		: row.commitmentId
			? { commitmentId: row.commitmentId }
			: null;

/**
 * The change that gives a row the name typed in its cell, or null when there is nothing to save
 * (nothing typed, or the name it has). A bank row keeps its note, the bank's own wording; a
 * by-hand row's name is its note.
 */
export function renameOf(row: Row, typed: string): TransactionEdit | TransactionRename | null {
	const name = typed.trim().slice(0, NAME_MAX);
	const how = cellEdits(row).name;
	if (!how || !name || name === cellName(row)) return null;
	const assignment = assignmentOf(row);
	if (how === "rename" || !assignment) return { rename: name };
	const whole = { amountCents: row.amountCents, assignment, forMemberIds: row.for };
	return row.importedFrom !== null ? { ...whole, note: row.note, name } : { ...whole, note: name };
}

/** A picker's value for what a row is assigned to: "bucket:ID", "commitment:ID", or "". */
export const assignedValue = (row: Pick<TransactionRow, "bucketId" | "commitmentId">) =>
	row.bucketId
		? `bucket:${row.bucketId}`
		: row.commitmentId
			? `commitment:${row.commitmentId}`
			: "";

/**
 * The change that files a row in what its cell's picker chose (`value` as `assignedValue`), with
 * its amount, note and For as they are. Null when it is already there or can't be refiled here.
 */
export function refileOf(row: Row, value: string): TransactionEdit | null {
	if (!cellEdits(row).refile || value === assignedValue(row)) return null;
	const [kind, id] = value.split(":");
	if (!id || (kind !== "bucket" && kind !== "commitment")) return null;
	return {
		amountCents: row.amountCents,
		note: row.note,
		assignment: kind === "bucket" ? { bucketId: id } : { commitmentId: id },
		forMemberIds: row.for,
	};
}

/**
 * The change that puts a row back as it was before `next` (a cell's rename or refile), for the
 * message's Undo. Null where no write can: a row that was unassigned can't be unassigned again
 * from here, and one that had no name can't be given none.
 */
export function undoOf(
	row: Row,
	next: TransactionEdit | TransactionRename,
): TransactionEdit | TransactionRename | null {
	const was = cellName(row);
	if ("rename" in next) return was ? { rename: was } : null;
	const assignment = assignmentOf(row);
	if (!assignment || "splits" in next) return null;
	const whole = { amountCents: row.amountCents, assignment, forMemberIds: row.for };
	// A bank row is named back only if this change named it.
	if (row.importedFrom !== null) {
		return next.name
			? was
				? { ...whole, note: row.note, name: was }
				: null
			: { ...whole, note: row.note };
	}
	return { ...whole, note: row.note };
}
