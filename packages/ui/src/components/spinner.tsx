import { LoaderCircle } from "lucide-react";
import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Spinner (https://ui.shadcn.com/docs/components/spinner), radix-nova: something is
// working. Still under reduced motion. It's decorative (aria-hidden) by default; when nothing else
// says what's happening, pass `label` and it becomes a status ("Looking for Insights").

function Spinner({ className, label, ...props }: React.ComponentProps<"svg"> & { label?: string }) {
	return (
		<LoaderCircle
			data-slot="spinner"
			{...(label ? { role: "status", "aria-label": label } : { "aria-hidden": true })}
			className={cn("size-4 animate-spin motion-reduce:animate-none", className)}
			{...props}
		/>
	);
}

export { Spinner };
