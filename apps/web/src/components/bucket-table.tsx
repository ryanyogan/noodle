import type { BucketState, MonthKey } from "@noodle/domain";
import { BudgetBar } from "@noodle/ui/components/budget-bar";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { DataTable, type DataTableColumn } from "@noodle/ui/components/data-table";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { Link, useHydrated, useNavigate, useParams } from "@tanstack/react-router";
import { GripVertical, Pencil } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { asBucketColor, barState, monogram } from "../buckets";
import { formatMoney } from "../format";
import { BucketSheet, useBucketChanges } from "./bucket-editor";
import { useBucketReorder } from "./bucket-reorder";
import { masterDetailItem } from "./master-detail";

/**
 * What is left in a Bucket. In its own column the heading says what the figure is; in a stacked row
 * (a phone, or a narrow list) the figure says it itself: "$120 left", "$20 over".
 */
function Left({ cents }: { cents: number }) {
	return (
		<span className={cn("font-medium tabular-nums", cents < 0 && "text-over-foreground")}>
			<span className="hidden @2xl/dt:inline">{formatMoney(cents)}</span>
			{/* The narrowest phone has no room for it beside the name: there it leads the line under. */}
			<span className="hidden @[20rem]/dt:inline @2xl/dt:hidden">
				{cents < 0 ? `${formatMoney(-cents)} over` : `${formatMoney(cents)} left`}
			</span>
		</span>
	);
}

/**
 * The line under the name in a stacked row: the figures that have no column there. On the
 * narrowest phone (a table under 320px) the name has the first line to itself, so this line says
 * what is left first: "$120 left of $400".
 */
function Summary({
	allowance,
	spent,
	left,
	rolling = false,
}: {
	allowance: number;
	spent: number;
	left: number;
	rolling?: boolean;
}) {
	return (
		<span className="truncate font-normal tabular-nums">
			<span className="@[20rem]/dt:hidden">
				<span className={cn("font-medium", left < 0 ? "text-over-foreground" : "text-foreground")}>
					{formatMoney(Math.abs(left))}
				</span>
				{left < 0 ? " over" : " left"} of {formatMoney(allowance)}
			</span>
			<span className="hidden @[20rem]/dt:inline">
				{formatMoney(allowance)} allowance · {formatMoney(spent)} spent
				{rolling ? " · Carries over" : ""}
			</span>
		</span>
	);
}

const anyone = () => true;

/** The handle's column: its track, and the least it reads at in rem (32 px a mouse, 44 a thumb). */
const HANDLE = { width: "2.75rem", min: 2 };

/**
 * Whether the shared Buckets' table has handles: a month that can change, with more than one to
 * put in order. The Personal Allowances table under it holds the same room open when it does
 * (`indent`), so the two tables' figures are in one line.
 */
export const bucketsHaveHandles = (buckets: readonly BucketState[], editable: boolean) =>
	editable && buckets.length > 1;

const sum = (buckets: readonly BucketState[], of: (bucket: BucketState) => number) =>
	buckets.reduce((total, bucket) => total + of(bucket), 0);

/**
 * The Plan's Buckets as a table to manage them in (issue 107, ADR-0051): each Bucket's allowance,
 * what it has spent and has left this month, its pace and what happens at the end of the month,
 * with a total under them. A row opens the Bucket's own page (in the panel beside the list, a page
 * on a phone); its pencil, or its allowance, opens the one Bucket sheet, where everything about it
 * changes; its handle moves it. Nothing sorts: the order is the Parent's own.
 *
 * Self-contained: it keeps the sheet, the writes and the drag, and is told only which Buckets, who
 * may change them and where a typed amount goes. Personal Allowances are the same table without
 * handles (`reorder` off), each row editable only by its own Parent (`canEdit`).
 *
 * The sheet is rendered beside the table, not in a row: a sheet is a portal, React hands its
 * clicks to whatever rendered it, and a row would take them for a click on itself.
 */
