import * as React from "react";
import { cn } from "#lib/utils";

/*
 * The page grid (#67). Every page below the shared header is one of these layouts, or a list with
 * its picked item in a panel (`ListWithPanel` in detail-panel.tsx, ADR-0047), so widths,
 * gutters and column tops are the same everywhere. The numbers are tokens in globals.css:
 * `--layout-gap` (the one gutter, between columns and between a column's blocks), `--rail-width`,
 * `--list-pane-width` and `--reading-width`. The shell caps the whole page with `--shell-max` (1200, 1440 from 1440 px, 1680 from
 * 1920 px; ADR-0033), and the rail and list pane widen with the window too.
 *
 * One scroll per region: the page scrolls. Nothing in PageLayout or SplitLayout scrolls on its
 * own; the one thing that does is the panel an item opens in (ADR-0047).
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

/**
 * A column of `ListWithPanel` (its list, its aside). No pane scrolls on its own (#73): one that fits in the window stays
 * in view (sticky) while its longer neighbour scrolls with the page, and one taller than the window
 * simply flows with the page, so its end is reached by scrolling the page.
 */
function Pane({ className, ...props }: React.ComponentProps<"section">) {
	const ref = React.useRef<HTMLElement>(null);
	const [fits, setFits] = React.useState(true);
	React.useEffect(() => {
		const pane = ref.current;
		if (!pane) return;
		const measure = () => setFits(pane.offsetHeight + RAIL_INSET * 2 <= window.innerHeight);
		measure();
		const resized = new ResizeObserver(measure);
		resized.observe(pane);
		window.addEventListener("resize", measure);
		return () => {
			resized.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, []);
	return (
		<section
			ref={ref}
			data-fits={fits}
			className={cn("min-w-0 lg:data-[fits=true]:sticky lg:data-[fits=true]:top-6", className)}
			{...props}
		/>
	);
}

export {
	DetailColumns,
	PageLayout,
	Pane as MasterDetailPane,
	SectionGrid,
	SplitLayout,
	SplitMain,
	SplitRail,
};
