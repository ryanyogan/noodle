import type { BankLine } from "./bank-connections";
import type { Cents } from "./money";
import type { DayKey } from "./month";
import { shareOut } from "./receipts";

// Keeping a Bank Connection's Accounts in step with the institution, whatever the provider. Each
// sync hands over lines that are new or changed since the last, and the IDs of lines the bank no
// longer has. A line already brought in is changed where it is (its date, amount, or pending), so
// whatever a Parent did to it (its assignment, Splits, For, note, Receipt, a Match) stays. A
// pending line's posted copy takes over its row the same way, so the two never both count: Plaid
// names the pending line a posted one replaces; a provider whose posted copy keeps the pending
// line's ID changes it in place. Money in to a checking or savings Account (income) isn't brought
// in until it posts. A line the bank dropped (a pending charge that fell off, say) goes.

/** The ID a bank line is kept under in its Account (as statementLineIds keys it). */
export const bankLineKey = (bankId: string) => `id:${bankId}`;

/** A line already brought into an Account, as a sync compares it. */
export type BankRow = {
	id: string;
	kind: "transaction" | "income";
	externalId: string;
	date: DayKey;
	/** In the row's own terms: money spent for a Transaction, money received for income. */
	amount: Cents;
	pending: boolean;
	/** A Transaction's Splits, in order, in the same terms; none unless it's split. */
	splits: { id: string; amount: Cents }[];
};

/** A row brought up to date with its line: the guard is the row as it was read. */
export type BankRowChange = {
	row: BankRow;
	externalId: string;
	date: DayKey;
	amount: Cents;
	pending: boolean;
	/**
	 * The row's Splits' new amounts, shared out in proportion to what they were when the amount
	 * changed; null when they stay as they are; empty when they can't be and are cleared.
	 */
	splits: { id: string; amount: Cents }[] | null;
};

export type BankSyncPlan = {
	/** Lines new to the Account: imported as a statement's are. */
	add: BankLine[];
	change: BankRowChange[];
	remove: BankRow[];
};

/** A line's amount as its row holds it: Transactions hold money spent, income money received. */
const rowAmount = (line: BankLine, kind: BankRow["kind"]) =>
	kind === "income" ? line.amount : -line.amount;

/**
 * What a sync does to one Account: `rows` are those of its rows the lines or `removed` name (by
 * their own ID or the pending line they replace); `holdsMoney` says money in is income there.
 */
export function planBankSync(
	rows: BankRow[],
	lines: BankLine[],
	removed: string[],
	holdsMoney: boolean,
): BankSyncPlan {
	const byKey = new Map(rows.map((row) => [row.externalId, row]));
	const add: BankLine[] = [];
	const change = new Map<string, BankRowChange>();
	const remove = new Map<string, BankRow>();
	// Rows a posted line took over: their old ID is gone, so removing it touches nothing.
	const posted = new Set<string>();

	// The last word on each line wins.
	const latest = new Map(lines.map((line) => [line.bankId, line]));
	for (const line of latest.values()) {
		const kind = line.amount > 0 && holdsMoney ? "income" : "transaction";
		const own = byKey.get(bankLineKey(line.bankId));
		const replaced = line.replaces ? byKey.get(bankLineKey(line.replaces)) : undefined;
		const pendingRow = replaced && replaced !== own && !posted.has(replaced.id) ? replaced : null;
		if (own) {
			// Posted already (a sync retried): the pending row mustn't count beside it.
			if (pendingRow) remove.set(pendingRow.id, pendingRow);
			const changed = changeRow(own, line);
			if (changed) change.set(own.id, changed);
		} else if (pendingRow && pendingRow.kind === kind && !line.pending) {
			posted.add(pendingRow.id);
			change.set(pendingRow.id, changeRow(pendingRow, line) as BankRowChange);
		} else {
			if (pendingRow) remove.set(pendingRow.id, pendingRow);
			// Pending money in waits for its posted copy.
			if (!(line.pending && kind === "income")) add.push(line);
		}
	}
	for (const bankId of removed) {
		const row = byKey.get(bankLineKey(bankId));
		if (!row || posted.has(row.id)) continue;
		change.delete(row.id);
		remove.set(row.id, row);
	}
	return { add, change: [...change.values()], remove: [...remove.values()] };
}

/** The row brought up to `line`; null when nothing about it changed. */
function changeRow(row: BankRow, line: BankLine): BankRowChange | null {
	const externalId = bankLineKey(line.bankId);
	const amount = rowAmount(line, row.kind);
	const pending = row.kind === "transaction" && line.pending === true;
	if (
		externalId === row.externalId &&
		line.date === row.date &&
		amount === row.amount &&
		pending === row.pending
	) {
		return null;
	}
	return {
		row,
		externalId,
		date: line.date,
		amount,
		pending,
		splits: row.splits.length > 0 && amount !== row.amount ? resplit(row.splits, amount) : null,
	};
}

/**
 * Splits shared out anew over `amount` (a tip added when the charge posted, say), in proportion
 * to what each was, so they still add up to it exactly. Empty when they can't be: the amount is
 * nothing, or it or any Split went the other way.
 */
export function resplit(
	splits: { id: string; amount: Cents }[],
	amount: Cents,
): { id: string; amount: Cents }[] {
	const sign = Math.sign(amount);
	if (sign === 0 || splits.some((split) => Math.sign(split.amount) !== sign)) return [];
	const shares = shareOut(
		amount,
		splits.map((split) => Math.abs(split.amount)),
	);
	return splits.map((split, i) => ({ id: split.id, amount: shares[i] as Cents }));
}
