import type { DayKey } from "@noodle/domain";
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
 * What each loaded day spent: a Transfer's sides count nowhere, money back takes off. With more
 * rows to come the last day may go on in the next page, so it has no total yet (null).
 */
export function dayTotals(
	transactions: Pick<TransactionRow, "date" | "amountCents" | "transfer">[],
	more: boolean,
): Map<DayKey, number | null> {
	const totals = new Map<DayKey, number | null>();
	for (const transaction of transactions) {
		const sum = totals.get(transaction.date) ?? 0;
		totals.set(transaction.date, transaction.transfer ? sum : sum + transaction.amountCents);
	}
	const last = transactions.at(-1);
	if (more && last) totals.set(last.date, null);
	return totals;
}

/**
 * What Esc does on the Transactions page, one thing at a time (issue 99): a menu, picker or sheet
 * that is open takes it itself; then the open Transaction closes; then the selection ends, unless
 * the key was pressed in a field (Esc there is the field's, e.g. clearing the search).
 */
export function escapeStep(at: {
	overlay: boolean;
	typing: boolean;
	open: boolean;
	selecting: boolean;
}): "nothing" | "close" | "unselect" {
	if (at.overlay) return "nothing";
	if (at.open) return "close";
	return at.selecting && !at.typing ? "unselect" : "nothing";
}
