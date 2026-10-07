import {
	type CommitmentState,
	type MonthKey,
	monthlyEquivalent,
	nextDueDate,
	paymentsView,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { DataTable, type DataTableColumn } from "@noodle/ui/components/data-table";
import { Tile } from "@noodle/ui/components/tile";
import { useHydrated, useNavigate, useParams } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { monogram } from "../buckets";
import { cadenceNames } from "../commitments";
import { formatMoney, fullDay, monthName, shortDay } from "../format";
import { usePlanChanges } from "../plan-changes";
import { type CommitmentChanges, CommitmentSheet, PaidState } from "./commitment-editor";
import { AboutNote, CommitmentLink } from "./commitment-list";
import { PaysDownNote } from "./pays-down";
import { ChangedNote } from "./plan-scope-field";

/**
 * In a stacked row (a phone) the lines under the name start with the name, past the letter tile
 * (36px) and its gap, as the Buckets table's do. Not under 16rem (text twice its size), where the
 * tile is gone (`NO_TILE`).
 */
const UNDER_NAME = "@max-2xl/dt:ps-12 @max-[16rem]/dt:ps-0";
const NO_TILE = "@max-[16rem]/dt:hidden";

/**
 * A month's Commitments as a table (issue 146: drawn as the Plan's Buckets table is). On a Card,
 * each row with its letter tile, the figures in fixed columns at the end of the name's, the
 * quieter lines at 13px, and the pencil that opens the Commitment sheet in the last column.
 */
export function CommitmentTable({
	month,
	commitments,
	editable,
	changes,
}: {
	month: MonthKey;
	commitments: CommitmentState[];
	editable: boolean;
	changes: CommitmentChanges;
}) {
	const hydrated = useHydrated();
	const previous = usePlanChanges(month);
	const navigate = useNavigate();
	const picked = useParams({ strict: false, select: (params) => params.id });
	const [editing, setEditing] = useState<string | null>(null);
	const open = commitments.find((c) => c.id === editing);
	const columns: DataTableColumn<CommitmentState>[] = [
		{
			id: "name",
			header: "Commitment",
			// As the Buckets table's first column: a name reads beside its tile.
			min: 12,
			width: "minmax(0,2fr)",
			stacked: "title",
			cell: (c) => (
				<div className="flex min-w-0 items-center gap-3">
					<Tile className={NO_TILE}>{monogram(c.name)}</Tile>
					<div className="grid min-w-0 gap-0.5">
						<span className="min-w-0 font-medium wrap-anywhere">
							<CommitmentLink month={month} commitment={c} />
						</span>
						<span className="text-[13px] font-normal text-muted-foreground tabular-nums">
							{c.about ? <AboutNote commitment={c} /> : formatMoney(c.amount)} ·{" "}
							{cadenceNames[c.cadence]}
						</span>
						{c.accountId ? <PaysDownNote accountId={c.accountId} /> : null}
						<ChangedNote was={previous.commitments[c.id]} />
					</div>
				</div>
			),
			footer: "Total",
		},
		{
			id: "schedule",
			header: "Due date",
			min: 7,
			width: "7rem",
			priority: 2,
			stacked: "hidden",
			cell: (c) => (
				<span className="text-muted-foreground">
					{c.dueDates.length
						? c.dueDates.map(shortDay).join(", ")
						: `Next ${fullDay(nextDueDate(c, `${month}-01`))}`}
				</span>
			),
		},
		{
			id: "expected",
			header: "Expected",
			min: 6,
			width: "6rem",
			align: "end",
			stacked: "value",
			cell: (c) => (
				<span className="font-medium tabular-nums">
					{formatMoney(c.expected)}
					<span className="@2xl/dt:hidden text-[13px] font-normal text-muted-foreground"> due</span>
				</span>
			),
			footer: formatMoney(commitments.reduce((sum, c) => sum + c.expected, 0)),
		},
		{
			id: "paid",
			header: "Paid",
			min: 6,
			width: "6rem",
			align: "end",
			priority: 1,
			stacked: "hidden",
			// The quieter figure beside Expected, as Spent is beside a Bucket's allowance.
			className: "text-muted-foreground",
			cell: (c) => formatMoney(paymentsView(c).actual),
			footer: formatMoney(commitments.reduce((sum, c) => sum + paymentsView(c).actual, 0)),
		},
		{
			id: "status",
			header: "Status",
			min: 9,
			width: "minmax(0,1.5fr)",
			stacked: "secondary",
			// Clear of the figure before it, which ends where this column begins.
			headerClassName: "ps-4",
			cell: (c) => (
				<div className={`grid min-w-0 gap-1 @2xl/dt:ps-4 ${UNDER_NAME}`}>
					<PaidState commitment={c} />
					{c.dueDates.length === 0 ? (
						<span className="text-[13px] text-muted-foreground tabular-nums @2xl/dt:hidden">
							Next {fullDay(nextDueDate(c, `${month}-01`))}
						</span>
					) : null}
					<span className="text-[13px] text-muted-foreground tabular-nums @2xl/dt:hidden">
						{formatMoney(paymentsView(c).actual)} paid · {formatMoney(monthlyEquivalent(c))}/mo
						average
					</span>
				</div>
			),
		},
		{
			id: "edit",
			header: "Edit",
			headerHidden: true,
			min: 2.25,
			width: "2.25rem",
			align: "end",
			stacked: "trailing",
			hidden: !editable,
			cell: (c) => (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					disabled={!hydrated}
					aria-label={`Edit ${c.name}`}
					aria-haspopup="dialog"
					onClick={() => setEditing(c.id)}
				>
					<Pencil />
				</Button>
			),
		},
	];
	return (
		<>
			{/* Clipped to the card's corners, so a row's hover and the open row's ground follow them. */}
			<Card className="overflow-clip">
				<DataTable
					label={`Commitments in ${monthName(month)}`}
					columns={columns}
					data={commitments}
					getRowId={(c) => c.id}
					surface="card"
					// A short list on a card: the header scrolls with its rows.
					stickyHeader={false}
					isOpen={(c) => c.id === picked}
					onOpen={(c) =>
						void navigate({
							to: "/plan/$month/commitments/$id",
							params: { month, id: c.id },
							resetScroll: false,
						})
					}
				/>
			</Card>
			{open ? (
				<CommitmentSheet
					month={month}
					commitment={open}
					open
					onOpenChange={(value) => {
						if (!value) setEditing(null);
					}}
					changes={changes}
				/>
			) : null}
		</>
	);
}
