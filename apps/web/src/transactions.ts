import type {
	Assignment,
	SplitRow,
	TransactionCursor,
	TransactionRow,
	TransactionSort,
} from "@noodle/db";
import { assignedParts, displayMerchant, type MonthKey } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import {
	type InfiniteData,
	infiniteQueryOptions,
	type QueryClient,
	queryOptions,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatMoney } from "./format";
import { monthChangeKey } from "./plan-changes";
import { bucketUsesQuery, forTotalsEarlierKey, monthQuery, monthsKey } from "./queries";
import { reviewWrites } from "./review-stack";
import type { MonthData } from "./server/month";
import {
	deleteTransaction,
	getSameMerchant,
	getTransaction,
	getTransactions,
	nameSameMerchant,
	splitTransaction,
	type TransactionsPage,
	updateTransaction,
} from "./server/transactions";
import {
	CHANGED_ELSEWHERE,
	ChangedElsewhere,
	expectedVersionOf,
	formSeen,
	settleWrite,
} from "./transaction-versions";

export type { Assignment, SplitRow, TransactionRow, TransactionSort };

/**
 * The list's filters: a Bucket, who it was For (a Member, or "everyone"), an Account, and words
 * in the note.
 */
export type TransactionFilters = {
	bucket?: string;
	for?: string;
	account?: string;
	q?: string;
	/** Newest first when left out. */
	sort?: TransactionSort;
};

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
				data: {
					month,
					bucketId: filters.bucket,
					forMember: filters.for,
					accountId: filters.account,
					search: filters.q || undefined,
					sort: filters.sort,
					after: pageParam,
				},
			}),
		initialPageParam: undefined as TransactionCursor | undefined,
		getNextPageParam: (page) => page.next ?? undefined,
	});

/**
 * One Transaction by its ID, for its own address when the month's list hasn't loaded it. Null when
 * it isn't this Parent's to see. Kept under its address's month, so it refetches with that month.
 */
export const transactionQuery = (month: MonthKey, transactionId: string) =>
	queryOptions({
		queryKey: [...transactionsKey(month), "one", transactionId],
		queryFn: () => getTransaction({ data: { transactionId } }),
	});

/**
 * Every cached list of an Account's Transactions (across months). Kept under "months", so a
 * change that refetches every month refetches these too.
 */
export const accountTransactionsKey = (accountId: string) =>
	[...monthsKey, "account-transactions", accountId] as const;

