import type { DayKey, Plan } from "@noodle/domain";
import { Card } from "@noodle/ui/components/card";
import { DataTable } from "@noodle/ui/components/data-table";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { useNavigate } from "@tanstack/react-router";
import { type Ref, useMemo } from "react";
import { dayName, formatMoney } from "../format";
import type { MemberSummary } from "../members";
import { rowView } from "../transaction-row";
import { dayTotals, sortsByDate, tableSortOf, transactionSortOf } from "../transaction-table";
import type { TransactionRow, TransactionSort } from "../transactions";
import { type TransactionTableRow, transactionColumns } from "./transaction-columns";
import { waitingForBank } from "./transaction-list";

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
	checked,
	onEdit,
}: {
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
	/** While the list is selecting: whether a Transaction is selected. Left out otherwise. */
	checked: ((transaction: TransactionRow) => boolean) | undefined;
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
	const columns = transactionColumns({ dated: !byDate, open, checked, onEdit });
	return (
		// Clipped to the card's corners, so a row's hover and the open row's ground follow them.
		<Card className="overflow-clip">
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
				rowProps={({ transaction }, index) => ({
					"data-slot": "list-row",
					"data-index": index,
					"data-selected": checked?.(transaction) || undefined,
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
