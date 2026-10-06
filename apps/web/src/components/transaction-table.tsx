import type { DayKey, Plan } from "@noodle/domain";
import { Card } from "@noodle/ui/components/card";
import { DataTable } from "@noodle/ui/components/data-table";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { useNavigate } from "@tanstack/react-router";
import { type Ref, useMemo, useRef, useState } from "react";
import { dayName, formatMoney } from "../format";
import type { MemberSummary } from "../members";
import { cellEdits, refileOf, renameOf, undoOf } from "../transaction-cells";
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
import { dayTotals, sortsByDate, tableSortOf, transactionSortOf } from "../transaction-table";
import {
	monthOfTransaction,
	type TransactionChange,
	type TransactionRow,
	type TransactionSort,
	transactionLabel,
} from "../transactions";
import { NewBucketStep } from "./bucket-picker";
import type { CellEditing, CellEdits } from "./transaction-cells";
import { type TransactionTableRow, transactionColumns } from "./transaction-columns";
import { waitingForBank } from "./transaction-list";

/**
 * Whether the table's rows are stacked (a phone, or the narrow list beside an open Transaction):
 * no header and no checkbox column, so while selecting a tap on a row is what selects it.
 */
export function tableIsStacked(): boolean {
	const head = document.querySelector('[data-slot="data-table-head"]');
	return !head || head.getClientRects().length === 0;
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
	members,
	bringsIn,
	open,
	picking,
	onPick,
	onEdit,
	onChange,
}: {
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
	/** The Transaction open beside the table. */
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
	const choices = useMemo(
		() => [
			{
				label: "Buckets",
				choices: plan.buckets.map((b) => ({ value: `bucket:${b.id}`, label: b.name })),
			},
			...(plan.commitments.length > 0
				? [
						{
							label: "Commitments",
							choices: plan.commitments.map((c) => ({
								value: `commitment:${c.id}`,
								label: c.name,
							})),
						},
					]
				: []),
		],
		[plan],
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
	return (
		// Clipped to the card's corners, so a row's hover and the open row's ground follow them.
		<Card
			ref={card}
			className="overflow-clip"
			// F2 on a row in focus renames it (Enter opens it, Space selects it).
			onKeyDown={(event) => {
				if (event.key !== "F2" || tableIsStacked()) return;
				const id = (event.target as HTMLElement).closest<HTMLElement>("[data-transaction]")?.dataset
					.transaction;
				const transaction = transactions.find((t) => t.id === id);
				if (!transaction || cellEdits(transaction).name === null) return;
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
					buckets={plan.buckets}
					taken={[...plan.buckets, ...plan.commitments].map((item) => item.name)}
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
				})}
				groupBefore={
					byDate
						? ({ transaction }, previous) => {
								if (previous?.transaction.date === transaction.date) return null;
								const total = totals.get(transaction.date) ?? null;
								return (
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
