import { cva, type VariantProps } from "class-variance-authority";
import { Toggle as TogglePrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Toggle (https://ui.shadcn.com/docs/components/toggle), radix-nova, on this design
// system's tokens. `segmented` is Noodle's own: one option of a track (see ToggleGroup), raised
// onto the card when it's on.

const toggleVariants = cva(
	[
		"inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap select-none",
		"transition-[background-color,color,box-shadow] duration-(--duration-fast) ease-standard",
		"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
		"disabled:pointer-events-none disabled:opacity-50",
		"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	],
	{
		variants: {
			variant: {
				default:
					"rounded-lg bg-transparent text-muted-foreground hover:bg-surface-2 hover:text-foreground data-[state=on]:bg-surface-2 data-[state=on]:text-foreground",
				outline:
					"rounded-lg border border-border-strong bg-card text-muted-foreground hover:bg-surface-2 hover:text-foreground data-[state=on]:border-foreground/30 data-[state=on]:bg-surface-2 data-[state=on]:text-foreground",
				segmented:
					"rounded-md text-muted-foreground hover:text-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-card data-[state=on]:ring-1 data-[state=on]:ring-border",
			},
			size: {
				default: "h-8 min-w-8 px-3 text-[13px]",
				sm: "h-7 min-w-7 px-2.5 text-xs",
				lg: "h-9 min-w-9 px-3.5 text-sm",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

function Toggle({
	className,
	variant = "default",
	size = "default",
	...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
	return (
		<TogglePrimitive.Root
			data-slot="toggle"
			className={cn(toggleVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Toggle, toggleVariants };
