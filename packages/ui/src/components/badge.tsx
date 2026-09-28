import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "#lib/utils";

/** A small status or label pill. Pace and over are the only coloured states. */
const badgeVariants = cva(
	"inline-flex h-5 w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium [&>svg]:size-3",
	{
		variants: {
			variant: {
				default: "bg-surface-2 text-muted-foreground",
				count: "bg-surface-3 px-1.75 font-semibold text-muted-foreground",
				pace: "bg-pace-soft text-pace-foreground",
				over: "bg-over-soft text-over",
				brand: "bg-brand-soft text-brand",
			},
			dot: {
				true: "before:size-1.5 before:rounded-full before:bg-current before:content-['']",
				false: "",
			},
		},
		defaultVariants: { variant: "default", dot: false },
	},
);

function Badge({
	className,
	variant,
	dot,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
	return (
		<span
			data-slot="badge"
			data-variant={variant}
			className={cn(badgeVariants({ variant, dot }), className)}
			{...props}
		/>
	);
}

export { Badge, badgeVariants };
