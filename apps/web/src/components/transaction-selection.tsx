import type { MonthKey } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { monthName } from "../format";
import { deleteTransactions, getDeletionSummary } from "../server/transactions";
import {
	bulkDeletedMessage,
	deletionFacts,
	matchingAll,
	type Picking,
	pickAll,
	pickedCount,
	SNAPSHOT_BEFORE_DELETE,
	selectionOf,
	stayingFacts,
	transactionsCount,
} from "../transaction-selection";
import type { TransactionFilters } from "../transactions";

// Select mode on the Transactions page (#97, ADR-0045): a bar that says how many are selected and
// offers "select all that match", and the sheet that states the facts before anything is deleted.

type Selection = ReturnType<typeof selectionOf>;

/** What deleting a selection would touch, asked afresh each time: never from an old answer. */
const summaryQuery = (selection: Selection, enabled = true) => ({
	queryKey: ["deletion-summary", selection] as const,
	queryFn: () => getDeletionSummary({ data: selection }),
	enabled,
	staleTime: 0,
	gcTime: 0,
});

/**
 * Stays at the top of the list while selecting: how many are selected, everything the filters
 * match in this month or up to the end of it, Delete, and Cancel.
 */
export function SelectionBar({
	month,
	filters,
	filtered,
	picking,
	onPick,
	onDelete,
	onCancel,
}: {
	month: MonthKey;
	filters: TransactionFilters;
	/** A filter or search is narrowing the list. */
	filtered: boolean;
	picking: Picking;
	onPick: (picking: Picking) => void;
	onDelete: () => void;
	onCancel: () => void;
}) {
	const inMonth = useQuery(summaryQuery({ all: matchingAll(month, filters, false) })).data?.count;
	const upToMonth = useQuery(summaryQuery({ all: matchingAll(month, filters, true) })).data?.count;
	const count = pickedCount(picking, picking.all?.andEarlier ? upToMonth : inMonth);
	const name = monthName(month);
	return (
		<section
			aria-label="Selecting Transactions"
			className="sticky top-2 z-20 grid gap-2 rounded-2xl border border-border-strong bg-card p-3 shadow-sm"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p role="status" className="text-sm font-semibold tabular-nums">
					{count === undefined ? "Counting…" : `${count.toLocaleString("en-US")} selected`}
				</p>
				<div className="flex flex-wrap items-center gap-2">
					<Button variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
					<Button variant="destructive" disabled={!count} onClick={onDelete}>
						<Trash2 />
						Delete
					</Button>
				</div>
			</div>
			<div className="flex flex-wrap gap-2">
				{inMonth !== undefined && inMonth > 0 && !(picking.all && !picking.all.andEarlier) ? (
					<Button variant="outline" size="wrap" onClick={() => onPick(pickAll(false))}>
						{filtered
							? `Select all ${inMonth.toLocaleString("en-US")} that match in ${name}`
							: `Select all ${inMonth.toLocaleString("en-US")} in ${name}`}
					</Button>
				) : null}
				{upToMonth !== undefined && upToMonth > (inMonth ?? 0) && !picking.all?.andEarlier ? (
					<Button variant="outline" size="wrap" onClick={() => onPick(pickAll(true))}>
						{filtered
							? `Select all ${upToMonth.toLocaleString("en-US")} that match in ${name} and every month before`
							: `Select all ${upToMonth.toLocaleString("en-US")} in ${name} and every month before`}
					</Button>
				) : null}
			</div>
			<p className="text-xs text-muted-foreground">
				Tap Transactions to select them. Goal spending can’t be selected: it changes from its Goal.
			</p>
		</section>
	);
}

/**
 * States what deleting the selection touches, counted on the server as it is now, and deletes
 * only when the Parent confirms. A snapshot is taken first; if it can't be, nothing is deleted.
 */
export function DeleteSelectedSheet({
	open,
	picking,
	month,
	filters,
	onClose,
	onDeleted,
}: {
	open: boolean;
	picking: Picking | null;
	month: MonthKey;
	filters: TransactionFilters;
	onClose: () => void;
	onDeleted: () => void;
}) {
	const queryClient = useQueryClient();
	const selection: Selection = picking ? selectionOf(picking, month, filters) : { ids: [] };
	const summary = useQuery(summaryQuery(selection, open && picking !== null));
	const remove = useMutation({
		mutationFn: () => deleteTransactions({ data: selection }),
		onSuccess: (result) => {
			toast(bulkDeletedMessage(result), {
				tone: "success",
				duration: 10_000,
				id: "transactions-deleted",
			});
			onDeleted();
		},
		onError: (error) => {
			toast(
				error instanceof Error && error.message.startsWith("Noodle couldn’t take a snapshot")
					? error.message
					: "Couldn’t delete them, so nothing has changed. Try again in a moment.",
				{ tone: "error" },
			);
		},
		// Everything that counts spending shows it at once: months, Buckets, Goals, Review, Accounts.
		onSettled: () => queryClient.invalidateQueries(),
	});
	const facts = summary.data;
	const count = facts?.count ?? 0;
	return (
		<Sheet open={open} onOpenChange={(next) => (next || remove.isPending ? undefined : onClose())}>
			<SheetContent>
				<SheetHeader
					title={
						facts && count > 0 ? `Delete ${transactionsCount(count)}?` : "Delete Transactions?"
					}
					description={SNAPSHOT_BEFORE_DELETE}
				/>
				{summary.isError ? (
					<p role="alert" className="text-sm">
						Couldn’t count what’s selected. Close this and try again.
					</p>
				) : !facts ? (
					<p role="status" className="text-sm text-muted-foreground">
						Counting what’s selected…
					</p>
				) : (
					<div className="grid gap-3 text-sm">
						{count === 0 ? <p>Nothing selected can be deleted here.</p> : null}
						<ul aria-label="What will be deleted" className="grid list-disc gap-1.5 ps-5">
							{deletionFacts(facts).map((fact) => (
								<li key={fact}>{fact}</li>
							))}
						</ul>
						<ul
							aria-label="What stays"
							className="grid list-disc gap-1.5 ps-5 text-muted-foreground"
						>
							{stayingFacts(facts).map((fact) => (
								<li key={fact}>{fact}</li>
							))}
						</ul>
					</div>
				)}
				<SheetFooter className="max-lg:grid-cols-2">
					<Button type="button" variant="ghost" disabled={remove.isPending} onClick={onClose}>
						Cancel
					</Button>
					<Button
						type="button"
						variant="destructive"
						disabled={count === 0 || remove.isPending}
						onClick={() => remove.mutate()}
					>
						<Trash2 />
						{remove.isPending ? "Deleting…" : `Delete ${transactionsCount(count)}`}
					</Button>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