/** An Account's latest Transactions, in every month, newest first (its page lists a few). */
export const accountTransactionsQuery = (accountId: string) =>
	infiniteQueryOptions({
		queryKey: accountTransactionsKey(accountId),
		queryFn: ({ pageParam }) => getTransactions({ data: { accountId, after: pageParam } }),
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
export type TransactionEdit = {
	amountCents: number;
	note: string | null;
	/**
	 * The name a Parent gave one from their bank, only when they changed it (#95). Its note, the
	 * bank's own wording, is sent back as it was; a by-hand one's name is its note.
	 */
	name?: string;
} & ({ assignment: Assignment; forMemberIds: string[] } | { splits: SplitEdit[] });

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
			merchantName: next.name ?? row.merchantName,
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
		merchantName: next.name ?? row.merchantName,
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

/**
 * Saves a change to a Transaction on the server: an edit, a split, or a delete. It says which
 * version of the Transaction it was made on, read now, as it is sent: a change that waited its
 * turn behind another to the same Transaction goes with the version that one left (ADR-0041).
 * Throws ChangedElsewhere when the server left it alone because another screen changed it since.
 */
export async function saveTransactionChange({ transaction, next }: TransactionChange) {
	const month = monthOfTransaction(transaction);
	const expectedVersion = expectedVersionOf(transaction);
	const answer =
		next && "splits" in next
			? await splitTransaction({
					data: {
						transactionId: transaction.id,
						month,
						amountCents: next.amountCents,
						note: next.note ?? undefined,
						name: next.name,
						splits: next.splits,
						expectedVersion,
					},
				})
			: next
				? await updateTransaction({
						data: {
							transactionId: transaction.id,
							month,
							amountCents: next.amountCents,
							assignment: next.assignment,
							note: next.note ?? undefined,
							name: next.name,
							forMemberIds: next.forMemberIds,
							expectedVersion,
						},
					})
				: await deleteTransaction({
						data: { transactionId: transaction.id, month, expectedVersion },
					});
	settleWrite(transaction.id, answer);
	// Renamed, and saved: the same name is offered for the merchant's other Transactions (#95).
	if (next?.name && transaction.importedFrom) void offerSameName(transaction, next.name);
}

/** What an imported Transaction is called: its name once it has one, else the bank's wording cleaned. */
export const nameOf = (transaction: Pick<TransactionRow, "merchantName" | "note">) =>
	transaction.merchantName ?? (transaction.note ? displayMerchant(transaction.note) : "");

/** Refreshes this screen's lists once the others are renamed; other screens hear by live updates. */
let sameNameApplied: () => void = () => {};

/** What the offer to share a name asks, in plain words. */
export const sameNameOffer = (was: string, name: string, others: number) =>
	others > 0
		? `Call every ${was} “${name}”? ${others} ${others === 1 ? "other" : "others"}`
		: `Call ${was} “${name}” from now on?`;

/**
 * Offers, once, to call the merchant's other Transactions by the name a Parent just gave this one
 * and to remember it for what the bank sends later (ADR-0043). Nothing else is renamed unless
 * they take it. Every screen then hears of it the usual way (the Household's live updates). Never
 * throws: the rename itself is already saved.
 */
export async function offerSameName(transaction: TransactionRow, name: string) {
	const was = nameOf(transaction);
	if (!was || was === name) return;
	try {
		const { others } = await getSameMerchant({ data: { transactionId: transaction.id, name } });
		toast(sameNameOffer(was, name, others), {
			tone: "success",
			duration: 15_000,
			action: {
				label: others > 0 ? "Rename all" : "Remember",
				onClick: async () => {
					try {
						const { renamed } = await nameSameMerchant({
							data: { transactionId: transaction.id, name },
						});
						sameNameApplied();
						toast(
							renamed > 0
								? `${renamed} more now called “${name}”, and new ones from your bank will be too.`
								: `New ones from your bank will be called “${name}”.`,
						);
					} catch {
						toast(`Couldn’t rename the others. Nothing else was changed.`, { tone: "error" });
					}
				},
			},
		});
	} catch {
		// The offer is a nicety: without it the one rename stands.
	}
}

/** How long before the same "changed on another screen" message may be said again. */
const SAY_AGAIN_AFTER_MS = 5000;
let saidAt = Number.NEGATIVE_INFINITY;

/**
 * Says, once, that a Transaction was changed on another screen: several changes refused in a row
 * (cards decided one after another, or queued behind each other) get one message, not one each.
 */
export function sayChangedElsewhere(now = Date.now()) {
	if (now - saidAt < SAY_AGAIN_AFTER_MS) return;
	saidAt = now;
	toast(CHANGED_ELSEWHERE);
}

/**
 * The key of a Transaction's open edit form. It changes when another screen (the other Parent's,
 * another tab, or the bank's sync) changes the Transaction while the form is open: the form then
 * starts again from the fresh values and says so once, instead of later saving what it showed
 * before over the other change (ADR-0041). This screen's own saves don't restart it.
 */
export function useEditFormKey(transaction: Pick<TransactionRow, "id" | "version">) {
	const [seen, setSeen] = useState(() => ({
		id: transaction.id,
		version: transaction.version,
		elsewhere: 0,
	}));
	const now = formSeen(seen, transaction);
	// Derived from the row during render, so the form never renders once more on the old key.
	if (now !== seen) setSeen(now);
	const { elsewhere } = now;
	useEffect(() => {
		if (elsewhere > 0) sayChangedElsewhere();
	}, [elsewhere]);
	return `${now.id}:${elsewhere}`;
}

/**
 * Shows a Transaction as the server says it is now, after a change to it was refused: in every
 * cached list of its month and at its own address, so an open sheet has the fresh values before
 * the refetch lands. Null: it is gone.
 */
export function showCurrentTransaction(
	queryClient: QueryClient,
	transaction: TransactionRow,
	current: TransactionRow | null,
) {
	const month = monthOfTransaction(transaction);
	const lists = [
		...queryClient.getQueriesData<InfiniteData<TransactionsPage>>({
			queryKey: transactionsKey(month),
		}),
		...queryClient.getQueriesData<InfiniteData<TransactionsPage>>({
			queryKey: [...monthsKey, "account-transactions"],
		}),
	];
	for (const [queryKey, list] of lists) {
		// Only lists: the one-Transaction query lives under the same key and isn't paged.
		if (!list || !Array.isArray(list.pages)) continue;
		queryClient.setQueryData(queryKey, {
			...list,
			pages: list.pages.map((page) => ({
				...page,
				transactions: current
					? page.transactions.map((row) => (row.id === transaction.id ? current : row))
					: page.transactions.filter((row) => row.id !== transaction.id),
			})),
		});
	}
	queryClient.setQueryData(transactionQuery(month, transaction.id).queryKey, current);
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
	const previousLists = [
		...queryClient.getQueriesData<InfiniteData<TransactionsPage>>({
			queryKey: transactionsKey(month),
		}),
		// An Account's list holds Transactions from any month.
		...queryClient.getQueriesData<InfiniteData<TransactionsPage>>({
			queryKey: [...monthsKey, "account-transactions"],
		}),
	];
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
 *
 * Sent in turn with Review's writes (`reviewWrites`), and with other edits made here: the request
 * waits for the ones made before it, so the change made last is the one written last (#85).
 */
export function useTransactionChange() {
	const queryClient = useQueryClient();
	useEffect(() => {
		sameNameApplied = () => void refetchAfterChange(queryClient);
		return () => {
			sameNameApplied = () => {};
		};
	}, [queryClient]);
	const change = useMutation({
		mutationKey: monthChangeKey,
		scope: reviewWrites,
		mutationFn: saveTransactionChange,
		onMutate: async (variables) => ({
			rollback: await applyTransactionChange(queryClient, variables),
		}),
		onError: (error, variables, context) => {
			context?.rollback();
			// Another screen changed it first: nothing to retry, show how it is now (ADR-0041).
			if (error instanceof ChangedElsewhere) {
				showCurrentTransaction(
					queryClient,
					variables.transaction,
					error.current as TransactionRow | null,
				);
				return sayChangedElsewhere();
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
		onSettled: () => refetchAfterChange(queryClient),
	});
	return change;
}

/** "$12.50 (Costco)" or "$12.50": how a Transaction is named in messages. */
export const transactionLabel = (transaction: Pick<TransactionRow, "amountCents" | "note">) =>
	transaction.note
		? `${formatMoney(transaction.amountCents)} (${transaction.note})`
		: formatMoney(transaction.amountCents);
