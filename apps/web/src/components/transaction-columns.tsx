import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import type { DataTableColumn } from "@noodle/ui/components/data-table";
import { Tile } from "@noodle/ui/components/tile";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@noodle/ui/components/tooltip";
import { cn } from "@noodle/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowLeftRight, Check, Sparkles, Split as SplitIcon, Target } from "lucide-react";
import { monogram } from "../buckets";
import { shortDay } from "../format";
import { cellEdits } from "../transaction-cells";
import type { RowView } from "../transaction-row";
import { editsInCell } from "../transaction-table";
import type { TransactionRow } from "../transactions";
import { AssignedCell, type CellEdits, NameEditor, RenameButton } from "./transaction-cells";

// The Transactions table's columns (issue 99): Date, Name, Assigned to, For, Account, Amount.
// The table drops For and then Account as its own width narrows, and on a phone stacks each row
// into the name over one line of detail, with the amount beside them.

/** A Transaction with what its row says (`rowView`), worked out once for all its cells. */
export type TransactionTableRow = { transaction: TransactionRow; view: RowView };

const pill = "h-4.5 px-1.5 text-[11px]";

/**
 * A Quick Add whose bank copy hasn't come in. Where the badge sits beside the name and the window
 * is under 1280px it is a dot with a tooltip, so the name keeps the room: whole, it cut the name
 * to three letters at 1024 (issue 120). The row's own label says it to a screen reader
 * ("waiting for the bank's copy"), and opening the row says it in words.
 */
export function WaitingForBankBadge() {
	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<Badge
						aria-hidden="true"
						dot
						className={cn(
							pill,
							"sm:max-xl:w-4.5 sm:max-xl:justify-center sm:max-xl:gap-0 sm:max-xl:px-0",
						)}
					>
						<span className="sm:max-xl:sr-only">Waiting for bank</span>
					</Badge>
				</TooltipTrigger>
				<TooltipContent className="max-sm:hidden xl:hidden">Waiting for bank</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
// A tile with no Bucket colour is the same grey as a selected or open row: there it takes the
// card's ground, so the square is still a square.
const plainTile = "[[data-selected]_&]:bg-card [[aria-current=true]_&]:bg-card";
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
	cells,
}: {
	/** Renaming in the cell (issue 99); left out where the list doesn't offer it. */
	cells: CellEdits | undefined;
	row: TransactionTableRow;
	/** A stacked row says its day too: the list isn't grouped by day. */
	dated: boolean;
	open: boolean;
	/** While the list is selecting: whether this one is selected. */
	checked: boolean | undefined;
	onEdit: (transaction: TransactionRow) => void;
}) {
	const picking = checked !== undefined && !transaction.goal;
	const renames = cells && cellEdits(transaction).name !== null ? cells : null;
	const renaming = renames?.editing?.id === transaction.id && renames.editing.column === "name";
	return (
		<span className="flex min-w-0 flex-1 items-center gap-3">
			{/* Stacked rows (a phone) have no checkbox column: while selecting, the tick rides on the
			    tile's corner, so the row keeps its place and the Bucket its colour (issue 115). */}
			<span className="relative flex shrink-0">
				{view.kind === "transfer" ? (
					<Tile aria-hidden="true" className={plainTile}>
						<ArrowLeftRight className="size-4" />
					</Tile>
				) : view.kind === "split" ? (
					<Tile aria-hidden="true" className={plainTile}>
						<SplitIcon className="size-4" />
					</Tile>
				) : (
					<Tile
						aria-hidden="true"
						bucket={view.assignment.color ?? undefined}
						className={view.assignment.color ? undefined : plainTile}
					>
						{view.kind === "goal" ? <Target /> : monogram(view.assignment.name)}
					</Tile>
				)}
				{picking ? (
					<span
						aria-hidden="true"
						data-slot="pick-mark"
						className={cn(
							"absolute -end-1 -bottom-1 grid size-4 place-items-center rounded-full border @2xl/dt:hidden",
							checked
								? "border-primary bg-primary text-primary-foreground"
								: "border-border-strong bg-card",
						)}
					>
						{checked ? <Check className="size-3" /> : null}
					</span>
				) : null}
			</span>
			{renames && renaming ? (
				<NameEditor
					transaction={transaction}
					title={view.title}
					onSave={(typed, byKey) => {
						renames.stop(byKey);
						renames.rename(transaction, typed);
					}}
					onCancel={() => renames.stop(true)}
				/>
			) : null}
			{/* The marks follow the name, or start the second line on phones so the name keeps its
			    room: one copy, placed by the grid. */}
			<span
				className={cn(
					"grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-center gap-y-0.5 sm:grid-cols-[minmax(0,max-content)_1fr]",
					renaming && "hidden",
				)}
			>
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
						aria-current={open ? "true" : undefined}
						// It opens in place, under its row (issue 99). Said on the button: a grid's row can't
						// take aria-expanded. Goal spending goes to its Goal instead.
						aria-expanded={transaction.goal ? undefined : open}
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
						<WaitingForBankBadge />
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
			{renames && !renaming ? (
				<RenameButton title={view.title} onClick={() => renames.start(transaction, "name")} />
			) : null}
		</span>
	);
}

const AZ = { asc: "A to Z", desc: "Z to A" };

export function transactionColumns({
	dated,
	open,
	checked,
	onEdit,
	cells,
}: {
	/** Renaming and refiling in the cell (issue 99). */
	cells?: CellEdits;
	dated: boolean;
	/** The Transaction open under its row: its cells do not edit in place, its editor is there. */
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
					cells={editsInCell(row.transaction.id, open) ? cells : undefined}
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
			// A row with one Bucket or none is refiled here; any other kind opens, as its row does.
			cell: ({ transaction, view }) =>
				cells && editsInCell(transaction.id, open) && cellEdits(transaction).refile ? (
					<AssignedCell
						transaction={transaction}
						title={view.title}
						assigned={view.assigned}
						cells={cells}
					/>
				) : (
					<span className="truncate">{view.assigned}</span>
				),
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
