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
	listLabel,
	detailLabel,
	className,
	...props
}: Omit<React.ComponentProps<"div">, "children"> & {
	list: React.ReactNode;
	/** The picked item, e.g. the detail route's outlet. Null or undefined when nothing is picked. */
	detail?: React.ReactNode;
	empty?: React.ReactNode;
	/** Names the list pane, e.g. "Buckets". */
	listLabel: string;
	/** Names the detail pane, e.g. "Bucket". */
	detailLabel: string;
}) {
	const ref = React.useRef<HTMLDivElement>(null);
	const picked = detail !== null && detail !== undefined && detail !== false;
	// The panes fill what's left of the window under the header, whose height varies by section.
	React.useEffect(() => {
		const root = ref.current;
		if (!root) return;
		const measure = () =>
			root.style.setProperty(
				"--master-detail-top",
				`${Math.round(root.getBoundingClientRect().top + window.scrollY)}px`,
			);
		measure();
		const observer = new ResizeObserver(measure);
		if (root.parentElement) observer.observe(root.parentElement);
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);
	const pane = "min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain";
	return (
		<div
			ref={ref}
			data-slot="master-detail"
			data-picked={picked}
			className={cn(
				"grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[var(--list-pane-width)_minmax(0,1fr)] lg:gap-(--layout-gap)",
				// The shell's bottom padding at lg is 3rem, so the panes end where a page would.
				"lg:h-[calc(100dvh-var(--master-detail-top,11rem)-3rem)] lg:min-h-80",
				className,
			)}
			{...props}
		>
			<section
				data-slot="master-detail-list"
				data-scroll-pane=""
				aria-label={listLabel}
				className={cn(pane, picked && "max-lg:hidden")}
			>
				{list}
			</section>
			<section
				data-slot="master-detail-detail"
				data-scroll-pane=""
				aria-label={detailLabel}
				className={cn(pane, !picked && "max-lg:hidden")}
			>
				{picked ? (
					detail
				) : (
					<div data-slot="master-detail-empty" className="grid h-full place-items-center">
						{empty}
					</div>
				)}
			</section>
		</div>
	);
}

export { MasterDetail, PageLayout, SplitLayout, SplitMain, SplitRail };
