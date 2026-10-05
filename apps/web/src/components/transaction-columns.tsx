import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import type { DataTableColumn } from "@noodle/ui/components/data-table";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, Check, Sparkles, Split as SplitIcon, Target } from "lucide-react";
import { monogram } from "../buckets";
import { shortDay } from "../format";
import type { RowView } from "../transaction-row";
import type { TransactionRow } from "../transactions";

// The Transactions table's columns (issue 99): Date, Name, Assigned to, For, Account, Amount.
// The table drops For and then Account as its own width narrows, and on a phone stacks each row
// into the name over one line of detail, with the amount beside them.

/** A Transaction with what its row says (`rowView`), worked out once for all its cells. */
export type TransactionTableRow = { transaction: TransactionRow; view: RowView };

const pill = "h-4.5 px-1.5 text-[11px]";
// The name is the row's control: as small as its words, so the row around it stays a row.
const nameControl =
	"col-span-2 h-auto min-h-6 max-w-full min-w-0 justify-start justify-self-start rounded-sm p-0 text-start text-sm font-medium hover:bg-transparent sm:col-span-1";

/**
 * The tile, the name (the control that opens the row, saying everything the row says), its
 * marks, and under it the line a stacked row shows instead of columns.
 */
function NameCell({
	row: { transaction, view },
	dated,
	open,
	checked,
	onEdit,
}: {
	row: TransactionTableRow;
	/** A stacked row says its day too: the list isn't grouped by day. */
	dated: boolean;
	open: boolean;
	/** While the list is selecting: whether this one is selected. */
	checked: boolean | undefined;
	onEdit: (transaction: TransactionRow) => void;
}) {
	const picking = checked !== undefined && !transaction.goal;
	return (
		<span className="flex min-w-0 flex-1 items-center gap-3">
			{picking ? (
				<span
					aria-hidden="true"
					data-slot="pick-mark"
					className={cn(
						"grid size-5 shrink-0 place-items-center rounded-md border",
						checked
							? "border-primary bg-primary text-primary-foreground"
							: "border-border-strong bg-card",
					)}
				>
					{checked ? <Check className="size-3.5" /> : null}
				</span>
			) : null}
			{view.kind === "transfer" ? (
				<Tile aria-hidden="true">
					<ArrowLeftRight className="size-4" />
				</Tile>
			) : view.kind === "split" ? (
				<Tile aria-hidden="true">
					<SplitIcon className="size-4" />
				</Tile>
			) : (
				<Tile aria-hidden="true" bucket={view.assignment.color ?? undefined}>
					{view.kind === "goal" ? <Target /> : monogram(view.assignment.name)}
				</Tile>
			)}
			{/* The marks follow the name, or start the second line on phones so the name keeps its
			    room: one copy, placed by the grid. */}
			<span className="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-y-0.5 sm:grid-cols-[minmax(0,max-content)_1fr]">
				{transaction.goal ? (
					<Button asChild variant="ghost" size="sm" className={nameControl}>
						<Link
							to="/goals/$goalId"
							params={{ goalId: transaction.goal.id }}
							aria-label={view.label}
						>
							<span className="truncate">{view.title}</span>
						</Link>
					</Button>
				) : (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className={nameControl}
						aria-label={view.label}
						aria-pressed={picking ? checked : undefined}
						aria-current={open ? "true" : undefined}
						onClick={() => onEdit(transaction)}
					>
						<span className="truncate">{view.title}</span>
					</Button>
				)}
				<span className="peer/badges col-start-1 row-start-2 me-1.5 flex shrink-0 items-center gap-1.5 empty:hidden sm:col-start-2 sm:row-start-1 sm:ms-1.5 sm:me-0">
					{view.pending ? (
						<Badge aria-hidden="true" dot className={pill}>
							Pending
						</Badge>
					) : null}
					{view.autoFiled ? (
						<Badge aria-hidden="true" className={pill}>
							<Sparkles />
							Auto
						</Badge>
					) : null}
					{view.matched ? (
						<Badge aria-hidden="true" variant="brand" className={pill}>
							Matched
						</Badge>
					) : view.waiting ? (
						<Badge aria-hidden="true" dot className={pill}>
							Waiting for bank
						</Badge>
					) : null}
				</span>
				{/* The columns say this line's parts apart once the table is wide enough for them. */}
				<span
					aria-hidden="true"
					className={cn(
						"col-start-2 row-start-2 truncate text-[13px] font-normal text-muted-foreground sm:col-span-2 sm:col-start-1 @2xl/dt:hidden",
						// On the narrowest phones the marks get the second line and the detail a third.
						"max-[389px]:peer-[:not(:empty)]/badges:col-span-2 max-[389px]:peer-[:not(:empty)]/badges:col-start-1 max-[389px]:peer-[:not(:empty)]/badges:row-start-3",
					)}
				>
					{dated ? `${shortDay(transaction.date)} · ` : ""}
					{view.detail}
				</span>
			</span>
		</span>
	);
}

const AZ = { asc: "A to Z", desc: "Z to A" };

export function transactionColumns({
	dated,
	open,
	checked,
	onEdit,
}: {
	dated: boolean;
	/** The Transaction open beside the table. */
	open: string | undefined;
	/** While the list is selecting: whether a Transaction is selected. Left out otherwise. */
	checked: ((transaction: TransactionRow) => boolean) | undefined;
	onEdit: (transaction: TransactionRow) => void;
}): DataTableColumn<TransactionTableRow>[] {
	return [
		{
			id: "date",
			header: "Date",
			min: 4.5,
			width: "4.5rem",
			stacked: "hidden",
			sortable: { descFirst: true, said: { asc: "oldest first", desc: "newest first" } },
			className: "text-muted-foreground tabular-nums",
			cell: ({ transaction }) => shortDay(transaction.date),
		},
		{
			id: "name",
			header: "Name",
			min: 14,
			width: "minmax(0,2fr)",
			stacked: "title",
			sortable: { said: AZ },
			cell: (row) => (
				<NameCell
					row={row}
					dated={dated}
					open={row.transaction.id === open}
					checked={checked?.(row.transaction)}
					onEdit={onEdit}
				/>
			),
		},
		{
			id: "assigned",
			header: "Assigned to",
			min: 9,
			width: "minmax(0,1.3fr)",
			stacked: "hidden",
			sortable: { said: AZ },
			cell: ({ view }) => <span className="truncate">{view.assigned}</span>,
		},
		{
			id: "for",
			header: "For",
			min: 5,
			width: "minmax(4.5rem,0.8fr)",
			priority: 3,
			stacked: "hidden",
			className: "text-muted-foreground",
			cell: ({ view }) => <span className="truncate">{view.who}</span>,
		},
		{
			id: "account",
			header: "Account",
			min: 9,
			width: "minmax(0,1.3fr)",
			priority: 2,
			stacked: "hidden",
			sortable: { said: AZ },
			className: "text-muted-foreground",
			// A narrow column shortens the name, never the last four digits.
			cell: ({ view }) => (
				<>
					<span className="truncate">{view.accountName}</span>
					{view.accountDigits ? (
						<span className="shrink-0 whitespace-pre">{view.accountDigits}</span>
					) : null}
				</>
			),
		},
		{
			id: "amount",
			header: "Amount",
			min: 6,
			width: "6rem",
			align: "end",
			stacked: "value",
			sortable: { descFirst: true, said: { asc: "smallest first", desc: "largest first" } },
			className: "font-semibold",
			cell: ({ view }) => view.amount,
		},
	];
}
