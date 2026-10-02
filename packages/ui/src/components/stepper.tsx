import type * as React from "react";
import { cn } from "#lib/utils";

// Noodle's own: where a Parent is in a step-by-step flow (the get-started wizard, #53). One line
// says it in words, "Step 3 of 7 · about 2 minutes left", and a row of segments shows it at a
// glance (decorative: the words say the same). An optional status line below reports background
// work ("Reading your spending… 2 of 4 done") as a polite live region, so a screen reader hears it
// change without moving focus.

/** "about 2 minutes left", or "almost done" at none. */
export function minutesLeftLabel(minutes: number): string {
	if (minutes <= 0) return "almost done";
	return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"} left`;
}

function Stepper({
	step,
	total,
	minutesLeft,
	status,
	className,
	...props
}: Omit<React.ComponentProps<"div">, "children"> & {
	/** The current step, from 1. */
	step: number;
	total: number;
	/** Roughly how many minutes are left; leave out to say nothing about time. */
	minutesLeft?: number;
	/** One line on background work, or nothing. */
	status?: React.ReactNode;
}) {
	const current = Math.min(Math.max(step, 1), total);
	return (
		<div data-slot="stepper" className={cn("grid gap-2", className)} {...props}>
			<p data-slot="stepper-label" className="text-[13px] text-muted-foreground tabular-nums">
				<span className="font-medium text-foreground">
					Step {current} of {total}
				</span>
				{minutesLeft === undefined ? null : <> · {minutesLeftLabel(minutesLeft)}</>}
			</p>
			<div aria-hidden="true" className="flex gap-1">
				{Array.from({ length: total }, (_, index) => (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: the segments are positions, never reordered.
						key={index}
						data-state={index + 1 < current ? "done" : index + 1 === current ? "current" : "todo"}
						className={cn(
							"h-1 flex-1 rounded-full bg-surface-3 transition-colors duration-(--duration-fast) ease-standard",
							"data-[state=done]:bg-foreground data-[state=current]:bg-muted-foreground",
						)}
					/>
				))}
			</div>
			<p
				data-slot="stepper-status"
				role="status"
				className={cn("min-h-5 text-[13px] text-muted-foreground", !status && "sr-only")}
			>
				{status}
			</p>
		</div>
	);
}

export { Stepper };
