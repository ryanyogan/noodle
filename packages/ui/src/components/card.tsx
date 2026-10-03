import type * as React from "react";
import { cn } from "#lib/utils";

/** A surface. Border, radius (`--radius-card`), and shadow come only from here; padding is `--card-pad`. */
function Card({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card"
			className={cn(
				"overflow-hidden rounded-(--radius-card) border border-border bg-card text-card-foreground shadow-card",
				className,
			)}
			{...props}
		/>
	);
}

// CardHeader, CardTitle, CardDescription and CardAction are shadcn/ui's
// (https://ui.shadcn.com/docs/components/card), radix-nova, by hand from the registry, on this
// Card's padding token (`--card-pad`) rather than the registry's `--card-spacing`. The header pads
// its own top and sides; follow it with CardContent.

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header"
			className={cn(
				"grid auto-rows-min items-start gap-1 px-(--card-pad) pt-(--card-pad)",
				"has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto] [.border-b]:pb-(--card-pad)",
				className,
			)}
			{...props}
		/>
	);
}

/** The card's name. A `div`, as shadcn's is; put a heading inside it where the page needs one. */
function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-title"
			className={cn("text-[15px] leading-snug font-semibold", className)}
			{...props}
		/>
	);
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-description"
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-action"
			className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
			{...props}
		/>
	);
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="card-content" className={cn("p-(--card-pad)", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-footer"
			className={cn("flex items-center gap-3 border-t px-(--card-pad) py-3", className)}
			{...props}
		/>
	);
}

export { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
