import type * as React from "react";
import { cn } from "#lib/utils";

export type BucketColor = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** The 36px leading square of a row: a Bucket's icon in its colour, or a neutral monogram. */
function Tile({
	bucket,
	className,
	style,
	...props
}: React.ComponentProps<"span"> & { bucket?: BucketColor }) {
	return (
		<span
			data-slot="tile"
			className={cn(
				"grid size-9 shrink-0 place-items-center rounded-xl text-sm font-semibold [&_svg]:size-4.5",
				bucket
					? "bg-[color-mix(in_oklab,var(--tile)_13%,var(--card))] text-(--tile)"
					: "bg-surface-2 text-muted-foreground",
				className,
			)}
			style={bucket ? { ...style, ["--tile" as string]: `var(--bucket-${bucket})` } : style}
			{...props}
		/>
	);
}

export { Tile };
