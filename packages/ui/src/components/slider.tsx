import { Slider as SliderPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Slider (https://ui.shadcn.com/docs/components/slider), radix-nova, on this design
// system's tokens, for one value. The thumb is the role=slider: name it with `label`, and say its
// value in words with `valueText` ("$400"). Arrow keys move one step, Page Up/Down ten, Home/End
// to the ends.

function Slider({
	className,
	label,
	valueText,
	...props
}: Omit<React.ComponentProps<typeof SliderPrimitive.Root>, "aria-label"> & {
	label: string;
	valueText?: string;
}) {
	return (
		<SliderPrimitive.Root
			data-slot="slider"
			className={cn(
				"relative flex h-6 w-full touch-pan-y items-center select-none data-disabled:opacity-50",
				className,
			)}
			{...props}
		>
			<SliderPrimitive.Track
				data-slot="slider-track"
				className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-surface-3"
			>
				<SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-brand" />
			</SliderPrimitive.Track>
			<SliderPrimitive.Thumb
				data-slot="slider-thumb"
				aria-label={label}
				aria-valuetext={valueText}
				className={cn(
					"block size-5 cursor-grab rounded-full border-2 border-brand bg-card shadow-card",
					"transition-[box-shadow] duration-(--duration-fast) hover:ring-4 hover:ring-brand-soft active:cursor-grabbing",
					"focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
				)}
			/>
		</SliderPrimitive.Root>
	);
}

export { Slider };
