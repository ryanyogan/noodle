import type { DayKey, MonthKey, Plan } from "@noodle/domain";
import { Card } from "@noodle/ui/components/card";
import { DataTable } from "@noodle/ui/components/data-table";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { cn } from "@noodle/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, type Ref, useEffect, useMemo, useRef, useState } from "react";
import { dayName, formatMoney } from "../format";
import type { MemberSummary } from "../members";
import { cellEdits, refileOf, renameOf, undoOf } from "../transaction-cells";
import { monthHeading } from "../transaction-range";
import { rowView } from "../transaction-row";
import {
	canPick,
	headerCheckOf,
	isPicked,
	nothingPicked,
	type Picking,
	pickAll,
	setPicked,
} from "../transaction-selection";
import {
	dayTotals,
	openPlace,
	sortsByDate,
	tableSortOf,
	transactionSortOf,
} from "../transaction-table";
import {
	monthOfTransaction,
	type TransactionChange,
	type TransactionRow,
	type TransactionSort,
	transactionLabel,
	useAssignablePlan,
} from "../transactions";
import { NewBucketStep } from "./bucket-picker";
import type { CellEditing, CellEdits } from "./transaction-cells";
import { type TransactionTableRow, transactionColumns } from "./transaction-columns";
import { waitingForBank } from "./transaction-list";

/**
 * Whether the table's rows are stacked (a phone; from lg the table is always in columns): no header and no checkbox column, so while selecting a tap on a row is what selects it.
 */
export function tableIsStacked(): boolean {
	const head = document.querySelector('[data-slot="data-table-head"]');
	return !head || head.getClientRects().length === 0;
}

// What is hidden below lg while a Transaction is open at its address: there it is a page with
// Back, so the table's own rows and card go and only the open Transaction is left (issue 99).
const PAGE_BELOW_LG = cn(
	"max-lg:overflow-visible max-lg:rounded-none max-lg:border-0 max-lg:bg-transparent max-lg:shadow-none",
	"max-lg:[&_[data-slot=data-table-head]]:hidden max-lg:[&_[data-dt-row]]:hidden",
	"max-lg:[&_[data-slot=data-table-group]]:hidden max-lg:[&_[data-slot=data-table-more]]:hidden",
);

/**
 * The open Transaction, in the table (issue 99): a region named after it, directly under its row
 * and as wide as the table, on the open row's ground with its mark carried down the edge. Opening
 * one brings its row into view and puts focus on its title; a Transaction still loading has no
 * title yet, so the region takes focus and hands it on when the title arrives (as DetailPanel does).
 */
function OpenRegion({
	id,
	name,
	top,
	children,
}: {
	id: string;
	/** The Transaction's name, when its row is in the list. */
	name: string | undefined;
	/** Not under a row: the first thing in the table. */
	top: boolean;
	children: ReactNode;
}) {
	const ref = useRef<HTMLElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs again for each Transaction opened, and when it moves under its row
	useEffect(() => {
		const region = ref.current;
		// A phone shows it as a page, from the top, as before.
		if (!region || !window.matchMedia("(min-width: 1024px)").matches) return;
		const row = region
			.closest("[data-slot=data-table-expanded]")
			?.previousElementSibling?.closest<HTMLElement>("[data-transaction]");
		// The selection's bar stays at the foot of the window over the table: the editor is brought
		// into view above it, so its Delete, Cancel and Save are not under the bar.
		const bar = document.querySelector<HTMLElement>("[data-slot=selection-bar]");
		region.style.scrollMarginBottom = bar ? `${bar.offsetHeight + 32}px` : "";
		region.scrollIntoView({ block: "nearest" });
		(row ?? region).scrollIntoView({ block: "nearest" });
		if (region.contains(document.activeElement)) return;
		if (document.querySelector("[role=dialog],[role=alertdialog],[role=listbox],[role=menu]"))
			return;
		const find = () => region.querySelector<HTMLElement>("[data-slot=detail-title][tabindex]");
		const title = find();
		(title ?? region).focus({ preventScroll: true });
		if (title) return;
		const watch = new MutationObserver(() => {
			const arrived = find();
			if (!arrived) return;
			watch.disconnect();
			// Unless the Parent has moved on meanwhile.
			if (document.activeElement === region) arrived.focus({ preventScroll: true });
		});
		watch.observe(region, { childList: true, subtree: true });
		return () => watch.disconnect();
	}, [id, top]);
	return (
		<section
			ref={ref}
			tabIndex={-1}
			aria-label={name ?? "Transaction details"}
			data-slot="transaction-detail"
			data-open-place={top ? "top" : "row"}
			// No scroll of its own: an editor taller than the window flows with the page. Sized by its
			// own width, so the editor's two columns follow the table, not the window.
			className={cn(
				"@container min-w-0 scroll-mt-24 outline-none",
				"lg:bg-surface-2 lg:px-(--card-pad) lg:pt-3 lg:pb-5 lg:shadow-[inset_2px_0_0_var(--color-primary)]",
				top && "lg:border-b lg:border-border",
				// Under its row the header is one compact line: no Back (the row is right there, and
				// Close is at the end), a title the size of a row's heading.
				"lg:[&_[data-slot=detail-back]]:hidden lg:[&_[data-slot=detail-header]]:mb-3 lg:[&_[data-slot=detail-title]]:text-lg lg:[&_[data-slot=detail-eyebrow]]:hidden",
			)}
		>
			{children}
		</section>
	);
}

