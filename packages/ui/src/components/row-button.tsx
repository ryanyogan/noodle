import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "#lib/utils";
import type { BucketColor } from "./tile";

// Noodle's own (#56): a button that is a whole row or tile rather than a labelled control, so its
// content is laid out by the caller (a name over a figure, a Tile beside two lines) and it is as
// tall as that content. Button is for a word or an icon at a control height; this is for the
// rest, so no page writes a raw `<button>`. `asChild` puts the look on a link.
//
// `aria-disabled` dims it and stops the hover, but it can still be pressed (Quick Add's Buckets
// before an amount is typed say what is missing); `disabled` takes it out altogether.

const hover = "[&:not([aria-disabled=true])]:hover:bg-surface-2";

const rowButtonVariants = cva(
	[
		"text-start transition-[background-color,border-color,opacity,transform] duration-(--duration-fast) ease-standard",
		"focus-visible:outline-2 focus-visible:outline-ring",
		"disabled:pointer-events-none aria-disabled:opacity-45",
	],
	{
		variants: {
			variant: {
				// A row on a card that opens something: a Report's line that drills in.
				row: cn("flex w-full items-center gap-3 rounded-xl py-2 max-lg:min-h-11", hover),
				// A row of a List, edge to edge: a Transaction.
				list: "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-(--card-pad) py-3.5 hover:bg-surface-2/60 focus-visible:-outline-offset-2",
				// A row with its own border, on its own: "3 lumpy months ahead".
				bordered:
					"flex w-full items-center justify-between gap-4 rounded-xl border px-(--card-pad) py-3 text-sm hover:bg-surface-2/60",
				// A bordered tile in a grid of choices: a Bucket in Quick Add, a source in Cover.
				// Its hover is added below: neutral, or a tint of the Bucket's colour when `bucket` is given.
				tile: "grid items-center gap-x-2.5 rounded-xl border bg-card px-2.5 py-2 focus-visible:outline-offset-2 [&:not([aria-disabled=true])]:active:scale-[0.98]",
				// A tile without a border, on the soft ground: one small chart of several.
				soft: "grid w-full gap-2 rounded-xl bg-surface-2/60 p-3 hover:bg-surface-2",
				// The value at the end of a row, which opens its editor.
				value: cn(
					"inline-flex min-h-9 items-center gap-1 rounded-lg ps-2 pe-1 max-lg:min-h-11",
					hover,
				),
				// A key of the amount keypad.
				key: "grid h-13 place-items-center rounded-xl text-center text-2xl font-medium tabular-nums select-none hover:bg-surface-2 focus-visible:outline-offset-2 active:scale-[0.96] active:bg-surface-3",
			},
		},
		defaultVariants: { variant: "row" },
	},
);

const tileHover = cn("[&:not([aria-disabled=true])]:hover:border-border-strong", hover);
const tileHoverTinted = cn(
	"[&:not([aria-disabled=true])]:hover:border-[color-mix(in_oklab,var(--tile)_45%,var(--border))]",
	"[&:not([aria-disabled=true])]:hover:bg-[color-mix(in_oklab,var(--tile)_5%,var(--card))]",
);

function RowButton({
	className,
	variant = "row",
	bucket,
	asChild = false,
	style,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof rowButtonVariants> & {
		asChild?: boolean;
		/** A `tile` for a Bucket: its hover takes a tint of the Bucket's colour. */
		bucket?: BucketColor;
	}) {
	const Comp = asChild ? Slot.Root : "button";
	return (
		<Comp
			data-slot="row-button"
			data-variant={variant}
			type={asChild ? undefined : "button"}
			className={cn(
				rowButtonVariants({ variant }),
				variant === "tile" && (bucket ? tileHoverTinted : tileHover),
				className,
			)}
			style={bucket ? { ...style, ["--tile" as string]: `var(--bucket-${bucket})` } : style}
			{...props}
		/>
	);
}

export { RowButton, rowButtonVariants };
