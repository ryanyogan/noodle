import type * as React from "react";
import { cn } from "#lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			aria-hidden="true"
			className={cn("animate-pulse rounded-lg bg-surface-3", className)}
			{...props}
		/>
	);
}

export { Skeleton };
