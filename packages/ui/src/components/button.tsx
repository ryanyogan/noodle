import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "#lib/utils";

// One control height: Button `default`, Input, SelectTrigger `default`, Combobox and DatePicker are
// all 36px (h-9) from lg and 44px below it, so a Button beside a field needs no height class.

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
				default: "h-9 rounded-xl px-3.5 text-sm max-lg:h-11 max-lg:min-w-11",
				sm: "h-7.5 rounded-lg px-2.5 text-[13px] max-lg:h-11 max-lg:min-w-11",
				lg: "h-11 rounded-xl px-5 text-[15px]",
				icon: "size-8 rounded-lg max-lg:size-11",
				"icon-sm": "size-7 rounded-lg max-lg:size-11",
				// Square at the control height, for an icon button beside an Input.
				"icon-lg": "size-9 rounded-xl max-lg:size-11",
				// `sm` whose words may run to a second line: a long name inside the label.
				wrap: "h-auto min-h-8 max-w-full rounded-lg px-2.5 py-1.5 text-start text-[13px] whitespace-normal max-lg:min-h-11 max-lg:min-w-11",
				// A filter that's on, with an × to take it off. Use with variant="secondary".
				chip: "h-7 gap-1 rounded-full ps-2.5 pe-1.5 text-xs",
				// TermHelp's "?": 24px, round, with a 44px hit area on phones from an ::after box, centred
				// on it and kept over the positioned elements that follow (as Switch's is).
				help: "relative -my-1 size-6 rounded-full max-lg:z-1 max-lg:after:absolute max-lg:after:inset-[calc(50%-22px)]",
				// A few words inside a sentence that do something. Use with variant="link".
				inline:
					"h-auto rounded-sm p-0 text-[length:inherit] underline underline-offset-2 active:scale-100",
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
