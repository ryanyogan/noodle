import type {
	Assignment,
	SplitRow,
	TransactionCursor,
	TransactionRow,
	TransactionSort,
} from "@noodle/db";
import {
	assignedParts,
	canAssign,
	type DayKey,
	displayMerchant,
	type MonthKey,
} from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import {
	type InfiniteData,
	infiniteQueryOptions,
	type QueryClient,
	queryOptions,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { formatMoney, monthName, shortDay } from "./format";
import { monthChangeKey } from "./plan-changes";
import { bucketUsesQuery, forTotalsEarlierKey, monthQuery, monthsKey } from "./queries";
import { reviewWrites } from "./review-stack";
import type { MonthData } from "./server/month";
import {
	changeTransactionDate,
	deleteTransaction,
	getRangeBuckets,
	getSameMerchant,
	getTransaction,
	getTransactions,
	nameSameMerchant,
	renameTransaction,
	setTransactionFor,
	splitTransaction,
	type TransactionsPage,
	updateTransaction,
} from "./server/transactions";
import { rangeBounds, type TransactionRange } from "./transaction-range";
import { summaryAfterChange, type TransactionShow } from "./transaction-summary";
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
	/** More than the month (issue 99): the last 3 months, its year, or every month up to it. */
	range?: TransactionRange;
	/**
	 * The summary's filter (issue 134): only money in, only money out, or only what waits for a
	 * Parent. Money in is rows of the same list (issue 152).
	 */
	show?: TransactionShow;
};

/** The filters as a list's key. */
const listKey = (filters: TransactionFilters) => filters;

/**
 * Every cached list of more than a month (issue 99). Its rows are in several months, so it is
 * kept under "months" as an Account's list is: a change in any month refetches it.
 */
export const rangeTransactionsKey = [...monthsKey, "range-transactions"] as const;

/**
 * Every cached list of a month's Transactions, whatever the filters. Kept under the month, so
 * anything that refetches the month (a Quick Add, a Plan change, the other Parent's write)
 * refetches its lists too.
 */
export const transactionsKey = (month: MonthKey) =>
	[...monthQuery(month).queryKey, "transactions"] as const;

/**
 * A month's Transactions, newest first, a page at a time; with a range, those of every month in
 * it, ending at `month`.
 */
export const transactionsQuery = (month: MonthKey, filters: TransactionFilters) =>
	infiniteQueryOptions({
		queryKey: filters.range
			? [...rangeTransactionsKey, month, listKey(filters)]
			: [...transactionsKey(month), listKey(filters)],
		queryFn: ({ pageParam }) =>
			getTransactions({
				data: {
					month,
					...rangeBounds(filters.range, month),
					bucketId: filters.bucket,
					forMember: filters.for,
					accountId: filters.account,
					search: filters.q || undefined,
					review: filters.show === "review" || undefined,
					show: filters.show === "in" || filters.show === "out" ? filters.show : undefined,
					sort: filters.sort,
					after: pageParam,
				},
			}),
		initialPageParam: undefined as TransactionCursor | undefined,
		getNextPageParam: (page) => page.next ?? undefined,
	});

