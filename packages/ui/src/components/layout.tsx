import * as React from "react";
import { cn } from "#lib/utils";

/*
 * The page grid (#67). Every page below the shared header is one of three layouts, so widths,
 * gutters and column tops are the same everywhere. The numbers are tokens in globals.css:
 * `--layout-gap` (the one gutter, between columns and between a column's blocks), `--rail-width`,
 * `--list-pane-width` and `--reading-width`. The shell caps the whole page (1200 px, 1440 px wide).
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
	spacing = "default",
	className,
	...props
}: React.ComponentProps<"div"> & {
	width?: "full" | "reading";
	columns?: 1 | 2;
	/** `tight` sets a dashboard's cards closer than the gutter (Reports). */
	spacing?: "default" | "tight";
}) {
	return (
		<div
			data-slot="page-layout"
			className={cn(
				// minmax(0,1fr): a wide child scrolls or wraps in itself rather than widening the page.
				"grid grid-cols-[minmax(0,1fr)]",
				spacing === "tight" ? "gap-4 lg:gap-5" : "gap-(--layout-gap)",
				width === "reading" && "max-w-(--reading-width)",
				columns === 2 && "lg:grid-cols-2 lg:items-start",
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
				"min-w-0 lg:relative lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain",
				"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
				className,
			)}
			{...props}
		/>
	);
}

/**
 * A list beside the item picked from it. From lg the two are full-height panes under the page's
 * header and each scrolls on its own, so the list keeps its place while the detail changes; the
 * page itself doesn't scroll. Below lg it shows one level at a time: the list, or (once there is a
 * `detail`) the detail, as ordinary page content.
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
	/** Names the list pane, e.g. "Buckets". */
	listLabel: string;
	/** Names the detail pane, e.g. "Bucket". */
	detailLabel: string;
}) {
	const ref = React.useRef<HTMLDivElement>(null);
	const picked = detail !== null && detail !== undefined && detail !== false;
	// The panes fill what's left of the window under the header, whose height varies by section.
	// Held in state and rendered into `style`, so a re-render or a new node keeps it.
	const [top, setTop] = React.useState<number>();
	React.useEffect(() => {
		const root = ref.current;
		if (!root) return;
		const measure = () => setTop(root.getBoundingClientRect().top + window.scrollY);
		measure();
		// The header above can change height once the fonts load, without resizing the parent.
		document.fonts?.ready.then(measure);
		const observer = new ResizeObserver(measure);
		if (root.parentElement) observer.observe(root.parentElement);
		// The section's header sits outside that parent; a change in it shows in the page's height.
		observer.observe(document.documentElement);
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);
	return (
		<div
			ref={ref}
			data-slot="master-detail"
			data-picked={picked}
			className={cn(
				"grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[var(--list-pane-width)_minmax(0,1fr)] lg:gap-(--layout-gap)",
				emptyStacks && !picked && "max-lg:gap-(--layout-gap)",
				// The shell's bottom padding at lg is 3rem, so the panes end where a page would.
				"lg:h-[calc(100dvh-var(--master-detail-top,11rem)-3rem)] lg:min-h-80",
				className,
			)}
			style={
				top === undefined
					? style
					: ({ "--master-detail-top": `${top}px`, ...style } as React.CSSProperties)
			}
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
				className={cn(!picked && !emptyStacks && "max-lg:hidden")}
			>
				{picked ? (
					detail
				) : (
					<div
						data-slot="master-detail-empty"
						className={cn("grid", emptyStacks ? "content-start" : "h-full place-items-center")}
					>
						{empty}
					</div>
				)}
			</Pane>
		</div>
	);
}

export { MasterDetail, PageLayout, SplitLayout, SplitMain, SplitRail };
