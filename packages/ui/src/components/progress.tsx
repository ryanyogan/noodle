import { Progress as ProgressPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "#lib/utils";

// shadcn/ui's Progress (https://ui.shadcn.com/docs/components/progress), radix-nova, on this
// design system's tokens: how far along something is, as role=progressbar. Name it (aria-label,
// or aria-labelledby) and give `getValueLabel` words for its value ("$750 paid down of $1,362").
// The fill is the muted ink at 3:1 against its track (WCAG 1.4.11); Bucket meters use Meter.

function Progress({
	className,
	indicatorClassName,
	value,
	max = 100,
	...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }) {
	const share = Math.min(1, Math.max(0, (value ?? 0) / (max || 1)));
	return (
		<ProgressPrimitive.Root
			data-slot="progress"
			value={value}
			max={max}
			className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
			{...props}
		>
			<ProgressPrimitive.Indicator
				data-slot="progress-indicator"
				className={cn(
					"size-full rounded-full bg-muted-foreground transition-transform duration-(--duration-meter) ease-standard",
					indicatorClassName,
				)}
				style={{ transform: `translateX(-${(1 - share) * 100}%)` }}
			/>
		</ProgressPrimitive.Root>
	);
}

export { Progress };
