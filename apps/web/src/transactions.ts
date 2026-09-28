import type { Assignment, TransactionCursor, TransactionRow } from "@noodle/db";
import type { MonthKey } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import {
	type InfiniteData,
	infiniteQueryOptions,
	type QueryKey,
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
	type TransactionsPage,
	updateTransaction,
} from "./server/transactions";

export type { Assignment, TransactionRow };

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

/** A change to one Transaction: new values for what a Parent can edit, or `null` to delete it. */
export type TransactionChange = {
	transaction: TransactionRow;
	/** What it's called in messages: its transactionLabel from before the change. */
	label: string;
	next: {
		amountCents: number;
		assignment: Assignment;
		note: string | null;
		forMemberIds: string[];
	} | null;
};

/** The month a Transaction is in. */
export const monthOfTransaction = (transaction: TransactionRow) =>
	transaction.date.slice(0, 7) as MonthKey;

/**
 * A month's inputs with a Transaction changed or deleted, mirroring what the server records: its
 * spending leaves whichever Bucket or Commitment it was in and, unless deleted, lands in its new
 * one with its new amount and For. `monthState` then reassigns it everywhere at once.
 */
export function withTransactionChange(data: MonthData, change: TransactionChange): MonthData {
	const { id, date } = change.transaction;
	const spending = data.spending.filter((spend) => spend.id !== id);
	const charges = data.charges.filter((charge) => charge.id !== id);
	const next = change.next;
	if (next && "bucketId" in next.assignment) {
		spending.push({
			id,
			date,
			bucketId: next.assignment.bucketId,
			amount: next.amountCents,
			for: next.forMemberIds,
		});
	} else if (next && "commitmentId" in next.assignment) {
		charges.push({
			id,
			date,
			commitmentId: next.assignment.commitmentId,
			amount: next.amountCents,
		});
	}
	return { ...data, spending, charges };
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
				? page.transactions.map((row) =>
						row.id === id
							? {
									...row,
									amountCents: next.amountCents,
									bucketId: "bucketId" in next.assignment ? next.assignment.bucketId : null,
									commitmentId:
										"commitmentId" in next.assignment ? next.assignment.commitmentId : null,
									note: next.note,
									for: next.forMemberIds,
								}
							: row,
					)
				: page.transactions.filter((row) => row.id !== id),
		})),
	};
}

/**
 * Edits or deletes a Transaction. The change lands in its month's cached inputs and every cached
 * list of that month at once (ADR-0006), so This Month's Bucket meters and the list move before
 * the server answers. A failure rolls both back and offers a retry. Lives above the edit sheet,
 * so it finishes after the sheet closes.
 */
export function useTransactionChange() {
	const queryClient = useQueryClient();
	const change = useMutation({
		mutationKey: monthChangeKey,
		mutationFn: ({ transaction, next }: TransactionChange) => {
			const month = monthOfTransaction(transaction);
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
		},
		onMutate: async (variables) => {
			const month = monthOfTransaction(variables.transaction);
			const monthKey = monthQuery(month).queryKey;
			// Also cancels the month's lists, which live under its key.
			await queryClient.cancelQueries({ queryKey: monthKey });
			const previousMonth = queryClient.getQueryData(monthKey);
			if (previousMonth) {
				queryClient.setQueryData(monthKey, withTransactionChange(previousMonth, variables));
			}
			const previousLists = queryClient.getQueriesData<InfiniteData<TransactionsPage>>({
				queryKey: transactionsKey(month),
			});
			for (const [queryKey, list] of previousLists) {
				if (list) queryClient.setQueryData(queryKey, withRowChange(list, variables));
			}
			return { monthKey, previousMonth, previousLists };
		},
		onError: (_error, variables, context) => {
			if (context?.previousMonth) {
				queryClient.setQueryData(context.monthKey, context.previousMonth);
			}
			for (const [queryKey, list] of context?.previousLists ?? ([] as [QueryKey, unknown][])) {
				queryClient.setQueryData(queryKey, list);
			}
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
		onSettled: () => {
			// Refetching while another change is in flight would briefly undo it on screen.
			if (queryClient.isMutating({ mutationKey: monthChangeKey }) === 1) {
				return Promise.all([
					queryClient.invalidateQueries({ queryKey: monthsKey }),
					queryClient.invalidateQueries({ queryKey: forTotalsEarlierKey }),
					queryClient.invalidateQueries({ queryKey: bucketUsesQuery().queryKey }),
				]);
			}
		},
	});
	return change;
}

/** "$12.50 (Costco)" or "$12.50": how a Transaction is named in messages. */
export const transactionLabel = (transaction: Pick<TransactionRow, "amountCents" | "note">) =>
	transaction.note
		? `${formatMoney(transaction.amountCents)} (${transaction.note})`
		: formatMoney(transaction.amountCents);
