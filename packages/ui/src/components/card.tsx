import type * as React from "react";
import { cn } from "#lib/utils";

/** A surface. Border, radius, and shadow come only from here. */
function Card({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card"
			className={cn(
				"overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-card",
				className,
			)}
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

export { Card, CardContent, CardFooter };
