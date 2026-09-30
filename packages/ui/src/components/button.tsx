import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "#lib/utils";

const buttonVariants = cva(
	[
		"inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap border font-medium select-none",
		"transition-[background-color,border-color,color,transform] duration-(--duration-fast) ease-standard",
		"active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
		"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
		"[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	],
	{
		variants: {
			variant: {
				default:
					"border-transparent bg-primary text-primary-foreground hover:bg-[color-mix(in_oklab,var(--primary)_88%,var(--brand))]",
				outline: "border-border-strong bg-card text-foreground hover:bg-surface-2",
				secondary: "border-transparent bg-surface-2 text-foreground hover:bg-surface-3",
				ghost: "border-transparent text-muted-foreground hover:bg-surface-2 hover:text-foreground",
				destructive: "border-transparent bg-over-soft text-over-foreground hover:bg-over/15",
				link: "border-transparent px-0 text-muted-foreground hover:text-foreground",
			},
			size: {
				default: "h-9 rounded-xl px-3.5 text-sm",
				sm: "h-7.5 rounded-lg px-2.5 text-[13px]",
				lg: "h-11 rounded-xl px-5 text-[15px]",
				icon: "size-8 rounded-lg",
				"icon-sm": "size-7 rounded-lg",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	asChild = false,
	...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "button";
	return (
		<Comp
			data-slot="button"
			data-variant={variant}
			data-size={size}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
