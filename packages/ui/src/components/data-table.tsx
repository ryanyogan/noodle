import {
	type ColumnDef,
	columnVisibilityFeature,
	type Row,
	type RowData,
	rowSelectionFeature,
	rowSortingFeature,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import * as React from "react";
import { Button } from "#components/button";
import { Checkbox } from "#components/checkbox";
import { Skeleton } from "#components/skeleton";
import {
	ariaSort,
	COLUMN_GAP,
	type ColumnShape,
	columnTiers,
	gridTemplate,
	type HeaderCheck,
	nextSort,
	rangeIds,
	type StackedSlot,
	selectsAll,
	stackedLayout,
	stackedTemplate,
	type TableSort,
} from "#lib/data-table";
import { useHydrated } from "#lib/hydrated";
import { cn } from "#lib/utils";

/*
 * A list of things as a table a Parent can work in: columns, a click on a column's name to sort,
 * checkboxes, a row that opens (ADR-0051). The Parent: "use tanstack data table with a lot of
 * interractivity here, ability to select multiples, sort easier, see values in rows".
 *
 * TanStack Table (v9) holds the columns, the header, footer and row models, which columns are
 * hidden, the order and which loaded rows are selected. It runs in manual mode: it never sorts,
 * filters or pages the rows itself, because a page's list comes from the server a page at a time
 * with privacy already applied there. The page owns the order and the selection and is told what
 * the Parent asked for; the rows are drawn in exactly the order they are given, under stable keys,
 * so a drag handle in the leading slot can move them on screen without the table moving them back.
 *
 * It is a tree of divs with the table roles, not a <table>: each row is a grid, so the same
 * cells restack into a block when the table's own container is narrower than `@2xl` (every phone)
 * and low-priority columns drop one at a time as it narrows above that. Container queries, never
 * the window's width, so a table in a narrow column behaves as one on a narrow screen. Nothing
 * scrolls sideways.
 *
 * Don't put a DetailPanel inside it: the root is a `@container`, which would hold a fixed panel.
 * In a `ListWithPanel` the table goes in `list` and the panel is its sibling.
 */

// Static, as the library asks: the features decide which state and options exist. Sorting is
// registered without a sorted row model and filtering and paging are not registered at all, so
// the table cannot reorder or cut the rows it is given.
const features = tableFeatures({
	rowSortingFeature,
	rowSelectionFeature,
	columnVisibilityFeature,
});
type Features = typeof features;

export type DataTableColumn<TData extends RowData> = ColumnShape & {
	/** The column's name: its header, and what the sort button is called. */
	header: string;
	/** The name is for screen readers only (a column of edit buttons). */
	headerHidden?: boolean;
	cell: (row: TData, index: number) => React.ReactNode;
	/** `end` for money and counts: right-aligned, tabular figures. */
	align?: "start" | "end";
	/**
	 * The header is a button that asks the page for this order. `descFirst` for a column whose
	 * first click should run downwards (newest, largest). `said` names each way in the button's
	 * name ("A to Z", "newest first").
	 */
	sortable?: boolean | { descFirst?: boolean; said?: { asc: string; desc: string } };
	/** The totals row's cell for this column. */
	footer?: React.ReactNode;
	/** Left out altogether (not the same as dropping when narrow): a closed month has no Edit. */
	hidden?: boolean;
	className?: string;
	/** For the column's header alone, e.g. the same inset its cells have. */
	headerClassName?: string;
};

export type DataTableSelection<TData extends RowData> = {
	isSelected: (row: TData) => boolean;
	/** Rows that can't be selected keep a disabled checkbox. Default: every row can. */
	canSelect?: (row: TData) => boolean;
	/** Names a row's checkbox: "Select Costco, $84.12", or why it can't be selected. */
	rowLabel: (row: TData) => string;
	/**
	 * What the header's checkbox says. The page says, because it may be selecting rows that have
	 * not loaded ("all that match, except these"); `headerCheck` in lib/data-table does the sum.
	 */
	all: HeaderCheck;
	allLabel?: string;
	/**
	 * A row was ticked or unticked, or a range was (shift-click, Shift+Space): `ids` in list order,
	 * all to be set to `on`. The table keeps no selection of its own.
	 */
	onSelect: (change: { ids: string[]; on: boolean; row: TData; range: boolean }) => void;
	/** The header's checkbox: everything (`true`) or nothing. */
	onSelectAll: (on: boolean) => void;
};

type DataTableProps<TData extends RowData> = Omit<
	React.ComponentProps<"div">,
	"children" | "role"
> & {
	/** Names the table: "Transactions in October". */
	label: string;
	columns: readonly DataTableColumn<TData>[];
	/** The rows, in the order to show them. */
	data: readonly TData[];
	getRowId: (row: TData) => string;
	/** `grid` when rows take the focus (they open or can be selected), else `table`. */
	role?: "table" | "grid";
	/** The list's order now, and what a click on a sortable header asks for. The page sorts. */
	sort?: TableSort | null;
	onSortChange?: (sort: TableSort) => void;
	selection?: DataTableSelection<TData>;
	/** A click on the row (not on a control in it) or Enter with the row in focus. */
	onOpen?: (row: TData) => void;
	/** The row whose item is open (in the panel): marked `aria-current`. */
	isOpen?: (row: TData) => boolean;
	/** A slot before the first column: a drag handle. `min` is its width in rem. */
	leading?: {
		header: string;
		width?: string;
		min?: number;
		render: (row: TData, index: number) => React.ReactNode;
	};
	/**
	 * An empty track before the first column, from `@2xl` only, for a table with no `leading` slot
	 * that sits under one that has it: give it that slot's `width` and `min` and the columns of the
	 * two line up, and drop at the same widths. A stacked row is not indented. Ignored with `leading`.
	 */
	indent?: { width: string; min: number };
	/** A full-width row before this one: a day's label and total. Null for none. */
	groupBefore?: (row: TData, previous: TData | undefined) => React.ReactNode;
	/** Extra attributes for a row's element (`data-*`, a ref for a drag to measure). */
	rowProps?: (row: TData, index: number) => React.ComponentProps<"div"> & Record<string, unknown>;
	/** Shown instead of rows when there are none. */
	empty?: React.ReactNode;
	/** The first rows are on their way: placeholder rows, and the table says it is busy. */
	loading?: boolean;
	loadingRows?: number;
	/** A last full-width row: "Loading more…", or the mark that loads the next page. */
	more?: React.ReactNode;
	/** How many rows there are in all, when the server has said and not all are loaded. */
	rowCount?: number;
	/** The header stays at the top of the page's scroll. Set `--data-table-top` to stop it lower. */
	stickyHeader?: boolean;
	/** What the table sits on, for the sticky header's ground. */
	surface?: "page" | "card";
};

// A row's grid: stacked until the container is `@2xl`, then the columns showing at each tier.
// The templates are CSS variables set on the root from the column list (lib/data-table).
const ROW_GRID = cn(
	"grid items-center gap-x-3 gap-y-0.5 px-(--card-pad) grid-cols-(--dt-stack)",
	"@2xl/dt:grid-cols-(--dt-cols-0) @3xl/dt:grid-cols-(--dt-cols-1) @4xl/dt:grid-cols-(--dt-cols-2)",
	"@5xl/dt:grid-cols-(--dt-cols-3) @6xl/dt:grid-cols-(--dt-cols-4)",
);
// From `@2xl` a cell shows from its column's tier on; one entry per TABLE_TIERS.
const BODY_FROM = [
	"@2xl/dt:flex",
	"@2xl/dt:hidden @3xl/dt:flex",
	"@2xl/dt:hidden @4xl/dt:flex",
	"@2xl/dt:hidden @5xl/dt:flex",
	"@2xl/dt:hidden @6xl/dt:flex",
];
// The header row is only there from `@2xl`.
const HEAD_FROM = [
	"flex",
	"hidden @3xl/dt:flex",
	"hidden @4xl/dt:flex",
	"hidden @5xl/dt:flex",
	"hidden @6xl/dt:flex",
];
// Out of its stacked place and back into the columns.
const UNSTACK = "@2xl/dt:[grid-column:auto] @2xl/dt:[grid-row:auto]";
const STACKED: Record<StackedSlot, string> = {
	title: "flex [grid-column:main] [grid-row:1]",
	value: "flex justify-end text-end tabular-nums [grid-column:val] [grid-row:1]",
	secondary:
		"flex text-[13px] text-muted-foreground [grid-column:main/mainend] [grid-row:var(--dt-row)] @2xl/dt:text-sm @2xl/dt:text-foreground",
	trailing: "flex justify-end [grid-column:trail] [grid-row:1/span_var(--dt-rows)]",
	hidden: "hidden",
};
const ALIGN = {
	start: "@2xl/dt:justify-start @2xl/dt:text-start",
	end: "tabular-nums @2xl/dt:justify-end @2xl/dt:text-end",
};
const BEFORE = {
	select: cn("flex [grid-column:sel] [grid-row:1/span_var(--dt-rows)]", UNSTACK),
	leading: cn("flex [grid-column:lead] [grid-row:1/span_var(--dt-rows)]", UNSTACK),
};
// The indeterminate box: a dash on the primary fill instead of the tick.
const MIXED =
	"data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:before:absolute data-[state=indeterminate]:before:inset-x-1 data-[state=indeterminate]:before:top-1/2 data-[state=indeterminate]:before:h-0.5 data-[state=indeterminate]:before:-translate-y-1/2 data-[state=indeterminate]:before:rounded-full data-[state=indeterminate]:before:bg-primary-foreground [&[data-state=indeterminate]_svg]:hidden";

/** What in a row is a control of its own, so a click on it is not a click on the row. */
const CONTROLS =
	'a[href], button, input, select, textarea, label, summary, [role="checkbox"], [role="button"], [role="menuitem"], [role="combobox"], [data-row-control]';

// The table roles go on divs (see the top of the file: a row is a grid that restacks, which a
// <table> cannot be), and rows that open or select take the focus themselves.
const ROLE = { rowgroup: "rowgroup", row: "row", columnheader: "columnheader" } as const;

const tierOf = (tiers: Record<string, number>, id: string) => tiers[id] ?? 0;

function DataTable<TData extends RowData>({
	label,
	columns,
	data,
	getRowId,
	role,
	sort = null,
	onSortChange,
	selection,
	onOpen,
	isOpen,
	leading,
	indent,
	groupBefore,
	rowProps,
	empty,
	loading = false,
	loadingRows = 6,
	more,
	rowCount,
	stickyHeader = true,
	surface = "page",
	className,
	style,
	...props
}: DataTableProps<TData>) {
	const hydrated = useHydrated();
	const takesFocus = Boolean(onOpen || selection);
	const tableRole = role ?? (takesFocus ? "grid" : "table");
	const cellRole = tableRole === "grid" ? "gridcell" : "cell";

	const shown = React.useMemo(() => columns.filter((column) => !column.hidden), [columns]);
	const byId = React.useMemo(
		() => new Map(columns.map((column) => [column.id, column])),
		[columns],
	);
	const hasSelection = Boolean(selection);
	const leadingMin = leading ? (leading.min ?? 2.75) : 0;
	const leadingWidth = leading ? (leading.width ?? `${leadingMin}rem`) : null;
	// Room held open where a neighbouring table has its leading slot; this table has none.
	const indentWidth = !leading && indent ? indent.width : null;
	const indentMin = indentWidth && indent ? indent.min : 0;
	const layout = React.useMemo(() => {
		const reserved =
			2.5 +
			(hasSelection ? 2 + COLUMN_GAP : 0) +
			(leadingWidth ? leadingMin + COLUMN_GAP : 0) +
			(indentWidth ? indentMin + COLUMN_GAP : 0);
		const tiers = columnTiers(shown, { reserved });
		const stacked = stackedLayout(shown);
		const before = [
			...(hasSelection ? ["2rem"] : []),
			...(leadingWidth ? [leadingWidth] : indentWidth ? [indentWidth] : []),
		];
		const vars: Record<string, string | number> = {
			"--dt-stack": stackedTemplate({
				select: hasSelection,
				leading: leadingWidth,
				value: stacked.has.value,
				trailing: stacked.has.trailing,
			}),
			"--dt-rows": stacked.rows,
		};
		for (let tier = 0; tier < BODY_FROM.length; tier++) {
			vars[`--dt-cols-${tier}`] = gridTemplate(shown, tiers, tier, before);
		}
		return { tiers, stacked, vars };
	}, [shown, hasSelection, leadingWidth, leadingMin, indentWidth, indentMin]);
	// Takes the indent's track in the header, each row and the totals; gone where rows are stacked.
	const spacer = indentWidth ? (
		<div aria-hidden="true" data-slot="data-table-indent" className="hidden @2xl/dt:block" />
	) : null;

	// The library is told which columns there are, not how to draw them. Its own renderer makes a
	// component of a column's `cell` function, so a page that builds its columns in its render (a
	// new function each time) would have every cell taken out and put back on each render, and
	// with it whatever had the focus there: a row's link, or the button a sheet returns to. The
	// table calls `cell` itself, inside the row, so a cell's nodes last as long as its row does.
	const defs = React.useMemo<ColumnDef<Features, TData>[]>(
		() =>
			columns.map((column) => ({
				id: column.id,
				header: column.header,
			})),
		[columns],
	);
	const sorting = React.useMemo(() => (sort ? [sort] : []), [sort]);
	const columnVisibility = React.useMemo(
		() => Object.fromEntries(columns.filter((c) => c.hidden).map((c) => [c.id, false])),
		[columns],
	);
	// The library's picture of the selection is the loaded rows the page says are selected.
	const isSelected = selection?.isSelected;
	const rowSelection = React.useMemo(() => {
		const picked: Record<string, true> = {};
		if (isSelected) for (const row of data) if (isSelected(row)) picked[getRowId(row)] = true;
		return picked;
	}, [data, isSelected, getRowId]);
	const canSelect = selection?.canSelect;

	const table = useTable({
		features,
		columns: defs,
		data,
		getRowId: (row) => getRowId(row),
		// Manual: the page (and its server) orders the rows; the table only says what was asked.
		manualSorting: true,
		enableSortingRemoval: false,
		enableMultiSort: false,
		enableRowSelection: (row) => Boolean(selection) && (canSelect?.(row.original) ?? true),
		state: { sorting, rowSelection, columnVisibility },
		onSortingChange: (updater) => {
			const next = typeof updater === "function" ? updater(sorting) : updater;
			const first = next[0];
			if (first) onSortChange?.({ id: first.id, desc: first.desc });
		},
	});
	const rows = table.getRowModel().rows;
	const headers = table.getHeaderGroups()[0]?.headers ?? [];
	const footers = table.getFooterGroups()[0]?.headers ?? [];
	const hasFooter =
		rows.length > 0 &&
		shown.some((column) => column.footer !== undefined && column.footer !== null);

	// One row is in the tab order: the one last in focus, else the open one, else the first.
	const [active, setActive] = React.useState<string | null>(null);
	const tabStop =
		rows.find((row) => row.id === active)?.id ??
		rows.find((row) => isOpen?.(row.original))?.id ??
		rows[0]?.id;

	// The row ticked last and what it was set to: a shift-click gives the rows up to it that state.
	const anchor = React.useRef<{ id: string; on: boolean } | null>(null);
	const shift = React.useRef(false);
	function pick(row: Row<Features, TData>, range: boolean) {
		if (!selection || !row.getCanSelect()) return;
		const from = range ? anchor.current : null;
		if (from) {
			const ordered = rows.filter((other) => other.getCanSelect()).map((other) => other.id);
			selection.onSelect({
				ids: rangeIds(ordered, from.id, row.id),
				on: from.on,
				row: row.original,
				range: true,
			});
			return;
		}
		const on = !row.getIsSelected();
		anchor.current = { id: row.id, on };
		selection.onSelect({ ids: [row.id], on, row: row.original, range: false });
	}

	function onRowKeyDown(event: React.KeyboardEvent<HTMLDivElement>, row: Row<Features, TData>) {
		// Keys pressed in a control inside the row are that control's.
		if (event.target !== event.currentTarget || event.defaultPrevented) return;
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		const siblings = [
			...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
				":scope > [data-dt-row]",
			) ?? []),
		];
		const at = siblings.indexOf(event.currentTarget);
		const to =
			event.key === "ArrowDown"
				? Math.min(at + 1, siblings.length - 1)
				: event.key === "ArrowUp"
					? Math.max(at - 1, 0)
					: event.key === "Home"
						? 0
						: event.key === "End"
							? siblings.length - 1
							: -1;
		if (to !== -1 && !event.shiftKey) {
			// Handled here, so a list's own arrow keys around the table leave it alone.
			event.preventDefault();
			siblings[to]?.focus();
			return;
		}
		if (event.key === " " && selection) {
			event.preventDefault();
			pick(row, event.shiftKey);
			return;
		}
		if (event.key === "Enter" && onOpen && !event.shiftKey) {
			event.preventDefault();
			onOpen(row.original);
		}
	}

	function onRowClick(event: React.MouseEvent<HTMLDivElement>, row: Row<Features, TData>) {
		if (!onOpen || event.defaultPrevented) return;
		const control = (event.target as HTMLElement).closest(CONTROLS);
		if (control && control !== event.currentTarget && event.currentTarget.contains(control)) return;
		// Dragging across a row to copy its text is not a click on it.
		if (window.getSelection()?.toString()) return;
		onOpen(row.original);
	}

	const sticky = stickyHeader
		? cn(
				"sticky top-[var(--data-table-top,0px)] z-10",
				surface === "card" ? "bg-card" : "bg-background",
			)
		: null;

	const cellClass = (column: DataTableColumn<TData>, slot: StackedSlot) =>
		cn(
			"min-w-0 items-center text-sm",
			STACKED[slot],
			UNSTACK,
			column.wide === false ? "@2xl/dt:hidden" : BODY_FROM[tierOf(layout.tiers, column.id)],
			ALIGN[column.align ?? "start"],
			column.className,
		);

	return (
		// biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is table or grid, set from a variable the rule can not read; both take a name
		<div
			data-slot="data-table"
			role={tableRole}
			aria-label={label}
			aria-busy={loading || undefined}
			aria-rowcount={rowCount}
			aria-multiselectable={tableRole === "grid" && selection ? true : undefined}
			className={cn("@container/dt min-w-0", className)}
			style={{ ...layout.vars, ...style } as React.CSSProperties}
			{...props}
		>
			<div
				role={ROLE.rowgroup}
				data-slot="data-table-head"
				className={cn("hidden border-b border-border @2xl/dt:block", sticky)}
			>
				<div
					role={ROLE.row}
					className={cn(ROW_GRID, "min-h-9 text-xs font-medium text-subtle-foreground")}
				>
					{selection ? (
						<div role={ROLE.columnheader} className="flex items-center">
							<Checkbox
								checked={
									selection.all === "all"
										? true
										: selection.all === "some"
											? "indeterminate"
											: false
								}
								disabled={!hydrated}
								aria-label={selection.allLabel ?? "Select all"}
								onCheckedChange={() => selection.onSelectAll(selectsAll(selection.all))}
								className={MIXED}
							/>
						</div>
					) : null}
					{leading ? (
						<div role={ROLE.columnheader} className="flex items-center">
							<span className="sr-only">{leading.header}</span>
						</div>
					) : null}
					{spacer}
					{headers.map((header) => {
						const column = byId.get(header.column.id);
						if (!column || column.wide === false) return null;
						const sortable = column.sortable;
						const mine = sort?.id === column.id;
						const said = typeof sortable === "object" ? sortable.said : undefined;
						const Icon = !mine ? ArrowUpDown : sort?.desc ? ArrowDown : ArrowUp;
						return (
							// biome-ignore lint/a11y/useAriaPropsSupportedByRole: a columnheader takes aria-sort; its role is set from a constant the rule can not read
							<div
								key={header.id}
								role={ROLE.columnheader}
								aria-sort={ariaSort(sort, column.id)}
								data-column={column.id}
								className={cn(
									"min-w-0 items-center",
									HEAD_FROM[tierOf(layout.tiers, column.id)],
									column.align === "end" ? "justify-end text-end" : null,
									column.headerClassName,
								)}
							>
								{sortable ? (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={!hydrated}
										aria-pressed={mine}
										aria-label={
											mine
												? `${column.header}, ${sort?.desc ? (said?.desc ?? "descending") : (said?.asc ?? "ascending")}`
												: `Sort by ${column.header.toLowerCase()}`
										}
										onClick={() =>
											table.setSorting([
												nextSort(
													sort,
													column.id,
													typeof sortable === "object" && Boolean(sortable.descFirst),
												),
											])
										}
										className={cn(
											"min-w-0 gap-1 px-2 text-xs font-medium",
											column.align === "end" ? "-me-2" : "-ms-2",
											mine ? "text-foreground" : "text-subtle-foreground",
										)}
									>
										<span className="truncate">{column.header}</span>
										<Icon aria-hidden="true" className="size-3.5 shrink-0" />
									</Button>
								) : (
									<span className={cn("truncate", column.headerHidden && "sr-only")}>
										{column.header}
									</span>
								)}
							</div>
						);
					})}
				</div>
			</div>

			<div role={ROLE.rowgroup} data-slot="data-table-body">
				{loading ? (
					<div role={ROLE.row} className="block px-(--card-pad) py-2">
						<div role={cellRole} className="grid gap-2">
							<span className="sr-only">Loading</span>
							{Array.from({ length: loadingRows }, (_, index) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: placeholders with no identity
								<Skeleton key={index} className="h-10 w-full" />
							))}
						</div>
					</div>
				) : null}
				{!loading && rows.length === 0 && empty ? (
					<div role={ROLE.row} className="block px-(--card-pad) py-4">
						<div role={cellRole}>{empty}</div>
					</div>
				) : null}
				{loading
					? null
					: rows.map((row, index) => {
							const selected = row.getIsSelected();
							const open = isOpen?.(row.original) ?? false;
							const group = groupBefore?.(row.original, rows[index - 1]?.original);
							const { className: rowClassName, ...rest } = rowProps?.(row.original, index) ?? {};
							return (
								<React.Fragment key={row.id}>
									{group ? (
										<div
											role={ROLE.row}
											data-slot="data-table-group"
											className="block px-(--card-pad)"
										>
											<div role={cellRole}>{group}</div>
										</div>
									) : null}
									{/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: a row in a grid takes aria-selected; its role is set from a constant the rule can not read */}
									{/* biome-ignore lint/a11y/noStaticElementInteractions: a row that opens or selects is in the tab order and has its keys (arrows, Space, Enter) */}
									<div
										role={ROLE.row}
										data-slot="data-table-row"
										data-dt-row=""
										data-row-id={row.id}
										data-selected={selected || undefined}
										aria-selected={tableRole === "grid" && selection ? selected : undefined}
										aria-current={open ? "true" : undefined}
										tabIndex={takesFocus ? (row.id === tabStop ? 0 : -1) : undefined}
										onFocus={takesFocus ? () => setActive(row.id) : undefined}
										onKeyDown={takesFocus ? (event) => onRowKeyDown(event, row) : undefined}
										onClick={onOpen ? (event) => onRowClick(event, row) : undefined}
										className={cn(
											ROW_GRID,
											"min-h-14 border-t border-border py-2 first:border-t-0 @2xl/dt:min-h-11 @2xl/dt:py-1.5",
											"data-selected:bg-selected aria-[current=true]:bg-selected aria-[current=true]:shadow-[inset_2px_0_0_var(--color-primary)]",
											"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
											onOpen && "cursor-pointer hover:bg-surface-2/60",
											rowClassName,
										)}
										{...rest}
									>
										{selection ? (
											<div role={cellRole} className={cn("items-center", BEFORE.select)}>
												<Checkbox
													checked={selected}
													disabled={!hydrated || !row.getCanSelect()}
													aria-label={selection.rowLabel(row.original)}
													onClick={(event) => {
														shift.current = event.shiftKey;
													}}
													onCheckedChange={() => pick(row, shift.current)}
												/>
											</div>
										) : null}
										{leading ? (
											<div role={cellRole} className={cn("items-center", BEFORE.leading)}>
												{leading.render(row.original, index)}
											</div>
										) : null}
										{spacer}
										{row.getVisibleCells().map((cell) => {
											const column = byId.get(cell.column.id);
											if (!column) return null;
											const place = layout.stacked.places[column.id];
											return (
												<div
													key={cell.id}
													role={cellRole}
													data-column={column.id}
													className={cellClass(column, place?.slot ?? "secondary")}
													style={
														place?.slot === "secondary"
															? ({ "--dt-row": place.row } as React.CSSProperties)
															: undefined
													}
												>
													{column.cell(row.original, index)}
												</div>
											);
										})}
									</div>
								</React.Fragment>
							);
						})}
				{more ? (
					<div role={ROLE.row} data-slot="data-table-more" className="block px-(--card-pad) py-2">
						<div role={cellRole}>{more}</div>
					</div>
				) : null}
			</div>

			{hasFooter && !loading ? (
				<div
					role={ROLE.rowgroup}
					data-slot="data-table-foot"
					className="border-t border-border-strong font-medium"
				>
					<div role={ROLE.row} className={cn(ROW_GRID, "min-h-11 py-2")}>
						{selection ? <div role={cellRole} className={BEFORE.select} /> : null}
						{leading ? <div role={cellRole} className={BEFORE.leading} /> : null}
						{spacer}
						{footers.map((footer) => {
							const column = byId.get(footer.column.id);
							if (!column) return null;
							const place = layout.stacked.places[column.id];
							const filled = column.footer !== undefined && column.footer !== null;
							return (
								<div
									key={footer.id}
									role={cellRole}
									data-column={column.id}
									// A column with no total holds its place in the columns and takes no line when stacked.
									className={cellClass(column, filled ? (place?.slot ?? "secondary") : "hidden")}
									style={
										filled && place?.slot === "secondary"
											? ({ "--dt-row": place.row } as React.CSSProperties)
											: undefined
									}
								>
									{column.footer ?? null}
								</div>
							);
						})}
					</div>
				</div>
			) : null}
		</div>
	);
}

export { DataTable };
