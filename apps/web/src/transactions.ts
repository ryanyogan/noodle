import type { Assignment, SplitRow, TransactionCursor, TransactionRow } from "@noodle/db";
import { assignedParts, type MonthKey } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import {
	type InfiniteData,
	infiniteQueryOptions,
	type QueryClient,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { formatMoney } from "./format";
import { monthChangeKey } from "./plan-changes";
import { bucketUsesQuery, forTotalsEarlierKey, monthQuery, monthsKey } from "./queries";
import type { MonthData } from "./server/month";
import {
	deleteTransaction,
	getTransactions,
	splitTransaction,
	type TransactionsPage,
	updateTransaction,
} from "./server/transactions";

export type { Assignment, SplitRow, TransactionRow };

/** The list's filters: a Bucket, and who it was For (a Member, or "everyone"). */
export type TransactionFilters = { bucket?: string; for?: string };

/**
 * Every cached list of a month's Transactions, whatever the filters. Kept under the month, so
 * anything that refetches the month (a Quick Add, a Plan change, the other Parent's write)
 * refetches its lists too.
 */
export const transactionsKey = (month: MonthKey) =>
	[...monthQuery(month).queryKey, "transactions"] as const;

/** A month's Transactions, newest first, a page at a time. */
export const transactionsQuery = (month: MonthKey, filters: TransactionFilters) =>
	infiniteQueryOptions({
		queryKey: [...transactionsKey(month), filters],
		queryFn: ({ pageParam }) =>
			getTransactions({
				data: { month, bucketId: filters.bucket, forMember: filters.for, after: pageParam },
			}),
		initialPageParam: undefined as TransactionCursor | undefined,
		getNextPageParam: (page) => page.next ?? undefined,
	});

/** A Split as a Parent edits it; `id` is a client ULID, kept for Splits that already exist. */
export type SplitEdit = {
	id: string;
	amountCents: number;
	assignment: Assignment;
	forMemberIds: string[];
};

/**
 * New values for what a Parent can edit on a Transaction: its amount and note, and either one
 * assignment and For for the whole of it, or Splits that add up to the amount.
 */
export type TransactionEdit = { amountCents: number; note: string | null } & (
	| { assignment: Assignment; forMemberIds: string[] }
	| { splits: SplitEdit[] }
);

/** A change to one Transaction: new values for what a Parent can edit, or `null` to delete it. */
export type TransactionChange = {
	transaction: TransactionRow;
	/** What it's called in messages: its transactionLabel from before the change. */
	label: string;
	next: TransactionEdit | null;
};

/** The month a Transaction is in. */
export const monthOfTransaction = (transaction: TransactionRow) =>
	transaction.date.slice(0, 7) as MonthKey;

/**
 * A month's inputs with a Transaction changed or deleted, mirroring what the server records: its
 * spending leaves whichever Buckets or Commitments it (or its Splits) was in and, unless deleted,
 * lands in its new ones with its new amounts and For. `monthState` then reassigns it everywhere
 * at once.
 */
export function withTransactionChange(data: MonthData, change: TransactionChange): MonthData {
	const { id, date } = change.transaction;
	const spending = data.spending.filter((spend) => spend.id !== id);
	const charges = data.charges.filter((charge) => charge.id !== id);
	const next = change.next;
	if (next) {
		const parts = assignedParts(
			"splits" in next
				? {
						date,
						amount: next.amountCents,
						assignment: null,
						for: [],
						splits: next.splits.map((split) => ({
							amount: split.amountCents,
							assignment: split.assignment,
							for: split.forMemberIds,
						})),
					}
				: {
						date,
						amount: next.amountCents,
						assignment: next.assignment,
						for: next.forMemberIds,
						splits: [],
					},
		);
		spending.push(...parts.spending.map((spend) => ({ ...spend, id })));
		charges.push(...parts.charges.map((charge) => ({ ...charge, id })));
	}
	return { ...data, spending, charges };
}

/** A Transaction's row once `next` has landed on it. */
function editedRow(row: TransactionRow, next: TransactionEdit): TransactionRow {
	if ("splits" in next) {
		return {
			...row,
			amountCents: next.amountCents,
			note: next.note,
			// A split Transaction is assigned, and For, only through its Splits.
			bucketId: null,
			commitmentId: null,
			for: [],
			autoFiled: null,
			splits: next.splits.map(
				(split): SplitRow => ({
					id: split.id,
					amountCents: split.amountCents,
					bucketId: "bucketId" in split.assignment ? split.assignment.bucketId : null,
					commitmentId: "commitmentId" in split.assignment ? split.assignment.commitmentId : null,
					// The editor only assigns Splits to Buckets and Commitments.
					goal: null,
					for: split.forMemberIds,
				}),
			),
		};
	}
	return {
		...row,
		amountCents: next.amountCents,
		bucketId: "bucketId" in next.assignment ? next.assignment.bucketId : null,
		commitmentId: "commitmentId" in next.assignment ? next.assignment.commitmentId : null,
		note: next.note,
		for: next.forMemberIds,
		splits: [],
		// A Parent has changed or confirmed it: it's no longer categorization's.
		autoFiled: null,
	};
}

/** A list's pages with a Transaction changed or deleted. */
export function withRowChange(
	data: InfiniteData<TransactionsPage>,
	change: TransactionChange,
): InfiniteData<TransactionsPage> {
	const { id } = change.transaction;
	const next = change.next;
	return {
		...data,
		pages: data.pages.map((page) => ({
			...page,
			transactions: next
				? page.transactions.map((row) => (row.id === id ? editedRow(row, next) : row))
				: page.transactions.filter((row) => row.id !== id),
		})),
	};
}

/** Saves a change to a Transaction on the server: an edit, a split, or a delete. */
export function saveTransactionChange({ transaction, next }: TransactionChange) {
	const month = monthOfTransaction(transaction);
	if (next && "splits" in next) {
		return splitTransaction({
			data: {
				transactionId: transaction.id,
				month,
				amountCents: next.amountCents,
				note: next.note ?? undefined,
				splits: next.splits,
			},
		});
	}
	return next
		? updateTransaction({
				data: {
					transactionId: transaction.id,
					month,
					amountCents: next.amountCents,
					assignment: next.assignment,
					note: next.note ?? undefined,
					forMemberIds: next.forMemberIds,
				},
			})
		: deleteTransaction({ data: { transactionId: transaction.id, month } });
}

/**
 * Lands a change to a Transaction in its month's cached inputs and every cached list of that
 * month at once (ADR-0006). Returns what puts them back if the change fails.
 */
export async function applyTransactionChange(queryClient: QueryClient, change: TransactionChange) {
	const month = monthOfTransaction(change.transaction);
	const monthKey = monthQuery(month).queryKey;
	// Also cancels the month's lists, which live under its key.
	await queryClient.cancelQueries({ queryKey: monthKey });
	const previousMonth = queryClient.getQueryData(monthKey);
	if (previousMonth) {
		queryClient.setQueryData(monthKey, withTransactionChange(previousMonth, change));
	}
	const previousLists = queryClient.getQueriesData<InfiniteData<TransactionsPage>>({
		queryKey: transactionsKey(month),
	});
	for (const [queryKey, list] of previousLists) {
		if (list) queryClient.setQueryData(queryKey, withRowChange(list, change));
	}
	return () => {
		if (previousMonth) queryClient.setQueryData(monthKey, previousMonth);
		for (const [queryKey, list] of previousLists) queryClient.setQueryData(queryKey, list);
	};
}

/**
 * After a change to spending settles: refetch every month, and what follows from spending. Not
 * while another change is in flight, which the refetch would briefly undo on screen.
 */
export function refetchAfterChange(queryClient: QueryClient) {
	if (queryClient.isMutating({ mutationKey: monthChangeKey }) === 1) {
		return Promise.all([
			queryClient.invalidateQueries({ queryKey: monthsKey }),
			queryClient.invalidateQueries({ queryKey: forTotalsEarlierKey }),
			queryClient.invalidateQueries({ queryKey: bucketUsesQuery().queryKey }),
		]);
	}
}

/**
 * Edits, splits, or deletes a Transaction. The change lands in its month's cached inputs and every cached
 * list of that month at once (ADR-0006), so This Month's Bucket meters and the list move before
 * the server answers. A failure rolls both back and offers a retry. Lives above the edit sheet,
 * so it finishes after the sheet closes.
 */
export function useTransactionChange() {
	const queryClient = useQueryClient();
	const change = useMutation({
		mutationKey: monthChangeKey,
		mutationFn: saveTransactionChange,
		onMutate: async (variables) => ({
			rollback: await applyTransactionChange(queryClient, variables),
		}),
		onError: (_error, variables, context) => {
			context?.rollback();
			toast(
				variables.next
					? `Couldn’t save your change to ${variables.label}, so it’s been undone.`
					: `Couldn’t delete ${variables.label}, so it’s back.`,
				{ tone: "error", action: { label: "Retry", onClick: () => change.mutate(variables) } },
			);
		},
		onSuccess: (_data, variables) => {
			toast(variables.next ? `${variables.label} saved` : `${variables.label} deleted`);
		},
		onSettled: () => refetchAfterChange(queryClient),
	});
	return change;
}

/** "$12.50 (Costco)" or "$12.50": how a Transaction is named in messages. */
export const transactionLabel = (transaction: Pick<TransactionRow, "amountCents" | "note">) =>
	transaction.note
		? `${formatMoney(transaction.amountCents)} (${transaction.note})`
		: formatMoney(transaction.amountCents);
