import { looksPersonToPerson } from "@noodle/domain";
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
import {
	ArrowDownLeft,
	ArrowLeftRight,
	Check,
	ChevronRight,
	Clock,
	Sparkles,
	Split as SplitIcon,
	Target,
} from "lucide-react";
import type { ReactNode } from "react";
import { BANK_TOOK_BACK_WORD } from "../bank-took-back";
import { monogram } from "../buckets";
import { askCardPayment } from "../card-payments";
import { shortDay } from "../format";
import { cellEdits, forEdits } from "../transaction-cells";
import { FOR_DIFFERS, PENDING_MEANS, type RowView } from "../transaction-row";
import { editsInCell } from "../transaction-table";
import type { TransactionRow } from "../transactions";
import {
	AssignedCell,
	type CellEdits,
	ForCell,
	NameEditor,
	RenameButton,
	RowMenu,
} from "./transaction-cells";

// The Transactions table's columns (issue 99): Date, Name, Assigned to, For, Account, Amount.
// The table drops For and then Account as its own width narrows, and on a phone stacks each row
// into the name over one line of detail, with the amount beside them.

/** A Transaction with what its row says (`rowView`), worked out once for all its cells. */
export type TransactionTableRow = { transaction: TransactionRow; view: RowView };

const pill = "h-4.5 px-1.5 text-[11px]";

/** What the For column says for FOR_DIFFERS: short enough to fit it at its narrowest. */
const FOR_DIFFERS_SHORT = "Differs by Split";

/**
 * A Quick Add whose bank copy hasn't come in. Where the badge sits beside the name and the window
 * is under 1536px it is a dot with a tooltip, so the name keeps the room: whole, it cut the name
 * to three letters at 1024 (issue 120) and a 15-letter one by 27, 42 and 14px at 1280, 1366 and
 * 1440 (issue 121). The row's own label says it to a screen reader
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
							"sm:max-2xl:w-4.5 sm:max-2xl:justify-center sm:max-2xl:gap-0 sm:max-2xl:px-0",
						)}
					>
						<span className="sm:max-2xl:sr-only">Waiting for bank</span>
					</Badge>
				</TooltipTrigger>
				<TooltipContent className="max-sm:hidden 2xl:hidden">Waiting for bank</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
/** What the Auto and Pending marks say: their names, and their tooltips. */
export const AUTO_MARK = "Filed automatically";
export const AUTO_MARK_MEANS =
	"Filed automatically, as a best guess. Open it to check or change it.";
export const PENDING_MARK = "Pending";
export const PENDING_MARK_MEANS = PENDING_MEANS;

/**
 * A small mark after a row's name (issue 147): an icon with its name for a screen reader and what
 * it means in a tooltip, on hover and on keyboard focus. A press on it is a press on its row, so
 * on a phone (no hover) it opens the row, which says the same in words.
 */
function Mark({ name, means, children }: { name: string; means: string; children: ReactNode }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					role="img"
					aria-label={name}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: focus is how a keyboard reads its tooltip
					tabIndex={0}
					data-slot="row-mark"
					className="grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
				>
					{children}
				</span>
			</TooltipTrigger>
			<TooltipContent>{means}</TooltipContent>
		</Tooltip>
	);
}

const ink = "min-w-0 truncate text-foreground";

/**
 * What a row was for, the second thing it says after its name (issue 147): the Bucket, Commitment
 * or Goal in ink (a Bucket with a dot of its colour in the column, where its tile is far away),
 * the kind where it isn't spending, or "Needs review". Drawn for the eye: the row's label says it
 * all in words. `stacked` is the line under the name on a phone, where the row's badges have
 * already said the kind.
 */