export function BucketTable({
	month,
	label,
	buckets,
	editable,
	canEdit = anyone,
	setBy,
	reorder = false,
	indent = false,
	was,
	onDraft,
	freeToSpend,
	foot,
}: {
	month: MonthKey;
	/** Names the table: "Buckets", "Personal Allowances". */
	label: string;
	buckets: readonly BucketState[];
	/** Whether the month's Plan can still change at all. */
	editable: boolean;
	/** Which of them the viewer may change, in an editable month. Default: all. */
	canEdit?: (bucket: BucketState) => boolean;
	/** Who sets one the viewer can't (the other Parent's Personal Allowance). */
	setBy?: (bucket: BucketState) => string | undefined;
	/** Rows have a handle and can be moved: the shared Buckets. */
	reorder?: boolean;
	/** No handles here, but room for them from the width where rows are columns: see `bucketsHaveHandles`. */
	indent?: boolean;
	/** Each Bucket's allowance the month before, when this month changed it. */
	was: Record<string, number | undefined>;
	/** A Bucket's amount while it's typed in its sheet, or null once it's put away. */
	onDraft: (bucketId: string, cents: number | null) => void;
	/** The month's Free to Spend as saved, for the sheet's "Free to Spend after this". */
	freeToSpend?: number;
	/** Under the table: what adds a Bucket. */
	foot?: ReactNode;
}) {
	const hydrated = useHydrated();
	const navigate = useNavigate();
	const openId = useParams({ strict: false, select: (params) => params.id });
	const changes = useBucketChanges(month);
	const moving = useBucketReorder({
		buckets,
		reorder: (bucketIds, settled) => changes.reorder.mutate({ bucketIds }, { onSettled: settled }),
	});
	// The sheet's Bucket stays while it closes, so it has something to show on its way out.
	const [sheet, setSheet] = useState<{ id: string; open: boolean } | null>(null);
	const inSheet = sheet ? buckets.find((bucket) => bucket.id === sheet.id) : undefined;
	const shown = moving.ids.flatMap((id) => buckets.find((bucket) => bucket.id === id) ?? []);
	const handles = reorder && bucketsHaveHandles(buckets, editable);

	// Built again only when what they show changes, not when a row opens or the sheet does.
	const columns = useMemo<DataTableColumn<BucketState>[]>(() => {
		const mine = (bucket: BucketState) => editable && canEdit(bucket);
		const totals = buckets.length > 1;

		/** Opens the sheet from a control in the row, which keeps the focus so it comes back to it. */
		const edit = (bucket: BucketState, opener: HTMLElement) => {
			opener.focus({ preventScroll: true });
			setSheet({ id: bucket.id, open: true });
		};

		return [
			{
				id: "bucket",
				header: "Bucket",
				// Wide enough that a name reads beside its tile; with it, Pace shows from a 768px table.
				min: 12,
				width: "minmax(0,2fr)",
				stacked: "title",
				cell: (bucket) => {
					const before = was[bucket.id];
					const setter = setBy?.(bucket);
					const note =
						before != null
							? `Changed this month · was ${formatMoney(before)}`
							: setter
								? `${setter} sets this`
								: null;
					return (
						<div className="flex min-w-0 items-center gap-3">
							<Tile bucket={asBucketColor(bucket.color)}>{monogram(bucket.name)}</Tile>
							<div className="grid min-w-0">
								<Link
									to="/plan/$month/buckets/$id"
									params={{ month, id: bucket.id }}
									className="truncate font-medium hover:underline @max-2xl/dt:[overflow-wrap:anywhere] @max-2xl/dt:whitespace-normal"
									{...masterDetailItem}
								>
									{bucket.name}
								</Link>
								{note ? (
									<span className="truncate text-[13px] text-muted-foreground">{note}</span>
								) : null}
							</div>
						</div>
					);
				},
				footer: totals ? "Total" : undefined,
			},
			{
				id: "allowance",
				header: "Allowance",
				min: 6,
				width: "6rem",
				align: "end",
				stacked: "hidden",
				cell: (bucket) =>
					mine(bucket) ? (
						// A shortcut for a mouse: the pencil is the control a keyboard meets for the same sheet.
						<Button
							type="button"
							variant="ghost"
							size="sm"
							tabIndex={-1}
							disabled={!hydrated}
							aria-haspopup="dialog"
							data-bucket-amount=""
							// The figure as the other columns write theirs, not a button's smaller, quieter words.
							className="-me-2 px-2 text-sm font-medium text-foreground tabular-nums"
							onClick={(event) => edit(bucket, event.currentTarget)}
						>
							{formatMoney(bucket.allowance)}
						</Button>
					) : (
						<span className="font-medium">{formatMoney(bucket.allowance)}</span>
					),
				footer: totals ? formatMoney(sum(buckets, (b) => b.allowance)) : undefined,
			},
			{
				id: "spent",
				header: "Spent",
				min: 5.5,
				width: "5.5rem",
				align: "end",
				priority: 2,
				stacked: "hidden",
				className: "text-muted-foreground",
				cell: (bucket) => formatMoney(bucket.spent),
				footer: totals ? formatMoney(sum(buckets, (b) => b.spent)) : undefined,
			},
			{
				id: "left",
				header: "Left",
				min: 5.5,
				width: "5.5rem",
				align: "end",
				priority: 2,
				stacked: "value",
				cell: (bucket) => <Left cents={bucket.left} />,
				footer: totals ? <Left cents={sum(buckets, (b) => b.left)} /> : undefined,
			},
			{
				// Only in a stacked row: the columns that have no room there, in a line under the name.
				id: "summary",
				header: "This month",
				min: 0,
				wide: false,
				stacked: "secondary",
				cell: (bucket) => (
					<Summary
						allowance={bucket.allowance}
						spent={bucket.spent}
						left={bucket.left}
						rolling={bucket.rolling}
					/>
				),
				footer: totals ? (
					<Summary
						allowance={sum(buckets, (b) => b.allowance)}
						spent={sum(buckets, (b) => b.spent)}
						left={sum(buckets, (b) => b.left)}
					/>
				) : undefined,
			},
			{
				id: "pace",
				header: "Pace",
				min: 5,
				width: "minmax(5rem,1fr)",
				priority: 3,
				stacked: "hidden",
				// Clear of the figure before it, which ends where this column would begin.
				headerClassName: "ps-4",
				cell: (bucket) => (
					<div className="w-full min-w-0 ps-4">
						<BudgetBar
							bucket={asBucketColor(bucket.color)}
							value={bucket.spent}
							max={bucket.available}
							marker={1 - bucket.pace.leftShare}
							state={barState(bucket.status)}
							label={`${bucket.name} this month`}
							valueText={`${formatMoney(bucket.spent)} spent of ${formatMoney(bucket.available)}, ${
								bucket.left < 0
									? `${formatMoney(-bucket.left)} over`
									: `${formatMoney(bucket.left)} left`
							}`}
						/>
					</div>
				),
			},
			{
				id: "end",
				header: "End of month",
				min: 7,
				width: "7rem",
				priority: 4,
				stacked: "hidden",
				cell: (bucket) =>
					bucket.rolling ? (
						"Carries over"
					) : (
						<span className="text-muted-foreground">Resets monthly</span>
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
				// A month that has ended, or a table with nothing of the viewer's, has no pencils at all.
				hidden: !buckets.some(mine),
				cell: (bucket) =>
					mine(bucket) ? (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							disabled={!hydrated}
							aria-label={`Edit ${bucket.name}`}
							aria-haspopup="dialog"
							data-bucket-edit=""
							onClick={(event) => edit(bucket, event.currentTarget)}
						>
							<Pencil />
						</Button>
					) : null,
			},
		];
	}, [buckets, editable, canEdit, setBy, was, hydrated, month]);

	return (
		<div className="grid gap-3">
			<div ref={moving.listRef} {...moving.guard}>
				{/* Clipped to the card's corners, so a row's hover and the open row's ground follow them. */}
				<Card className="overflow-clip">
					<DataTable
						label={label}
						columns={columns}
						data={shown}
						getRowId={(bucket) => bucket.id}
						surface="card"
						// A short list in the middle of a page: the header scrolls with its rows.
						stickyHeader={false}
						indent={indent ? HANDLE : undefined}
						leading={
							handles
								? {
										header: "Order",
										...HANDLE,
										render: (bucket) => (
											<Button
												type="button"
												variant="ghost"
												size="icon"
												disabled={!hydrated}
												aria-label={`Move ${bucket.name}`}
												// Only the handle refuses to scroll: a touch anywhere else on the row scrolls
												// the page.
												className="-ms-2 cursor-grab touch-none select-none [-webkit-touch-callout:none] active:cursor-grabbing"
												{...moving.handleProps(bucket.id)}
											>
												<GripVertical />
											</Button>
										),
									}
								: undefined
						}
						rowProps={(bucket) => ({
							"data-bucket-row": bucket.id,
							"data-dragged": moving.lifted === bucket.id || undefined,
							className:
								moving.lifted === bucket.id
									? "relative z-1 bg-surface-2 shadow-pop hover:bg-surface-2"
									: undefined,
						})}
						onOpen={(bucket) =>
							navigate({
								to: "/plan/$month/buckets/$id",
								params: { month, id: bucket.id },
								resetScroll: false,
							})
						}
						isOpen={(bucket) => bucket.id === openId}
					/>
				</Card>
				{handles ? (
					<p id={moving.hintId} hidden>
						Drag to move it, or press the up or down arrow key.
					</p>
				) : null}
				{reorder ? (
					<p aria-live="assertive" className="sr-only" data-testid="reorder-said">
						{moving.said}
					</p>
				) : null}
			</div>
			{changes.failed}
			{foot}
			{inSheet ? (
				<BucketSheet
					month={month}
					bucket={inSheet}
					order={reorder ? moving.ids : []}
					open={sheet?.open ?? false}
					onOpenChange={(open) => setSheet({ id: inSheet.id, open })}
					changes={changes}
					onDraft={(cents) => onDraft(inSheet.id, cents)}
					freeToSpend={freeToSpend}
					withHistory
					amountFirst
				/>
			) : null}
		</div>
	);
}
