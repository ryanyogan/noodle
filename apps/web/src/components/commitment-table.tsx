import {
	type CommitmentState,
	type MonthKey,
	monthlyEquivalent,
	nextDueDate,
	paymentsView,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { DataTable, type DataTableColumn } from "@noodle/ui/components/data-table";
import { useHydrated, useNavigate, useParams } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { cadenceNames } from "../commitments";
import { formatMoney, fullDay, monthName, shortDay } from "../format";
import { usePlanChanges } from "../plan-changes";
import { type CommitmentChanges, CommitmentSheet, PaidState } from "./commitment-editor";
import { AboutNote, CommitmentLink } from "./commitment-list";
import { PaysDownNote } from "./pays-down";
import { ChangedNote } from "./plan-scope-field";

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
			min: 10,
			width: "minmax(0,2fr)",
			stacked: "title",
			cell: (c) => (
				<div className="grid gap-1">
					<CommitmentLink month={month} commitment={c} />
					<span className="text-xs font-normal text-muted-foreground">
						{c.about ? <AboutNote commitment={c} /> : formatMoney(c.amount)} ·{" "}
						{cadenceNames[c.cadence]}
					</span>
					{c.accountId ? <PaysDownNote accountId={c.accountId} /> : null}
					<ChangedNote was={previous.commitments[c.id]} />
				</div>
			),
			footer: "Total",
		},
		{
			id: "schedule",
			header: "Due date",
			min: 7,
			width: "minmax(0,1fr)",
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
			width: "minmax(0,1fr)",
			align: "end",
			stacked: "value",
			cell: (c) => (
				<span className="font-medium tabular-nums">
					{formatMoney(c.expected)}
					<span className="@2xl/dt:hidden text-xs font-normal text-muted-foreground"> due</span>
				</span>
			),
			footer: formatMoney(commitments.reduce((sum, c) => sum + c.expected, 0)),
		},
		{
			id: "paid",
			header: "Paid",
			min: 6,
			width: "minmax(0,1fr)",
			align: "end",
			priority: 1,
			stacked: "hidden",
			cell: (c) => formatMoney(paymentsView(c).actual),
			footer: formatMoney(commitments.reduce((sum, c) => sum + paymentsView(c).actual, 0)),
		},
		{
			id: "status",
			header: "Status",
			min: 9,
			width: "minmax(0,1.5fr)",
			stacked: "secondary",
			cell: (c) => (
				<div className="grid gap-1">
					<PaidState commitment={c} />
					{c.dueDates.length === 0 ? (
						<span className="text-xs text-muted-foreground @2xl/dt:hidden">
							Next {fullDay(nextDueDate(c, `${month}-01`))}
						</span>
					) : null}
					<span className="text-xs text-muted-foreground @2xl/dt:hidden">
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
			min: 2.75,
			width: "2.75rem",
			stacked: "trailing",
			hidden: !editable,
			cell: (c) => (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					disabled={!hydrated}
					aria-label={`Edit ${c.name}`}
					onClick={() => setEditing(c.id)}
				>
					<Pencil />
				</Button>
			),
		},
	];
	return (
		<>
			<DataTable
				label={`Commitments in ${monthName(month)}`}
				columns={columns}
				data={commitments}
				getRowId={(c) => c.id}
				isOpen={(c) => c.id === picked}
				onOpen={(c) =>
					void navigate({
						to: "/plan/$month/commitments/$id",
						params: { month, id: c.id },
						resetScroll: false,
					})
				}
			/>
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
