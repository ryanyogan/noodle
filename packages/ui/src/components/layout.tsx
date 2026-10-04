import * as React from "react";
import { cn } from "#lib/utils";

/*
 * The page grid (#67). Every page below the shared header is one of three layouts, so widths,
 * gutters and column tops are the same everywhere. The numbers are tokens in globals.css:
 * `--layout-gap` (the one gutter, between columns and between a column's blocks), `--rail-width`,
 * `--list-pane-width` and `--reading-width`. The shell caps the whole page with `--shell-max` (1200, 1440 from 1440 px, 1680 from
 * 1920 px; ADR-0033), and the rail and list pane widen with the window too.
 *
 * One scroll per region: the page scrolls. Nothing in PageLayout or SplitLayout scrolls on its
 * own. MasterDetail's two panes are the one exception, because they are side-by-side full-height
 * regions and the page itself then doesn't scroll.
 */

/** The space kept above and below a sticky rail, matching the shell's top padding at lg (pt-6). */
const RAIL_INSET = 24;

/**
 * A page in one column. `width="reading"` caps it at the reading width for pages of prose and
 * forms; `columns={2}` splits it into two equal columns at lg (Household's settings).
 */
function PageLayout({
	width = "full",
	columns = 1,
	className,
	...props
}: React.ComponentProps<"div"> & {
	width?: "full" | "reading";
	columns?: 1 | 2;
}) {
	return (
		<div
			data-slot="page-layout"
			className={cn(
				// minmax(0,1fr): a wide child scrolls or wraps in itself rather than widening the page.
				"grid grid-cols-[minmax(0,1fr)]",
				"gap-(--layout-gap)",
				width === "reading" && "max-w-(--reading-width)",
				columns === 2 && "lg:grid-cols-2 lg:items-start",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * Sections side by side (#73L, ADR-0033): related sections of a page in one grid, so a wide window
 * shows them next to each other instead of one long column. One column below xl (1280 px), two
 * from xl, and with `columns={3}` three from 1680 px. Each cell's top is a section heading, so the
 * headings of a row line up. Usable inside PageLayout, SplitMain or a detail pane.
 */
function SectionGrid({
	columns = 2,
	className,
	...props
}: React.ComponentProps<"div"> & { columns?: 2 | 3 }) {
	return (
		<div
			data-slot="section-grid"
			className={cn(
				"grid grid-cols-[minmax(0,1fr)] items-start gap-(--layout-gap)",
				"xl:grid-cols-2",
				columns === 3 && "min-[105rem]:grid-cols-3",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * The picked item's blocks in two columns once its pane is wide enough (48 rem of pane, measured
 * on the pane itself, not the window), one column otherwise. A span-2 block (`col-span-full`)
 * keeps the full width (the item's header, a chart).
 */
function DetailColumns({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="detail-columns"
			className={cn(
				"grid grid-cols-[minmax(0,1fr)] items-start gap-(--layout-gap)",
				"@3xl/detail:grid-cols-2",
				className,
			)}
			{...props}
		/>
	);
}

type Stack = "main" | "rail" | "children";
const SplitContext = React.createContext<Stack>("main");

/**
 * Main plus a rail of the one standard width, from lg. Both columns start on the same top edge.
 * Give it a `SplitMain` and a `SplitRail`.
 *
 * Below lg it is one column. `stack` says in what order: `main` first (the default), `rail` first,
 * or `children`, where both columns dissolve and each block's own `order-N` places it (This Month
 * interleaves the two; give those blocks `lg:order-none`).
 */
function SplitLayout({
	stack = "main",
	className,
	...props
}: React.ComponentProps<"div"> & { stack?: Stack }) {
	return (
		<SplitContext.Provider value={stack}>
			<div
				data-slot="split-layout"
				className={cn(
					"grid grid-cols-[minmax(0,1fr)] gap-(--layout-gap)",
					"lg:grid-cols-[minmax(0,1fr)_var(--rail-width)] lg:items-start",
					className,
				)}
				{...props}
			/>
		</SplitContext.Provider>
	);
}

/** The main column of a SplitLayout: its blocks, one gutter apart. */
function SplitMain({ className, ...props }: React.ComponentProps<"div">) {
	const stack = React.useContext(SplitContext);
	return (
		<div
			data-slot="split-main"
			className={cn(
				"min-w-0 content-start gap-(--layout-gap)",
				stack === "children" ? "contents lg:grid" : "grid",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * The rail of a SplitLayout. It stays in view (sticky) only while all of it fits the window; when
 * it is taller it scrolls with the page. It never has a scrollbar of its own.
 */
function SplitRail({ className, ...props }: React.ComponentProps<"div">) {
	const stack = React.useContext(SplitContext);
	const ref = React.useRef<HTMLDivElement>(null);
	const [fits, setFits] = React.useState(false);
	React.useEffect(() => {
		const rail = ref.current;
		if (!rail) return;
		const measure = () => setFits(rail.offsetHeight + RAIL_INSET * 2 <= window.innerHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(rail);
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);
	return (
		<div
			ref={ref}
			data-slot="split-rail"
			data-fits={fits}
			className={cn(
				"min-w-0 content-start gap-(--layout-gap)",
				stack === "children" ? "contents lg:grid" : "grid",
				stack === "rail" && "max-lg:order-first",
				"lg:data-[fits=true]:sticky lg:data-[fits=true]:top-6",
				className,
			)}
			{...props}
		/>
	);
}

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * One of MasterDetail's panes. While it scrolls and holds nothing that takes focus, it takes focus
 * itself, so the keyboard can scroll it (WCAG 2.1.1; axe's scrollable-region-focusable).
 */
function Pane({ className, ...props }: React.ComponentProps<"section">) {
	const ref = React.useRef<HTMLElement>(null);
	const [focusable, setFocusable] = React.useState(false);
	React.useEffect(() => {
		const pane = ref.current;
		if (!pane) return;
		const measure = () =>
			setFocusable(
				pane.scrollHeight > pane.clientHeight + 1 &&
					getComputedStyle(pane).overflowY === "auto" &&
					!pane.querySelector(FOCUSABLE),
			);
		measure();
		const resized = new ResizeObserver(measure);
		resized.observe(pane);
		const changed = new MutationObserver(measure);
		changed.observe(pane, { childList: true, subtree: true });
		window.addEventListener("resize", measure);
		return () => {
			resized.disconnect();
			changed.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);
	return (
		<section
			ref={ref}
			data-scroll-pane=""
			tabIndex={focusable ? 0 : undefined}
			className={cn(
				// relative: something absolutely placed inside (an sr-only label) is clipped by the pane
				// too. Otherwise its containing block is outside the pane, and it lengthens the page.
				"min-w-0 lg:relative",
				"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * A list beside the item picked from it. From lg the page scrolls as one (no pane scrolls on its
 * own, #73): the list is as long as it is, and the picked item sits beside it, its top level with
 * the list's first row, and stays in view (sticky) as the list scrolls. Only an item taller than
 * the window scrolls inside its own column. Picking an item from far down the list keeps the page
 * where it was: the row's link must not reset the window's scroll (`resetScroll={false}`). Below lg it shows one level at a time: the list, or (once there is a `detail`) the
 * detail, as ordinary page content.
 *
 * `empty` fills the detail pane at lg while nothing is picked ("Pick a Bucket to see it").
 */
function MasterDetail({
	list,
	detail,
	empty,
	emptyStacks,
	listLabel,
	detailLabel,
	narrowList,
	listOnly,
	className,
	style,
	...props
}: Omit<React.ComponentProps<"div">, "children"> & {
	list: React.ReactNode;
	/** The picked item, e.g. the detail route's outlet. Null or undefined when nothing is picked. */
	detail?: React.ReactNode;
	empty?: React.ReactNode;
	/**
	 * `empty` is part of the page rather than a placeholder (the list's add form, say): it starts at
	 * the top of its pane, and below lg it follows the list instead of being left out.
	 */
	emptyStacks?: boolean;
	/**
	 * The list's rows are a name and an amount (the Plan's Buckets and Commitments): beside an item
	 * the list takes 22rem below 1920, which leaves the item room for two columns at 1440.
	 */
	narrowList?: boolean;
	/**
	 * While nothing is picked there is no detail pane from lg: the list has the page's width (Review's
	 * cards, side by side), and `empty` isn't shown.
	 */
	listOnly?: boolean;
	/** Names the list pane, e.g. "Buckets". */
	listLabel: string;
	/** Names the detail pane, e.g. "Bucket". */
	detailLabel: string;
}) {
	const picked = detail !== null && detail !== undefined && detail !== false;
	// A row's link doesn't send the window back to the top (the app's row links ask the router not
	// to), so beside the list (lg) the Parent keeps their place in it. Below lg the item is a page of
	// its own, so opening one starts it at the top.
	const wasPicked = React.useRef(picked);
	React.useEffect(() => {
		const opened = picked && !wasPicked.current;
		wasPicked.current = picked;
		if (opened && !window.matchMedia("(min-width: 1024px)").matches) window.scrollTo({ top: 0 });
	}, [picked]);
	return (
		<div
			data-slot="master-detail"
			data-picked={picked}
			className={cn(
				"grid grid-cols-[minmax(0,1fr)] lg:gap-(--layout-gap)",
				listOnly && !picked
					? null
					: narrowList
						? "lg:grid-cols-[22rem_minmax(0,1fr)] min-[120rem]:grid-cols-[var(--list-pane-width)_minmax(0,1fr)]"
						: "lg:grid-cols-[var(--list-pane-width)_minmax(0,1fr)]",
				emptyStacks && !picked && "max-lg:gap-(--layout-gap)",
				// A list that fills while nothing is picked (Goals' cards): the list takes the wide column
				// and the overview the rail's width (#73L, ADR-0033).
				"lg:data-[list-fills=true]:grid-cols-[minmax(0,1fr)_var(--rail-width)]",
				"lg:items-start",
				className,
			)}
			style={style}
			{...props}
		>
			<Pane
				data-slot="master-detail-list"
				aria-label={listLabel}
				className={cn(picked && "max-lg:hidden")}
			>
				{list}
			</Pane>
			<Pane
				data-slot="master-detail-detail"
				aria-label={detailLabel}
				className={cn(
					"@container/detail",
					// Stays beside the list as the page scrolls; scrolls itself only when taller than the
					// window (3rem: the sticky inset above and below).
					"lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:overscroll-contain",
					!picked && !emptyStacks && "max-lg:hidden",
					!picked && listOnly && "lg:hidden",
				)}
			>
				{picked ? (
					detail
				) : (
					<div
						data-slot="master-detail-empty"
						className={cn("grid", emptyStacks ? "content-start" : "place-items-center lg:min-h-40")}
					>
						{empty}
					</div>
				)}
			</Pane>
		</div>
	);
}

export { DetailColumns, MasterDetail, PageLayout, SectionGrid, SplitLayout, SplitMain, SplitRail };
