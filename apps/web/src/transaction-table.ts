import { type DayKey, owedBackUncounted } from "@noodle/domain";
import type { TableSort } from "@noodle/ui/lib/data-table";
import type { TransactionRow, TransactionSort } from "./transactions";

// The Transactions table's order and day labels (issue 99). The server sorts (rows come a page
// at a time, with privacy applied there); the table only says which order was asked for.

const ORDERS: Record<string, { asc: TransactionSort; desc: TransactionSort }> = {
	date: { asc: "oldest", desc: "newest" },
	name: { asc: "name-az", desc: "name-za" },
	assigned: { asc: "assigned-az", desc: "assigned-za" },
	account: { asc: "account-az", desc: "account-za" },
	amount: { asc: "smallest", desc: "largest" },
};

/** The list's order as the table's header shows it: a column and a direction. */
export function tableSortOf(sort: TransactionSort): TableSort {
	for (const [id, order] of Object.entries(ORDERS)) {
		if (order.asc === sort) return { id, desc: false };
		if (order.desc === sort) return { id, desc: true };
	}
	return { id: "date", desc: true };
}

/** The order a click on a column's header asks the server for. Unknown columns: newest first. */
export function transactionSortOf(sort: TableSort): TransactionSort {
	const order = ORDERS[sort.id];
	return order ? (sort.desc ? order.desc : order.asc) : "newest";
}

/** Whether the list runs by date, so its rows group under day labels. */
export const sortsByDate = (sort: TransactionSort) => sort === "newest" || sort === "oldest";

/**
 * What each loaded day spent: a Transfer's sides count nowhere, money back takes off, and the
 * Owed back part of a purchase is left out as the month leaves it out. With more
 * rows to come the last day may go on in the next page, so it has no total yet (null).
 */
export function dayTotals(
	transactions: Pick<
		TransactionRow,
		"date" | "amountCents" | "transfer" | "moneyIn" | "owedBack"
	>[],
	more: boolean,
): Map<DayKey, number | null> {
	const totals = new Map<DayKey, number | null>();
	for (const transaction of transactions) {
		const sum = totals.get(transaction.date) ?? 0;
		// Money in isn't spending, nor less of it: a day's total is what the day spent.
		const counts = !transaction.transfer && !transaction.moneyIn;
		// Nor is the part someone is paying back, for a purchase from October 1, 2026 on (ADR-0058,
		// revised 2026-10-08): the day adds up to the month's spending, the row keeps its full amount.
		const owed = owedBackUncounted(transaction.date)
			? (transaction.owedBack ?? []).reduce((part, item) => part + item.owed, 0)
			: 0;
		totals.set(transaction.date, counts ? sum + transaction.amountCents - owed : sum);
	}
	const last = transactions.at(-1);
	if (more && last) totals.set(last.date, null);
	return totals;
}

/**
 * What Esc does on the Transactions page, one thing at a time (issue 99): a menu, picker or sheet
 * that is open takes it itself; then a cell being edited gives up its edit (the field's own doing:
 * "cell" only says nothing else happens); then the open Transaction closes; then the selection
 * ends, unless the key was pressed in a field (Esc there is the field's, e.g. clearing the search).
 */
export function escapeStep(at: {
	overlay: boolean;
	/** The key was pressed in a cell's editor. */
	cell?: boolean;
	typing: boolean;
	open: boolean;
	selecting: boolean;
}): "nothing" | "cell" | "close" | "unselect" {
	if (at.overlay) return "nothing";
	if (at.cell) return "cell";
	if (at.open) return "close";
	return at.selecting && !at.typing ? "unselect" : "nothing";
}

/**
 * Where the open Transaction's editor is drawn in the table (issue 99): under its own row when
 * the list has loaded it, else in a first row of the table (it is further down, or the filters
 * leave it out; its address still shows it). "none" with nothing open.
 */
export function openPlace(
	open: string | undefined,
	loaded: readonly { id: string }[],
): "none" | "row" | "top" {
	if (!open) return "none";
	return loaded.some((row) => row.id === open) ? "row" : "top";
}

/**
 * Whether a row's Name and Assigned to edit in the cell: not the open row's, whose editor is
 * right under it with the same fields (two places to type one name). Other rows' still do.
 */
export const editsInCell = (id: string, open: string | undefined) => id !== open;
