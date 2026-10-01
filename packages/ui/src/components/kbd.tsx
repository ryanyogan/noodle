import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Kbd (https://ui.shadcn.com/docs/components/kbd), radix-nova, on this design
// system's tokens: a key to press. Give a symbol key a text alternative (aria-label="Left arrow"),
// as a screen reader may read "←" as nothing at all.

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
	return (
		<kbd
			data-slot="kbd"
			className={cn(
				"pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-[5px] border border-border-strong bg-surface-2 px-1 font-sans text-xs font-medium text-muted-foreground select-none",
				"in-data-[slot=tooltip-content]:border-background/30 in-data-[slot=tooltip-content]:bg-background/15 in-data-[slot=tooltip-content]:text-background",
				"[&_svg:not([class*='size-'])]:size-3",
				className,
			)}
			{...props}
		/>
	);
}

function KbdGroup({ className, ...props }: React.ComponentProps<"kbd">) {
	return (
		<kbd
			data-slot="kbd-group"
			className={cn("inline-flex items-center gap-1", className)}
			{...props}
		/>
	);
}

export { Kbd, KbdGroup };