/** The Buckets of every month a list of more than a month covers: its Bucket filter's (issue 117). */
export const rangeBucketsQuery = (month: MonthKey, range: TransactionFilters["range"]) =>
	queryOptions({
		queryKey: [...monthsKey, "range-buckets", month, range ?? null] as const,
		queryFn: () => getRangeBuckets({ data: { month, ...rangeBounds(range, month) } }),
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

/**
 * Only a new name (issue 99, the table's Name cell): for a Transaction the whole-assignment edit
 * can't take (unassigned, split, a side of a Transfer, money back). Nothing else about it changes.
 */
export type TransactionRename = { rename: string };

/**
 * Only who it is For (issue 141, the row's For chips): for a Transaction with no Bucket, which
 * stays unassigned, and a split one, whose every Split takes it. Nothing else about it changes.
 */
export type TransactionFor = { for: string[] };

/**
 * Only the day it counts on (issue 148, ADR-0060): it moves to that day, and that day's month,
 * everywhere. Nothing else about it changes, so one that isn't filed anywhere yet can be moved too.
 */
export type TransactionDate = {
	date: DayKey;
	/**
	 * Undo's: the Bucket or Commitment the change of date took it out of, filed in again with its
	 * day in the same write.
	 */
	refile?: { bucketId: string } | { commitmentId: string };
};

/** What a change of date took a Transaction out of: its month's Plan didn't have it (ADR-0060). */
export type DateUnassigned = { kind: "bucket" | "commitment"; id: string; name: string };

/** Every change that keeps the Transaction: an edit, or one thing about it alone. */
type TransactionNext = TransactionEdit | TransactionRename | TransactionFor | TransactionDate;

/** A change to one Transaction: new values for what a Parent can edit, or `null` to delete it. */
export type TransactionChange = {
	transaction: TransactionRow;
	/** What it's called in messages: its transactionLabel from before the change. */
	label: string;
	next: TransactionNext | null;
	/** A delete the Parent was already told about, with its Undo: nothing more is said when it lands. */
	quiet?: boolean;
	/** What to say once it has saved, instead of "… saved" (a cell's rename or refile). */
	said?: string;
	/** With `said`: the change that puts it back, offered as the message's Undo. */
	back?: TransactionNext | null;
};

/** The month a change of date lands the Transaction in, when that isn't the one it is in. */
const leavesFor = (change: TransactionChange): MonthKey | null => {
	const { next, transaction } = change;
	if (!next || !("date" in next)) return null;
	const to = next.date.slice(0, 7) as MonthKey;
	return to === transaction.date.slice(0, 7) ? null : to;
};

/**
 * A Parent's change of a Transaction's date, with what they are told once it has saved ("Moved to
 * Sep 30", and the month when it left the one it was in) and the Undo that puts the day back.
 */
export function dateChange(transaction: TransactionRow, date: DayKey): TransactionChange {
	const change: TransactionChange = {
		transaction,
		label: transactionLabel(transaction),
		next: { date },
		back: { date: transaction.date as DayKey },
	};
	const to = leavesFor(change);
	return { ...change, said: `Moved to ${shortDay(date)}${to ? ` · ${monthName(to)}` : ""}` };
}

/**
 * What a Parent is told once a change of date has saved and left the Transaction unassigned: the
 * month it landed in had no such Bucket or Commitment in its Plan, so it is filed nowhere now.
 */
export function dateUnassignedText(
	{ said, next, transaction }: Pick<TransactionChange, "said" | "next" | "transaction">,
	unassigned: Pick<DateUnassigned, "name">,
) {
	const date = next && "date" in next ? next.date : transaction.date;
	const landing = monthName(date.slice(0, 7) as MonthKey);
	return `${said}. ${unassigned.name || "What it was filed in"} wasn’t in ${landing}’s Plan, so it isn’t filed anywhere now.`;
}

/** The change that puts a date back, and with it what the change of date took it out of. */
export const dateUndo = (
	back: TransactionNext | null | undefined,
	unassigned: DateUnassigned | null | undefined,
): TransactionNext | null | undefined =>
	back && "date" in back && unassigned
		? {
				date: back.date,
				refile:
					unassigned.kind === "bucket"
						? { bucketId: unassigned.id }
						: { commitmentId: unassigned.id },
			}
		: back;

/** Why the server left a Transaction's date as it was (ADR-0060). Sending it again won't help. */
export type DateRefusal = "month-closed" | "future" | "not-in-plan" | "refund-order";
/** For "not-in-plan": what holds it where it is filed, and the name of what the Plan lacked. */
export type DateHeld = { part: "split" | "money-back"; name: string };
export class DateRefused extends Error {
	constructor(
		readonly reason: DateRefusal,
		/** The closed month, for "month-closed". */
		readonly month?: MonthKey,
		readonly held?: DateHeld,
	) {
		super(reason);
		this.name = "DateRefused";
	}
}

/** Why a Transaction stayed on its day, said plainly. */
export function dateRefusedText(
	{ transaction, next }: Pick<TransactionChange, "transaction" | "next">,
	reason: DateRefusal,
	closed?: MonthKey,
	held?: DateHeld,
) {
	const date = next && "date" in next ? next.date : transaction.date;
	const landing = monthName(date.slice(0, 7));
	if (reason === "month-closed")
		return `${closed ? monthName(closed) : landing} is closed, so nothing moves into or out of it.`;
	if (reason === "future") return "A Transaction can’t be dated after today.";
	// Filed whole in what that month's Plan lacked, it moves and is left unassigned. Only a Split,
	// which is never unassigned, or money back counting where it is filed, holds it.
	if (reason === "not-in-plan") {
		const name = held?.name || transaction.assignedName || "what it’s filed in";
		return held?.part === "split"
			? `One of its Splits is filed in ${name}, which wasn’t in ${landing}’s Plan. Change that Split first.`
			: `Money back counts in ${name}, which wasn’t in ${landing}’s Plan. File it somewhere else first.`;
	}
	// A Refund comes after its purchase, within the days one may.
	return date > transaction.date
		? "Its Refund would come before it. Move the Refund first."
		: "Its Refund would come too long after it. Move the Refund first.";
}

/** The month a Transaction is in. */
export const monthOfTransaction = (transaction: TransactionRow) =>
	transaction.date.slice(0, 7) as MonthKey;

/**
 * What a Parent can assign to in `month`'s Plan, once it has loaded (issue 99): a row of another
 * month in a list of several is filed in its own month's Plan, never the one in the address. The
 * other Parent's Personal Allowance isn't theirs to assign to.
 */
export function useAssignablePlan(month: MonthKey, parentId: string, enabled = true) {
	const data = useQuery({ ...monthQuery(month), enabled }).data;
	return useMemo(
		() =>
			data
				? {
						buckets: data.plan.buckets.filter((b) => canAssign(b, parentId)),
						commitments: data.plan.commitments,
					}
				: null,
		[data, parentId],
	);
}

/**
 * A month's inputs with a Transaction changed or deleted, mirroring what the server records: its
 * spending leaves whichever Buckets or Commitments it (or its Splits) was in and, unless deleted,
 * lands in its new ones with its new amounts and For. `monthState` then reassigns it everywhere
 * at once.
 */
export function withTransactionChange(data: MonthData, change: TransactionChange): MonthData {
	const { id, date } = change.transaction;
	const next = change.next;
	// A new name moves no money.
	if (next && "rename" in next) return data;
	// A new day: within the month what it spent says the new day; out of it, it is no longer this
	// month's spending, as if it had been deleted from it (the month it lands in is asked for again).
	if (next && "date" in next) {
		const day = next.date;
		const stays = day.slice(0, 7) === date.slice(0, 7);
		return {
			...data,
			spending: stays
				? data.spending.map((spend) => (spend.id === id ? { ...spend, date: day } : spend))
				: data.spending.filter((spend) => spend.id !== id),
			charges: stays
				? data.charges.map((charge) => (charge.id === id ? { ...charge, date: day } : charge))
				: data.charges.filter((charge) => charge.id !== id),
		};
	}
	// Only who it was For: no money moves. What it (or each of its Splits, which all take the new
	// For) spent in a Bucket says the new For at once, so figures by person don't wait for the
	// month to come back. Money back on it is its own entry and stays as it is; an unassigned one
	// is in no Bucket's spending, and Commitment charges are For nobody.
	if (next && "for" in next) {
		const whose = next.for;
		return {
			...data,
			spending: data.spending.map((spend) =>
				spend.id === id && !spend.paidBack ? { ...spend, for: whose } : spend,
			),
		};
	}
	const spending = data.spending.filter((spend) => spend.id !== id);
	const charges = data.charges.filter((charge) => charge.id !== id);
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
function editedRow(row: TransactionRow, next: TransactionNext): TransactionRow {
	// Only its day. One from a bank or a statement keeps the bank's own day beside it while the
	// two differ; one typed in simply changes.
	if ("date" in next) {
		if (row.importedFrom === null) return { ...row, date: next.date };
		const banks = row.bankDate ?? row.date;
		return { ...row, date: next.date, bankDate: banks === next.date ? null : (banks as DayKey) };
	}
	// Only who it is For: a split one's Splits each take it; its assignment and Review stay.
	if ("for" in next) {
		return row.splits.length > 0
			? { ...row, splits: row.splits.map((split) => ({ ...split, for: next.for })) }
			: { ...row, for: next.for };
	}
	// A bank row takes the name beside its note (the bank's wording); a by-hand row's name is its note.
	if ("rename" in next) {
		return row.importedFrom !== null
			? { ...row, merchantName: next.rename }
			: { ...row, note: next.rename, merchantName: null };
	}
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
			// Split by a Parent: it waits in Review no longer.
			...(row.waits ? { waits: false } : {}),
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
		// Filed by a Parent: it waits in Review no longer.
		...(row.waits ? { waits: false } : {}),
	};
}

/** Whether the rows are newest first by day, as a list is unless the Parent sorted it otherwise. */
const newestFirst = (rows: TransactionRow[]) =>
	rows.every((row, i) => i === 0 || (rows[i - 1] as TransactionRow).date >= row.date);

/**
 * A list's pages with a Transaction on another day. In a list that is newest first the row goes
 * to its new day, above that day's other rows; in any other order it stays where it is until the
 * list comes back from the server.
 */
function withRowOnDay(
	data: InfiniteData<TransactionsPage>,
	id: string,
	next: TransactionDate,
): InfiniteData<TransactionsPage> {
	const rows = data.pages.flatMap((page) => page.transactions);
	const was = rows.find((row) => row.id === id);
	if (!was) return data;
	const moved = editedRow(was, next);
	if (!newestFirst(rows)) {
		return {
			...data,
			pages: data.pages.map((page) => ({
				...page,
				transactions: page.transactions.map((row) => (row.id === id ? moved : row)),
			})),
		};
	}
	// The first row of an earlier day or the same one: it goes just above. None: at the end.
	const before = rows.find((row) => row.id !== id && row.date <= moved.date);
	const last = data.pages.length - 1;
	return {
		...data,
		pages: data.pages.map((page, index) => {
			const transactions = page.transactions.filter((row) => row.id !== id);
			const at = before ? transactions.indexOf(before) : index === last ? transactions.length : -1;
			return {
				...page,
				transactions:
					at < 0 ? transactions : [...transactions.slice(0, at), moved, ...transactions.slice(at)],
			};
		}),
	};
}

/**
 * A list's pages with a Transaction changed or deleted. `monthOnly`: the list is one month's, so
 * a Transaction dated out of that month leaves it; a list of several months keeps it, on its day.
 */
export function withRowChange(
	data: InfiniteData<TransactionsPage>,
	change: TransactionChange,
	monthOnly = false,
): InfiniteData<TransactionsPage> {
	const { id } = change.transaction;
	if (change.next && "date" in change.next) {
		if (!(monthOnly && leavesFor(change))) return withRowOnDay(data, id, change.next);
	}
	// Dated out of this list's month, it leaves the list as a deleted one does.
	const next = change.next && "date" in change.next ? null : change.next;
	// As it is in this list, if it is: only then is it in the list's Money out.
	const was = data.pages.flatMap((page) => page.transactions).find((row) => row.id === id);
	return {
		...data,
		pages: data.pages.map((page) => ({
			...page,
			summary: page.summary && was ? summaryAfterChange(page.summary, was, next) : page.summary,
			transactions: next
				? page.transactions.map((row) => {
						if (row.id !== id) return row;
						const edited = editedRow(row, next);
						// Filed somewhere else: the name read with the row is no longer its Bucket's.
						return row.assignedName == null ||
							(edited.bucketId === row.bucketId && edited.commitmentId === row.commitmentId)
							? edited
							: { ...edited, assignedName: null };
					})
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
	if (next && "date" in next) {
		const moved = await changeTransactionDate({
			data: {
				transactionId: transaction.id,
				date: next.date,
				expectedVersion,
				refile: next.refile,
			},
		});
		if (moved.status === "refused")
			throw new DateRefused(
				moved.reason,
				"month" in moved ? moved.month : undefined,
				"part" in moved ? { part: moved.part, name: moved.name } : undefined,
			);
		settleWrite(transaction.id, moved);
		// What it was taken out of, for the message and its Undo: only the server knows whether
		// the month it landed in had its Bucket.
		return moved.status === "saved" && moved.unassigned
			? { unassigned: moved.unassigned }
			: undefined;
	}
	const answer =
		next && "rename" in next
			? await renameTransaction({
					data: { transactionId: transaction.id, month, name: next.rename, expectedVersion },
				})
			: next && "for" in next
				? await setTransactionFor({
						data: { transactionId: transaction.id, month, forMemberIds: next.for, expectedVersion },
					})
				: next && "splits" in next
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
	if (answer.status === "month-ended") throw new MonthEnded();
	settleWrite(transaction.id, answer);
	// Renamed, and saved: the same name is offered for the merchant's other Transactions (#95).
	const named = next
		? "rename" in next
			? next.rename
			: "for" in next
				? undefined
				: next.name
		: undefined;
	if (named && transaction.importedFrom) void offerSameName(transaction, named);
}

/** What an imported Transaction is called: its name once it has one, else the bank's wording cleaned. */
export const nameOf = (transaction: Pick<TransactionRow, "merchantName" | "note">) =>
	transaction.merchantName ?? (transaction.note ? displayMerchant(transaction.note) : "");

/**
 * The name a Parent gave an imported Transaction in its form, or null when they gave it none.
 * `typed` is what they put in the name field, null while they haven't touched it: the form may
 * have opened on the bank's wording and the line been named in the background since, and saving
 * it for another reason must not write the old wording back as a name of theirs. An emptied name
 * goes back to the bank's.
 */
export function nameGiven(typed: string | null, calledNow: string, banksName: string) {
	if (typed === null) return null;
	const renamed = typed.trim() || banksName;
	return renamed && renamed !== calledNow ? renamed : null;
}

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
/**
 * A delete, or a change of amount or filing, the server refused: money Paid back on the purchase,
 * or a Refund linked to it, counted in a month that has ended, which never changes (ADR-0058).
 * Sending it again won't help.
 */
export class MonthEnded extends Error {
	constructor() {
		super("month-ended");
		this.name = "MonthEnded";
	}
}

/**
 * Why a purchase stayed as it was, said plainly: its amount, where it's filed and its Splits can't
 * change, and it can't be deleted, once money back on it counted in a month that has ended.
 */
export const monthEndedText = (label: string, edit: boolean) =>
	edit
		? `Money back on ${label} counted in a month that has ended, so its amount and where it’s filed stay as they are. You can still change its note and who it’s For.`
		: `Money back on ${label} counted in a month that has ended, so it can’t be deleted.`;

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
		...queryClient.getQueriesData<InfiniteData<TransactionsPage>>({
			queryKey: rangeTransactionsKey,
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
	// The month's own lists: a Transaction dated out of the month leaves them (issue 148).
	const ofMonth = queryClient.getQueriesData<InfiniteData<TransactionsPage>>({
		queryKey: transactionsKey(month),
	});
	const previousLists = [
		...ofMonth,
		// An Account's list holds Transactions from any month.
		...queryClient.getQueriesData<InfiniteData<TransactionsPage>>({
			queryKey: [...monthsKey, "account-transactions"],
		}),
		// So does a list of more than a month (issue 99).
		...queryClient.getQueriesData<InfiniteData<TransactionsPage>>({
			queryKey: rangeTransactionsKey,
		}),
	];
	// The lists outside the month's key are fetching too: a late answer would undo the change.
	await queryClient.cancelQueries({ queryKey: rangeTransactionsKey });
	// One Transaction asked for by its ID is cached under its month's key too: it is not a list.
	const lists = previousLists.filter(([, list]) => Array.isArray(list?.pages));
	for (const [queryKey, list] of lists) {
		if (list)
			queryClient.setQueryData(
				queryKey,
				withRowChange(
					list,
					change,
					ofMonth.some(([key]) => key === queryKey),
				),
			);
	}
	return () => {
		if (previousMonth) queryClient.setQueryData(monthKey, previousMonth);
		for (const [queryKey, list] of lists) queryClient.setQueryData(queryKey, list);
	};
}

/**
 * Lands "File in…" (issue 99) for the rows this screen has loaded, in their month's cached inputs
 * and its cached lists at once, as a single refile does: `changes` are those rows' refiles.
 * Returns what puts them back if the server refuses. The open editor of one of them starts again
 * on the new Bucket when the list refetches; that is this screen's own change, so it isn't said
 * to have been "changed on another screen".
 */
export async function applyFiling(
	queryClient: QueryClient,
	month: MonthKey,
	changes: TransactionChange[],
) {
	saidAt = Date.now();
	const monthKey = monthQuery(month).queryKey;
	await queryClient.cancelQueries({ queryKey: monthKey });
	const previousMonth = queryClient.getQueryData(monthKey);
	if (previousMonth) {
		queryClient.setQueryData(
			monthKey,
			changes.reduce((data, change) => withTransactionChange(data, change), previousMonth),
		);
	}
	const previousLists = queryClient.getQueriesData<InfiniteData<TransactionsPage>>({
		queryKey: transactionsKey(month),
	});
	for (const [queryKey, list] of previousLists) {
		if (!list || !Array.isArray(list.pages)) continue;
		queryClient.setQueryData(
			queryKey,
			changes.reduce((data, change) => withRowChange(data, change), list),
		);
	}
	return () => {
		if (previousMonth) queryClient.setQueryData(monthKey, previousMonth);
		for (const [queryKey, list] of previousLists) queryClient.setQueryData(queryKey, list);
	};
}

/**
 * A Transaction a change of date left unassigned, in the lists that still show it (an Account's,
 * or one of several months): it reads as filed nowhere at once, before the lists come back.
 */
function showUnassigned(queryClient: QueryClient, id: string) {
	const lists = [
		...queryClient.getQueriesData<InfiniteData<TransactionsPage>>({
			queryKey: [...monthsKey, "account-transactions"],
		}),
		...queryClient.getQueriesData<InfiniteData<TransactionsPage>>({
			queryKey: rangeTransactionsKey,
		}),
	];
	for (const [queryKey, list] of lists) {
		if (!list || !Array.isArray(list.pages)) continue;
		if (!list.pages.some((page) => page.transactions.some((row) => row.id === id))) continue;
		queryClient.setQueryData(queryKey, {
			...list,
			pages: list.pages.map((page) => ({
				...page,
				transactions: page.transactions.map((row) =>
					row.id === id ? { ...row, bucketId: null, commitmentId: null, assignedName: null } : row,
				),
			})),
		});
	}
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
		// Written down until answered, and sent again if the page goes first (ADR-0056).
		meta: { outbox: "change" },
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
			if (error instanceof MonthEnded)
				return void toast(monthEndedText(variables.label, variables.next !== null), {
					tone: "error",
				});
			// Its day stays as it was, and why is said: nothing to retry.
			if (error instanceof DateRefused)
				return void toast(dateRefusedText(variables, error.reason, error.month, error.held), {
					tone: "error",
				});
			toast(
				variables.next
					? `Couldn’t save your change to ${variables.label}, so it’s been undone.`
					: `Couldn’t delete ${variables.label}, so it’s back.`,
				{ tone: "error", action: { label: "Retry", onClick: () => change.mutate(variables) } },
			);
		},
		onSuccess: (data, variables) => {
			// The month it landed in had no such Bucket: wherever it still shows, it is filed nowhere.
			const unassigned = data?.unassigned;
			if (unassigned) showUnassigned(queryClient, variables.transaction.id);
			if (variables.quiet) return;
			// A cell's change says what it did, with an Undo that writes it back in its turn.
			if (variables.said) {
				const { next } = variables;
				// Undo of a change of date puts back what it was filed in too, in the same write.
				const back = dateUndo(variables.back, unassigned);
				// On its new day, and filed nowhere if so: where the Undo of a change of date finds it.
				const transaction =
					next && "date" in next
						? {
								...variables.transaction,
								date: next.date,
								...(unassigned ? { bucketId: null, commitmentId: null, assignedName: null } : {}),
							}
						: variables.transaction;
				return void toast(
					unassigned ? dateUnassignedText(variables, unassigned) : variables.said,
					back
						? {
								tone: "success",
								undo: () =>
									change.mutate({
										transaction,
										label: variables.label,
										next: back,
										quiet: true,
									}),
							}
						: undefined,
				);
			}
			toast(variables.next ? `${variables.label} saved` : `${variables.label} deleted`);
		},
		onSettled: () => refetchAfterChange(queryClient),
	});
	/**
	 * A delete leaves the screen at once and is said with an Undo; it is sent when the Undo has
	 * gone (or the page is put away), so Undo is simply never sending it (#97, ADR-0045). "Gone" is
	 * the toast's own end, not a clock beside it: while the toast waits (hovered, held, Alt+T) the
	 * delete waits too, so Undo is never showing for a delete already sent.
	 */
	const deleteWithUndo = (variables: TransactionChange) => {
		let settled = false;
		const rollback = applyTransactionChange(queryClient, variables);
		const done = () => {
			settled = true;
			document.removeEventListener("visibilitychange", onHide);
		};
		const send = () => {
			if (settled) return;
			done();
			// If it can't be deleted it is put back as it was, and the usual message offers a retry.
			change.mutate(
				{ ...variables, quiet: true },
				{ onError: () => void rollback.then((putBack) => putBack()) },
			);
		};
		const onHide = () => {
			if (document.visibilityState === "hidden") send();
		};
		document.addEventListener("visibilitychange", onHide);
		toast(deletedMessage(variables), {
			tone: "success",
			undo: () => {
				if (settled) return;
				done();
				void rollback.then((putBack) => putBack());
			},
			onGone: send,
		});
	};
	return {
		...change,
		mutate: (variables: TransactionChange) =>
			variables.next === null ? deleteWithUndo(variables) : change.mutate(variables),
	};
}

/** What is said when a Transaction is deleted: an imported one won't be brought in again. */
export const deletedMessage = ({
	transaction,
	label,
}: Pick<TransactionChange, "transaction" | "label">) =>
	transaction.importedFrom
		? "Deleted. It won’t come back when your bank syncs."
		: `${label} deleted`;

/** "$12.50 (Costco)" or "$12.50": how a Transaction is named in messages. */
export const transactionLabel = (transaction: Pick<TransactionRow, "amountCents" | "note">) =>
	transaction.note
		? `${formatMoney(transaction.amountCents)} (${transaction.note})`
		: formatMoney(transaction.amountCents);
