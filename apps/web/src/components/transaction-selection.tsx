import type { MonthKey, Plan } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Sheet, SheetContent, SheetFooter, SheetHeader } from "@noodle/ui/components/sheet";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import type { InfiniteData } from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderInput, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { nothingToFileIn, pastPlanSentence } from "../before-plan";
import { monthName } from "../format";
import type { TransactionsPage } from "../server/transactions";
import {
	deleteTransactions,
	type FilingAnswer,
	fileTransactions,
	getDeletionSummary,
	undoFiling,
} from "../server/transactions";
import { refileOf } from "../transaction-cells";
import { rangeName } from "../transaction-range";
import {
	bulkDeletedMessage,
	canPick,
	deletionFacts,
	filedMessage,
	isPicked,
	matchingAll,
	type Picking,
	pickAll,
	pickedCount,
	SNAPSHOT_BEFORE_DELETE,
	selectAllLabel,
	selectionOf,
	stayingFacts,
	transactionsCount,
	unfiledMessage,
} from "../transaction-selection";
import {
	applyFiling,
	type TransactionFilters,
	transactionLabel,
	transactionsQuery,
} from "../transactions";
import { BucketPicker, NewBucketStep } from "./bucket-picker";
import { NoBuckets } from "./no-buckets";
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
	current,
	filters,
	filtered,
	picking,
	onPick,
	onDelete,
	onCancel,
	plan,
	onFiled,
}: {
	/** The month's Buckets and Commitments this Parent can file in: what "File in…" offers. */
	plan: Pick<Plan, "buckets" | "commitments">;
	/** "File in…" has filed the selection: the selecting is over. */
	onFiled: () => void;
	month: MonthKey;
	/** The month it is now: an earlier one's Plan is closed, so nothing is created in it. */
	current: MonthKey;
	filters: TransactionFilters;
	/** A filter or search is narrowing the list. */
	filtered: boolean;
	picking: Picking;
	onPick: (picking: Picking) => void;
	onDelete: () => void;
	onCancel: () => void;
}) {
	const stacked = useStackedRows();
	const queryClient = useQueryClient();
	// "File in…" (issue 99, ADR-0055): the Bucket picker a cell of the table uses, for everything
	// selected. One month only: a Transaction is filed in its own month's Plan.
	const [filing, setFiling] = useState(false);
	const [creating, setCreating] = useState<string | null>(null);
	const closed = pastPlanSentence(month, current);
	const choices = [
		{
			label: "Buckets",
			choices: plan.buckets.map((b) => ({ value: `bucket:${b.id}`, label: b.name })),
		},
		...(plan.commitments.length > 0
			? [
					{
						label: "Commitments",
						choices: plan.commitments.map((c) => ({ value: `commitment:${c.id}`, label: c.name })),
					},
				]
			: []),
	];
	/** The selected rows this screen has loaded: filed at once on screen, and sent with their versions. */
	const loadedPicked = () =>
		(
			queryClient.getQueryData<InfiniteData<TransactionsPage>>(
				transactionsQuery(month, filters).queryKey,
			)?.pages ?? []
		)
			.flatMap((page) => page.transactions)
			.filter((row) => canPick(row) && isPicked(picking, row.id));
	const file = useMutation({
		mutationFn: ({ value }: { value: string; name: string }) => {
			const [kind, id = ""] = value.split(":");
			return fileTransactions({
				data: {
					selection: selectionOf(picking, month, filters),
					month,
					assignment: kind === "commitment" ? { commitmentId: id } : { bucketId: id },
					versions: Object.fromEntries(
						loadedPicked()
							.slice(0, 1000)
							.map((row) => [row.id, row.version]),
					),
				},
			});
		},
		onMutate: async ({ value }) => ({
			rollback: await applyFiling(
				queryClient,
				month,
				loadedPicked().flatMap((transaction) => {
					const next = refileOf(transaction, value);
					return next ? [{ transaction, label: transactionLabel(transaction), next }] : [];
				}),
			),
		}),
		onError: (error, _to, context) => {
			context?.rollback();
			toast(
				error instanceof Error && error.message.startsWith("That isn’t in the Plan")
					? error.message
					: "Couldn’t file them, so nothing has changed. Try again in a moment.",
				{ tone: "error" },
			);
		},
		onSuccess: (result: FilingAnswer, { name }) => {
			const said = filedMessage(result, name);
			const put = async () => {
				try {
					const { restored } = await undoFiling({ data: { entries: result.undo } });
					toast(unfiledMessage(restored, result.undo.length));
				} catch {
					toast("Couldn’t undo that. They are still filed.", { tone: "error" });
				} finally {
					void queryClient.invalidateQueries();
				}
			};
			// With something filed the message carries its Undo, and stays as long as every Undo does.
			if (result.undo.length > 0) {
				toast(said, { tone: "success", id: "transactions-filed", undo: () => void put() });
			} else toast(said, { tone: "success", duration: 10_000, id: "transactions-filed" });
			onFiled();
		},
		// Everything that counts spending shows it: months, Buckets, Review.
		onSettled: () => queryClient.invalidateQueries(),
	});
	const inMonth = useQuery(summaryQuery({ all: matchingAll(month, filters, false) })).data?.count;
	const upToMonth = useQuery(summaryQuery({ all: matchingAll(month, filters, true) })).data?.count;
	const count = pickedCount(picking, picking.all?.andEarlier ? upToMonth : inMonth);
	// More than a month (issue 99): "all that match" is all in the range the list shows.
	const name = !filters.range
		? monthName(month)
		: filters.range === "all"
			? "every month"
			: rangeName(filters.range, month);
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
				{/* A phone: the three on the count's line, so the bar is no taller for "File in…": words
				    only, a little closer together. */}
				<div className="flex flex-wrap items-center gap-2 max-sm:gap-1 max-sm:[&>button]:px-2.5 max-sm:[&>button>svg]:hidden">
					<Button variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
					{filing ? (
						<BucketPicker
							defaultOpen
							value=""
							className="w-44 max-sm:w-36"
							placeholder="File in…"
							searchPlaceholder={closed ? "Find a Bucket" : "Search or create"}
							empty={closed ?? undefined}
							// A month before the first Plan (issue 117): why there is nothing to file in.
							none={
								nothingToFileIn(plan, month, current) ? (
									<NoBuckets month={month} current={current} />
								) : undefined
							}
							aria-label="File the selected Transactions in"
							choices={choices}
							onClose={() => setFiling(false)}
							onValueChange={(value) => {
								setFiling(false);
								const name = choices
									.flatMap((group) => group.choices)
									.find((choice) => choice.value === value)?.label;
								if (name) file.mutate({ value, name });
							}}
							onCreate={
								closed
									? undefined
									: (name) => {
											setFiling(false);
											setCreating(name);
										}
							}
						/>
					) : (
						<Button
							variant="outline"
							// Inside one month only: a Transaction is filed in its own month's Plan.
							disabled={
								!count || file.isPending || Boolean(picking.all?.andEarlier || filters.range)
							}
							title={
								filters.range
									? "Transactions are filed one month at a time: show This month to file these"
									: picking.all?.andEarlier
										? "Transactions are filed one month at a time"
										: undefined
							}
							onClick={() => setFiling(true)}
						>
							<FolderInput />
							{file.isPending ? "Filing…" : "File in…"}
						</Button>
					)}
					<Button variant="destructive" disabled={!count} onClick={onDelete}>
						<Trash2 />
						Delete
					</Button>
				</div>
			</div>
			{creating !== null ? (
				<NewBucketStep
					month={month}
					name={creating}
					what={transactionsCount(count ?? 0)}
					amountCents={loadedPicked().reduce((sum, row) => sum + Math.max(0, row.amountCents), 0)}
					buckets={plan.buckets}
					taken={[...plan.buckets, ...plan.commitments].map((item) => item.name)}
					onCancel={() => setCreating(null)}
					onCreated={(bucket) => {
						setCreating(null);
						file.mutate({ value: `bucket:${bucket.id}`, name: bucket.name });
					}}
				/>
			) : null}
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