/**
 * The month's Transactions as a table (issue 99): real columns once it is wide enough, the same
 * rows stacked on a phone. The server orders and pages the rows and applies privacy; the table
 * draws what it is given, in that order, every loaded row in the page's flow (the page scrolls,
 * not the table). By date, rows group under their day with what the day spent.
 */
export function TransactionTable({
	label,
	transactions,
	more,
	moreRef,
	sort,
	onSort,
	today,
	plan,
	month,
	parentId,
	months = false,
	members,
	bringsIn,
	open,
	detail,
	picking,
	onPick,
	onEdit,
	onChange,
}: {
	/** The month `plan` is of: a row of another month is refiled in its own month's Plan. */
	month: MonthKey;
	parentId: string;
	/** The rows are of more than a month (issue 99): by date, each month starts under its name. */
	months?: boolean;
	/** The open Transaction's editor (the child route), drawn under its row. */
	detail?: ReactNode;
	/** A rename or refile made in a cell: sent with the page's other changes to Transactions. */
	onChange: (change: TransactionChange) => void;
	label: string;
	transactions: TransactionRow[];
	/** More rows to load: the last row is the mark that loads them. */
	more: boolean;
	moreRef: Ref<HTMLDivElement>;
	sort: TransactionSort;
	onSort: (sort: TransactionSort) => void;
	today: DayKey;
	plan: Pick<Plan, "buckets" | "commitments">;
	members: MemberSummary[];
	/** Whether the Household brings spending in from an Account (`useBringsSpendingIn`). */
	bringsIn: boolean;
	/** The Transaction open in the table, from the address. One at a time. */
	open: string | undefined;
	/** 97a's selection, which the checkboxes read and change; null when nothing is being selected. */
	picking: Picking | null;
	/** A tick, a range, or the header's checkbox: the selection as it should be now. */
	onPick: (next: Picking) => void;
	onEdit: (transaction: TransactionRow) => void;
}) {
	const navigate = useNavigate();
	const byDate = sortsByDate(sort);
	const rows = useMemo<TransactionTableRow[]>(
		() =>
			transactions.map((transaction) => ({
				transaction,
				view: rowView(transaction, plan, members, waitingForBank(transaction, today, bringsIn)),
			})),
		[transactions, plan, members, today, bringsIn],
	);
	const totals = useMemo(() => dayTotals(transactions, more), [transactions, more]);
	const selectable = useMemo(() => transactions.filter(canPick).length, [transactions]);
	const checked = picking
		? (transaction: TransactionRow) => canPick(transaction) && isPicked(picking, transaction.id)
		: undefined;
	// Editing in a cell (issue 99): one cell at a time, and only where the table shows columns.
	const card = useRef<HTMLDivElement>(null);
	const [editing, setEditing] = useState<CellEditing>(null);
	const [creating, setCreating] = useState<{ transaction: TransactionRow; name: string } | null>(
		null,
	);
	// The cell being edited may be in another month than the address's (a list of more than a
	// month): its picker offers its own month's Buckets, loaded when the cell opens.
	const cellRow =
		creating?.transaction ?? (editing ? transactions.find((t) => t.id === editing.id) : undefined);
	const cellMonth = cellRow ? monthOfTransaction(cellRow) : month;
	const otherPlan = useAssignablePlan(cellMonth, parentId, cellMonth !== month);
	const cellPlan = cellMonth === month ? plan : otherPlan;
	const choices = useMemo(
		() => [
			{
				label: "Buckets",
				choices: (cellPlan?.buckets ?? []).map((b) => ({
					value: `bucket:${b.id}`,
					label: b.name,
				})),
			},
			...(cellPlan && cellPlan.commitments.length > 0
				? [
						{
							label: "Commitments",
							choices: cellPlan.commitments.map((c) => ({
								value: `commitment:${c.id}`,
								label: c.name,
							})),
						},
					]
				: []),
		],
		[cellPlan],
	);
	const titleOf = (transaction: TransactionRow) =>
		rows.find((row) => row.transaction.id === transaction.id)?.view.title ?? "Transaction";
	const nameOfChoice = (value: string) =>
		choices.flatMap((group) => group.choices).find((c) => c.value === value)?.label;
	const refile = (transaction: TransactionRow, value: string, into = nameOfChoice(value)) => {
		const next = refileOf(transaction, value);
		if (!next) return;
		onChange({
			transaction,
			label: transactionLabel(transaction),
			next,
			said: `${titleOf(transaction)} filed in ${into ?? "its new Bucket"}`,
			back: undoOf(transaction, next),
		});
	};
	const cells: CellEdits = {
		editing,
		choices,
		start: (transaction, column) => setEditing({ id: transaction.id, column }),
		stop: (refocus) => {
			const was = editing;
			setEditing(null);
			// Ended from the keyboard: focus goes back to the cell's own button, once it is back.
			if (refocus && was) {
				requestAnimationFrame(() =>
					card.current
						?.querySelector<HTMLElement>(
							`[data-transaction="${was.id}"] [data-cell="${was.column}"]`,
						)
						?.focus(),
				);
			}
		},
		rename: (transaction, typed) => {
			const next = renameOf(transaction, typed);
			if (!next) return;
			onChange({
				transaction,
				label: transactionLabel(transaction),
				next,
				said: `Renamed to “${typed.trim()}”`,
				back: undoOf(transaction, next),
			});
		},
		refile,
		create: (transaction, name) => setCreating({ transaction, name }),
	};
	const columns = transactionColumns({ dated: !byDate, open, checked, onEdit, cells });
	const place = openPlace(open, transactions);
	const region = (id: string, name: string | undefined) => (
		<OpenRegion key={id} id={id} name={name} top={name === undefined}>
			{detail}
		</OpenRegion>
	);
	return (
		// Clipped to the card's corners, so a row's hover and the open row's ground follow them.
		<Card
			ref={card}
			className={cn("overflow-clip", open && PAGE_BELOW_LG)}
			// F2 on a row in focus renames it (Enter opens it, Space selects it).
			onKeyDown={(event) => {
				if (event.key !== "F2" || tableIsStacked()) return;
				const id = (event.target as HTMLElement).closest<HTMLElement>("[data-transaction]")?.dataset
					.transaction;
				const transaction = transactions.find((t) => t.id === id);
				// The open row is renamed in its editor, right under it.
				if (!transaction || transaction.id === open) return;
				if (cellEdits(transaction).name === null) return;
				event.preventDefault();
				setEditing({ id: transaction.id, column: "name" });
			}}
		>
			{creating ? (
				<NewBucketStep
					month={monthOfTransaction(creating.transaction)}
					name={creating.name}
					what={titleOf(creating.transaction)}
					amountCents={creating.transaction.amountCents}
					buckets={(cellPlan ?? plan).buckets}
					taken={[...(cellPlan ?? plan).buckets, ...(cellPlan ?? plan).commitments].map(
						(item) => item.name,
					)}
					onCancel={() => setCreating(null)}
					onCreated={(bucket) => {
						setCreating(null);
						refile(creating.transaction, `bucket:${bucket.id}`, bucket.name);
					}}
				/>
			) : null}
			<DataTable
				label={label}
				columns={columns}
				data={rows}
				getRowId={(row) => row.transaction.id}
				surface="card"
				// The page scrolls and has its own bar at the top: the header goes with its rows.
				stickyHeader={false}
				sort={tableSortOf(sort)}
				onSortChange={(next) => onSort(transactionSortOf(next))}
				// Goal spending only changes on its Goal's page.
				onOpen={({ transaction }) =>
					transaction.goal
						? void navigate({ to: "/goals/$goalId", params: { goalId: transaction.goal.id } })
						: onEdit(transaction)
				}
				isOpen={(row) => row.transaction.id === open}
				rowAfter={
					place === "row"
						? ({ transaction, view }) =>
								transaction.id === open ? region(transaction.id, view.title) : null
						: undefined
				}
				// Further down the list, or left out by the filters: its address still shows it.
				top={place === "top" && open ? region(open, undefined) : undefined}
				// The checkbox column, Space, Shift+arrows and Ctrl+A over 97a's selection. The table
				// keeps none of its own: "all that match, except these" covers rows not loaded yet.
				selection={{
					isSelected: ({ transaction }) => checked?.(transaction) ?? false,
					canSelect: ({ transaction }) => canPick(transaction),
					rowLabel: ({ transaction, view }) =>
						canPick(transaction)
							? `Select ${view.title}, ${view.amount}`
							: `${view.title} is Goal spending and can’t be selected: it changes from its Goal`,
					all: headerCheckOf(picking, more ? undefined : selectable),
					allLabel: `Select all ${label}`,
					onSelect: ({ ids, on }) => onPick(setPicked(picking ?? nothingPicked, ids, on)),
					onSelectAll: (on) => onPick(on ? pickAll(false) : nothingPicked),
					// A phone selects from the Select button, by tapping rows.
					stacked: false,
				}}
				rowProps={(_row, index) => ({
					"data-slot": "list-row",
					"data-index": index,
					"data-transaction": _row.transaction.id,
					// Under the page's bar when it is brought into view.
					className: "scroll-mt-24",
				})}
				groupBefore={
					byDate
						? ({ transaction }, previous) => {
								if (previous?.transaction.date === transaction.date) return null;
								const total = totals.get(transaction.date) ?? null;
								const itsMonth = transaction.date.slice(0, 7);
								const newMonth = months && previous?.transaction.date.slice(0, 7) !== itsMonth;
								return (
									<>
										{newMonth ? (
											<div
												data-slot="list-month-label"
												className={cn(
													"pb-0.5 text-sm font-semibold text-foreground",
													previous ? "pt-5" : "pt-3",
												)}
											>
												{monthHeading(itsMonth)}
											</div>
										) : null}
										<div
											data-slot="list-group-label"
											className="flex items-baseline justify-between gap-3 pt-2.5 pb-1.5 text-xs font-medium text-subtle-foreground"
										>
											<span>{dayName(transaction.date, today)}</span>
											{total !== null ? (
												<span className="tabular-nums">
													<span className="sr-only">Spent </span>
													{formatMoney(total)}
												</span>
											) : null}
										</div>
									</>
								);
							}
						: undefined
				}
				more={
					more ? (
						<div ref={moreRef} data-loading-more>
							<span role="status" className="sr-only">
								Loading more Transactions…
							</span>
							<div aria-hidden="true" className="flex items-center gap-3 py-1.5">
								<Skeleton className="size-9 rounded-xl" />
								<div className="grid flex-1 gap-2">
									<Skeleton className="h-3.5 w-1/3" />
									<Skeleton className="h-3 w-1/2" />
								</div>
							</div>
						</div>
					) : null
				}
			/>
		</Card>
	);
}
