import * as React from "react";
import { cn } from "#lib/utils";
import { Card } from "./card";

// Noodle's own (#56): a figure with its label, and the grid a few of them sit in. One scale for
// every page, so a "Spent" on a Bucket and a "Spent" on a Goal are the same size and weight.
// A StatGrid is a `<dl>`; each Stat is a `<dt>` (the label) and a `<dd>` (the value), with an
// optional second `<dd>` for a note. Figures are tabular, so they line up down a column.

type StatLayout = "spaced" | "ruled" | "cards";
type StatSize = "sm" | "default" | "lg";

const StatContext = React.createContext<{ layout: StatLayout; size: StatSize }>({
	layout: "spaced",
	size: "default",
});

/**
 * - `spaced` (the default): figures with a gap between them, inside a card's padding.
 * - `ruled`: a strip along the bottom of a card, a rule above it and between its figures.
 *   `wrapLast` puts the last of three on its own row on a phone.
 * - `cards`: each figure is its own Card.
 *
 * Columns come from `className` (`grid-cols-2`, `sm:grid-cols-3`, …).
 */
function StatGrid({
	layout = "spaced",
	size = layout === "ruled" ? "sm" : layout === "cards" ? "lg" : "default",
	wrapLast = false,
	className,
	...props
}: React.ComponentProps<"dl"> & { layout?: StatLayout; size?: StatSize; wrapLast?: boolean }) {
	const context = React.useMemo(() => ({ layout, size }), [layout, size]);
	return (
		<StatContext.Provider value={context}>
			<dl
				data-slot="stat-grid"
				data-layout={layout}
				data-wrap-last={wrapLast || undefined}
				className={cn(
					"group/stat-grid grid",
					layout === "spaced" && "gap-x-4 gap-y-3",
					layout === "ruled" && "border-t",
					layout === "cards" && "gap-3",
					className,
				)}
				{...props}
			/>
		</StatContext.Provider>
	);
}

function Stat({
	label,
	value,
	note,
	help,
	tone,
	className,
	...props
}: Omit<React.ComponentProps<"div">, "children"> & {
	label: React.ReactNode;
	value: React.ReactNode;
	/** A line under the value: what it includes, or what it is compared with. */
	note?: React.ReactNode;
	/** Term help, beside the label. */
	help?: React.ReactNode;
	/** `over` puts the value in the over ink. */
	tone?: "over";
}) {
	const { layout, size } = React.useContext(StatContext);
	const Cell = layout === "cards" ? Card : "div";
	return (
		<Cell
			data-slot="stat"
			className={cn(
				"grid min-w-0 content-start",
				size === "sm" ? "gap-0.5" : "gap-1",
				layout === "ruled" && [
					"border-s px-(--card-pad) py-3 first:border-s-0",
					"max-sm:group-data-wrap-last/stat-grid:last:col-span-full max-sm:group-data-wrap-last/stat-grid:last:border-s-0 max-sm:group-data-wrap-last/stat-grid:last:border-t",
				],
				layout === "cards" && "p-(--card-pad)",
				className,
			)}
			{...props}
		>
			<dt
				className={cn(
					"flex items-center gap-1 text-muted-foreground",
					size === "sm" ? "text-xs" : "text-[13px]",
				)}
			>
				{label}
				{help}
			</dt>
			<dd
				className={cn(
					"font-semibold tabular-nums",
					size === "sm" && "text-sm",
					size === "default" && "text-lg",
					size === "lg" && "text-2xl tracking-[-0.01em]",
					tone === "over" && "text-over",
				)}
			>
				{value}
			</dd>
			{note ? <dd className="text-xs text-muted-foreground tabular-nums">{note}</dd> : null}
		</Cell>
	);
}

export { Stat, StatGrid };