function What({ view, stacked = false }: { view: RowView; stacked?: boolean }) {
	const dot =
		!stacked && view.assignment.color ? (
			<span
				aria-hidden="true"
				data-slot="bucket-dot"
				className="size-2 shrink-0 rounded-full bg-(--tile)"
				style={{ ["--tile" as string]: `var(--bucket-${view.assignment.color})` }}
			/>
		) : null;
	const kind =
		!stacked && view.kindWord ? (
			<Badge data-slot="row-kind-column" className={pill}>
				{view.kindWord}
			</Badge>
		) : null;
	// Money into an Account (issue 152): its kind is all there is to say, or that it waits.
	if (view.kindOnly)
		return view.needsReview ? (
			<Badge dot variant="pace" data-slot="needs-review" className={pill}>
				Needs review
			</Badge>
		) : (
			<>
				{kind}
				{/* A paycheck listed on the day it landed: the pay day it counts on (ADR-0063). */}
				{!stacked && view.payFor ? (
					<span data-slot="row-pay-for" className="min-w-0 truncate text-muted-foreground">
						{view.payFor}
					</span>
				) : null}
			</>
		);
	if (view.kind === "goal")
		return (
			<>
				<span className={ink}>{view.assignment.name}</span>
				<span className="shrink-0">Goal</span>
			</>
		);
	if (view.kind === "transfer")
		return (
			<>
				{kind}
				{view.route ? <span className="min-w-0 truncate">{view.route}</span> : null}
			</>
		);
	if (view.kindWord)
		return (
			<>
				{kind}
				{dot}
				<span className={ink}>{view.assignment.name}</span>
			</>
		);
	if (view.moneyIn) return <span className={ink}>Money back</span>;
	if (view.kind === "split") {
		// Two names, each shortened only as far as it must be, and how many more: never "…" alone.
		const shown = view.splitNames.slice(0, 2);
		const more = view.splitNames.length - shown.length;
		return (
			<>
				{/* A stacked row's tile says it is split; the column has no tile beside it. */}
				{stacked ? null : <span className="shrink-0">Split ·</span>}
				{shown.map((name, index) => (
					<span key={name} className={ink}>
						{name}
						{index < shown.length - 1 ? "," : ""}
					</span>
				))}
				{more > 0 ? <span className="shrink-0 text-foreground">+{more}</span> : null}
			</>
		);
	}
	if (view.needsReview)
		return (
			<Badge dot variant="pace" data-slot="needs-review" className={pill}>
				Needs review
			</Badge>
		);
	return (
		<>
			{dot}
			<span className={view.assignment.name === "Unassigned" ? "min-w-0 truncate" : ink}>
				{view.assignment.name}
			</span>
		</>
	);
}

