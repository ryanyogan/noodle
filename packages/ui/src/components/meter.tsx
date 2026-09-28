import type * as React from "react";
import { cn } from "#lib/utils";
import type { BucketColor } from "./tile";

/**
 * What's left of a Bucket, draining left as money is spent, with a marigold tick where Pace
 * says it should be today. The stretch spent ahead of Pace is hatched; an overspent Bucket
 * shows an empty, tinted track. Both inputs are shares of the Bucket (0–1).
 */
function Meter({
	left,
	paceLeft,
	bucket,
	over = false,
	className,
}: {
	left: number;
	paceLeft: number;
	bucket: BucketColor;
	over?: boolean;
	className?: string;
}) {
	const level = clamp(left);
	const pace = clamp(paceLeft);
	const ahead = over ? 0 : Math.max(0, pace - level);
	return (
		<div
			data-slot="meter"
			aria-hidden="true"
			className={cn(
				"relative h-1.5 rounded-full",
				over ? "bg-over-soft" : "bg-surface-3",
				className,
			)}
			style={{ ["--meter" as string]: `var(--bucket-${bucket})` } as React.CSSProperties}
		>
			<div
				className="absolute inset-y-0 left-0 rounded-full bg-(--meter) transition-[width] duration-(--duration-meter) ease-spring"
				style={{ width: pct(level) }}
			/>
			<div
				className="absolute inset-y-0 rounded-r-full bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--pace)_70%,transparent)_0_1.5px,transparent_1.5px_4px)] transition-[left,width] duration-(--duration-meter) ease-spring"
				style={{ left: pct(level), width: pct(ahead) }}
			/>
			<div
				className="absolute -inset-y-1 -ml-px w-0.5 rounded-full bg-pace shadow-[0_0_0_2px_var(--card)] transition-[left] duration-(--duration-base) ease-standard"
				style={{ left: pct(pace) }}
			/>
		</div>
	);
}

const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export { Meter };
