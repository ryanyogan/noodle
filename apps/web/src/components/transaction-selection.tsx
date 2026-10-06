import type { MonthKey } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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
	selectAllLabel,
	selectionOf,
	stayingFacts,
	transactionsCount,
} from "../transaction-selection";
import type { TransactionFilters } from "../transactions";
import { tableIsStacked } from "./transaction-table";

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
/**
 * Whether the table's rows are stacked right now: null until it has been looked at. Follows the
 * table's own width, which changes when a Transaction opens beside it, not only with the window.
 */
function useStackedRows() {
	const [stacked, setStacked] = useState<boolean | null>(null);
	useEffect(() => {
		const measure = () => setStacked(tableIsStacked());
		measure();
		const table = document.querySelector('[data-slot="data-table"]');
		const watch = table ? new ResizeObserver(measure) : null;
		if (table) watch?.observe(table);
		window.addEventListener("resize", measure);
		return () => {
			watch?.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);
	return stacked;
}

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
	const stacked = useStackedRows();
	const inMonth = useQuery(summaryQuery({ all: matchingAll(month, filters, false) })).data?.count;
	const upToMonth = useQuery(summaryQuery({ all: matchingAll(month, filters, true) })).data?.count;
	const count = pickedCount(picking, picking.all?.andEarlier ? upToMonth : inMonth);
	const name = monthName(month);
	const offerMonth =
		inMonth !== undefined && inMonth > 0 && !(picking.all && !picking.all.andEarlier);
	const offerEarlier =
		upToMonth !== undefined && upToMonth > (inMonth ?? 0) && !picking.all?.andEarlier;
	// On a phone the two share a line.
	const everything = "max-sm:min-w-0 max-sm:flex-1 max-sm:justify-center max-sm:text-center";
	return (
		<section
			aria-label="Selecting Transactions"
			data-slot="selection-bar"
			// Over the list on a phone. From lg it sits under the table and stays at the foot of the
			// window, so the first tick doesn't push the rows down from under the pointer.
			className="sticky top-2 z-20 grid gap-2 rounded-2xl border border-border-strong bg-card p-3 shadow-sm max-sm:gap-1.5 max-sm:p-2.5 lg:top-auto lg:bottom-4 lg:order-last"
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
			{offerMonth || offerEarlier ? (
				// A phone: the two side by side in few words, not two full-width lines (issue 115).
				<div className="flex gap-2 sm:flex-wrap">
					{offerMonth ? (
						<Button
							variant="outline"
							size="wrap"
							className={everything}
							onClick={() => onPick(pickAll(false))}
						>
							<span className="sm:hidden">
								{selectAllLabel(inMonth ?? 0, name, { filtered, andEarlier: false, short: true })}
							</span>
							<span className="max-sm:hidden">
								{selectAllLabel(inMonth ?? 0, name, { filtered, andEarlier: false })}
							</span>
						</Button>
					) : null}
					{offerEarlier ? (
						<Button
							variant="outline"
							size="wrap"
							className={everything}
							onClick={() => onPick(pickAll(true))}
						>
							<span className="sm:hidden">
								{selectAllLabel(upToMonth ?? 0, name, { filtered, andEarlier: true, short: true })}
							</span>
							<span className="max-sm:hidden">
								{selectAllLabel(upToMonth ?? 0, name, { filtered, andEarlier: true })}
							</span>
						</Button>
					) : null}
				</div>
			) : null}
			{/* Which help: by how the rows are drawn once that is known (stacked beside an open
			    Transaction even on a wide window), by the window's width until then. */}
			<p
				className={cn(
					"text-xs text-muted-foreground",
					stacked === null ? "lg:hidden" : !stacked && "hidden",
				)}
			>
				Tap a row to select it. Goal spending can’t be selected.
			</p>
			<p
				className={cn(
					"text-xs text-muted-foreground",
					stacked === null ? "max-lg:hidden" : stacked && "hidden",
				)}
			>
				Tick Transactions to select them; hold Shift to take a run of rows. Goal spending can’t be
				selected: it changes from its Goal.
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