// A tile with no Bucket colour is the same grey as a selected or open row: there it takes the
// card's ground, so the square is still a square.
const plainTile = "[[data-selected]_&]:bg-card [[aria-current=true]_&]:bg-card";
// The name is the row's control: as small as its words, so the row around it stays a row.
const nameControl =
	"col-span-2 h-auto min-h-6 max-w-full min-w-0 shrink justify-start justify-self-start rounded-sm p-0 text-start text-sm font-medium hover:bg-transparent sm:col-span-1";

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
				) : view.kindOnly ? (
					<Tile aria-hidden="true" className={plainTile}>
						<ArrowDownLeft className="size-4" />
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
				<span className="col-span-2 flex min-w-0 items-center gap-1 sm:col-span-1">
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
							<ChevronRight
								aria-hidden="true"
								className={cn(
									// Drawn close to the name: a 15-letter name stays whole beside a whole badge at 1536.
									"-ms-1 size-3.5 shrink-0 text-subtle-foreground transition-transform motion-reduce:transition-none max-lg:hidden",
									open && "rotate-90 text-primary",
								)}
							/>
						</Button>
					)}
					{/* Small marks, not words: the name and what it was for keep the room. */}
					{view.pending || view.autoFiled ? (
						<TooltipProvider>
							<span className="flex shrink-0 items-center">
								{view.pending ? (
									<Mark name={PENDING_MARK} means={PENDING_MARK_MEANS}>
										<Clock aria-hidden="true" />
									</Mark>
								) : null}
								{view.autoFiled ? (
									<Mark name={AUTO_MARK} means={AUTO_MARK_MEANS}>
										<Sparkles aria-hidden="true" />
									</Mark>
								) : null}
							</span>
						</TooltipProvider>
					) : null}
				</span>
				<span className="peer/badges col-start-1 row-start-2 me-1.5 flex shrink-0 items-center gap-1.5 empty:hidden sm:col-start-2 sm:row-start-1 sm:ms-1.5 sm:me-0 sm:min-w-0 sm:shrink">
					{/* One word where the line isn't plain spending (issue 134); the row's label says it too. */}
					{view.kindWord ? (
						// The Assigned to column says it once the table is in columns.
						<Badge aria-hidden="true" data-slot="row-kind" className={cn(pill, "@2xl/dt:hidden")}>
							{view.kindWord}
						</Badge>
					) : null}
					{/* The part someone is paying back (ADR-0058): the amount stays the whole purchase. */}
					{view.owedBack ? (
						<Badge
							aria-hidden="true"
							data-testid="row-owed-back"
							className={cn(pill, "min-w-0 shrink")}
						>
							<span className="min-w-0 truncate">{view.owedBack}</span>
						</Badge>
					) : null}
					{/* Kept after the bank took it back or changed it (issue 141); opening it says why. */}
					{transaction.bankTookBackOn ? (
						<Badge data-testid="bank-took-back" className={pill}>
							{BANK_TOOK_BACK_WORD}
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
				{/* The columns say this line's parts apart once the table is wide enough for them. Until
				    then the row's For chips are here, a control as they are in their column (issue 134). */}
				<span
					className={cn(
						"col-start-2 row-start-2 flex min-w-0 items-center gap-1 text-[13px] font-normal text-muted-foreground sm:col-span-2 sm:col-start-1 @2xl/dt:hidden",
						view.who === FOR_DIFFERS && "flex-wrap",
						// On the narrowest phones the marks get the second line and the detail a third.
						"max-[389px]:peer-[:not(:empty)]/badges:col-span-2 max-[389px]:peer-[:not(:empty)]/badges:col-start-1 max-[389px]:peer-[:not(:empty)]/badges:row-start-3",
						// "$300 owed back by Casey" fills the second line of any phone: the detail goes under it.
						view.owedBack && "max-sm:col-span-2 max-sm:col-start-1 max-sm:row-start-3",
					)}
				>
					{dated ? (
						<span aria-hidden="true" className="shrink-0">
							{shortDay(transaction.date)} ·
						</span>
					) : null}
					<span
						aria-hidden="true"
						className={cn(
							"flex min-w-0 items-center gap-1",
							// Beside "Different for each Split" it keeps 9rem or takes a line of its own.
							view.who === FOR_DIFFERS && "flex-[1_1_9rem]",
							// A pill is never cut.
							view.needsReview && "shrink-0",
						)}
					>
						<What view={view} stacked />
					</span>
					{view.aroundFor ? (
						cells && checked === undefined && forEdits(transaction) ? (
							<ForCell
								stacked
								transaction={transaction}
								title={view.title}
								who={view.who}
								names={view.forNames}
								cells={cells}
							/>
						) : (
							<span aria-hidden="true" className="shrink-0 whitespace-nowrap">
								· {view.who}
							</span>
						)
					) : view.who === FOR_DIFFERS ? (
						// A split one whose Splits are For different people: said here in words, whole,
						// as its column says it on a wide table (issue 141).
						<span aria-hidden="true" className="shrink-0 whitespace-nowrap">
							{FOR_DIFFERS}
						</span>
					) : null}
					{/* Where it came from has only the room that is left: what it was for stays whole. */}
					{view.source && view.kind !== "transfer" && view.kind !== "goal" ? (
						<span aria-hidden="true" className="min-w-0 flex-[1_1_0%] truncate">
							{/* Money in that has its kind in a badge before this has nothing here to follow. */}
							{view.kindOnly && !view.needsReview ? "" : "· "}
							{view.source}
						</span>
					) : null}
				</span>
			</span>
			{renames && !renaming ? (
				<RenameButton title={view.title} onClick={() => renames.start(transaction, "name")} />
			) : null}
			{/* Money out nobody has assigned may be a card payment: the row says so itself (issue 136),
			    and opens at "Which card does it pay?". */}
			{!renaming && checked === undefined && mayBeCardPayment(transaction) ? (
				<RowMenu
					title={view.title}
					onCardPayment={() => {
						askCardPayment(transaction.id);
						if (!open) onEdit(transaction);
					}}
				/>
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
			// A row For nobody (a Transfer, Goal spending, money back) has an empty For cell beside
			// it: its Accounts take that room too, so they aren't cut short (issue 147).
			spanNext: ({ view }) => view.who === "",
			// A row with one Bucket or none is refiled here; any other kind opens, as its row does.
			cell: ({ transaction, view }) =>
				cells && editsInCell(transaction.id, open) && cellEdits(transaction).refile ? (
					<AssignedCell
						transaction={transaction}
						title={view.title}
						assigned={view.assigned}
						cells={cells}
					>
						<span className="flex min-w-0 items-center gap-1.5">
							<What view={view} />
						</span>
					</AssignedCell>
				) : (
					// The whole of it on hover, where the column cut it short.
					<span className="flex min-w-0 items-center gap-1.5" title={view.assigned}>
						<What view={view} />
					</span>
				),
		},
		{
			id: "for",
			header: "For",
			min: 7,
			// Wide enough for the longest thing it says in words ("Differs by Split").
			width: "minmax(7rem,0.8fr)",
			priority: 3,
			stacked: "hidden",
			className: "text-muted-foreground",
			// Chips, a name each (issue 134): pressed, they change who it was For, on an unassigned row
			// and a split one too (issue 141). A chip is always that control: a row whose For can't be
			// written from here (partly the other Parent's; split with Splits For different people; the
			// open row, whose editor is under it) says it in plain words, so nothing that looks
			// pressable opens the row instead.
			// Empty where For doesn't apply (a Transfer, Goal spending, money back).
			cell: ({ transaction, view }) =>
				view.who === "" ? null : cells &&
					editsInCell(transaction.id, open) &&
					forEdits(transaction) ? (
					<ForCell
						transaction={transaction}
						title={view.title}
						who={view.who}
						names={view.forNames}
						cells={cells}
					/>
				) : view.who === FOR_DIFFERS ? (
					// Shorter words than the row's own, so the column never cuts them.
					<span className="truncate" title={FOR_DIFFERS}>
						{FOR_DIFFERS_SHORT}
					</span>
				) : (
					<span className="truncate">{view.who}</span>
				),
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
			// Money in is green with its "+"; money out is plain ink (issue 134). A pending one is
			// quieter (issue 147): it may still change.
			cell: ({ view }) => (
				<span
					data-pending={view.pending || undefined}
					className={cn(
						view.moneyIn && "text-money-in",
						// Not settled yet: quieter than money that is.
						view.pending && "font-medium text-muted-foreground",
					)}
				>
					{view.amount}
				</span>
			),
		},
	];
}

/**
 * Whether a row offers "It's a card payment" itself: imported money out that is nowhere yet, as
 * its detail offers it (TransferSection), and not money sent to a person.
 */
function mayBeCardPayment(transaction: TransactionRow) {
	return (
		transaction.amountCents > 0 &&
		transaction.importedFrom !== null &&
		transaction.bucketId === null &&
		transaction.commitmentId === null &&
		transaction.goal === null &&
		transaction.transfer === null &&
		transaction.splits.length === 0 &&
		!looksPersonToPerson(transaction.note || transaction.merchantName)
	);
}
