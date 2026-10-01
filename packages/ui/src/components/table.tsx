import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Table (https://ui.shadcn.com/docs/components/table), radix-nova, on this design
// system's tokens. One addition: `numeric` on a head or cell right-aligns it in tabular figures,
// for money and counts (GOV.UK and NN/g: numbers line up on the right). Give every table a
// TableCaption (it can be sr-only when a heading above already says it) and `scope` on headers.

function Table({ className, ...props }: React.ComponentProps<"table">) {
	return (
		<div data-slot="table-container" className="relative w-full overflow-x-auto">
			<table
				data-slot="table"
				className={cn("w-full caption-bottom text-[13px]", className)}
				{...props}
			/>
		</div>
	);
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
	return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
	return (
		<tbody
			data-slot="table-body"
			className={cn("[&_tr:last-child]:border-0", className)}
			{...props}
		/>
	);
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
	return (
		<tfoot
			data-slot="table-footer"
			className={cn("border-t bg-surface-2/60 font-medium [&>tr]:last:border-b-0", className)}
			{...props}
		/>
	);
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
	return (
		<tr
			data-slot="table-row"
			className={cn(
				"border-b transition-colors duration-(--duration-fast) data-[state=selected]:bg-surface-2",
				className,
			)}
			{...props}
		/>
	);
}

function TableHead({
	className,
	numeric = false,
	...props
}: React.ComponentProps<"th"> & { numeric?: boolean }) {
	return (
		<th
			data-slot="table-head"
			className={cn(
				"h-9 px-3 text-start align-middle text-xs font-medium whitespace-nowrap text-muted-foreground",
				"first:ps-0 last:pe-0 [&:has([role=checkbox])]:pe-0",
				numeric && "text-end",
				className,
			)}
			{...props}
		/>
	);
}

function TableCell({
	className,
	numeric = false,
	...props
}: React.ComponentProps<"td"> & { numeric?: boolean }) {
	return (
		<td
			data-slot="table-cell"
			className={cn(
				"px-3 py-2 align-middle first:ps-0 last:pe-0 [&:has([role=checkbox])]:pe-0",
				numeric && "text-end whitespace-nowrap tabular-nums",
				className,
			)}
			{...props}
		/>
	);
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
	return (
		<caption
			data-slot="table-caption"
			className={cn("mt-3 text-[13px] text-muted-foreground", className)}
			{...props}
		/>
	);
}

export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow };
