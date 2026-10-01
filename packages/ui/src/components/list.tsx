import type * as React from "react";
import { cn } from "#lib/utils";
import { Card } from "./card";

/** A card holding rows, divided by hairlines. Every list in the app is one of these. */
function List({ className, ...props }: React.ComponentProps<"ul">) {
	return (
		<Card>
			<ul
				data-slot="list"
				className={cn(
					"[&>li+li]:border-t [&>[data-slot=list-group-label]+li]:border-t-0",
					className,
				)}
				{...props}
			/>
		</Card>
	);
}

/**
 * One row: leading tile, a title with meta beneath, and a trailing amount or action.
 * `below` spans under the title and trailing columns (e.g. a Meter).
 */
function ListRow({
	leading,
	title,
	badge,
	meta,
	trailing,
	below,
	className,
	...props
}: Omit<React.ComponentProps<"li">, "title"> & {
	leading?: React.ReactNode;
	title: React.ReactNode;
	badge?: React.ReactNode;
	meta?: React.ReactNode;
	trailing?: React.ReactNode;
	below?: React.ReactNode;
}) {
	return (
		<li
			data-slot="list-row"
			className={cn(
				"grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 px-(--card-pad) py-3.5",
				!leading && "grid-cols-[minmax(0,1fr)_auto]",
				className,
			)}
			{...props}
		>
			{leading}
			<div className="grid min-w-0 gap-0.5">
				<div className="flex min-w-0 items-center gap-2 text-sm font-medium">
					<span className="truncate">{title}</span>
					{badge}
				</div>
				{meta ? (
					<div className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
						{meta}
					</div>
				) : null}
			</div>
			{trailing ? (
				<div className="grid justify-items-end gap-0.5 text-end tabular-nums">{trailing}</div>
			) : null}
			{below ? (
				<div className={leading ? "col-start-2 col-end-4" : "col-span-2"}>{below}</div>
			) : null}
		</li>
	);
}

/** A small heading inside a list, e.g. a day in the transaction list. */
function ListGroupLabel({ className, ...props }: React.ComponentProps<"li">) {
	return (
		<li
			data-slot="list-group-label"
			className={cn(
				"px-(--card-pad) pt-2.5 pb-1.5 text-xs font-medium text-subtle-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export { List, ListGroupLabel, ListRow };
