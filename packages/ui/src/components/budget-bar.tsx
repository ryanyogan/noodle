import type * as React from "react";
import { cn } from "#lib/utils";
import type { BucketColor } from "./tile";

/**
 * The one bar in Noodle (#64). It fills as money is used up or progress is made: a Bucket fills
 * with what's spent out of Available, a Goal with what's saved toward its target.
 *
 * - `marker` is a share (0–1) drawn as a thin ink line: on a Bucket, Today, where even spending
 *   would be by now.
 * - `state` comes from the domain (a Bucket's status), never worked out here, so the bar and the
 *   badge beside it always agree. "ahead" turns the stretch past the marker marigold and striped;
 *   "over" fills the whole bar in the over ink, striped. Stripes, so colour isn't the only signal.
 * - It is `role="meter"`, named by `label`, with `valueText` saying the value in words
 *   ("$280 spent of $600, $320 left"). Put the same words next to it on screen.
 */
function BudgetBar({
	value,
	max,
	label,
	valueText,
	bucket,
	marker,
	state,
	className,
}: {
	value: number;
	max: number;
	label: string;
	valueText: string;
	/** The fill's colour: the Bucket's (or a Goal's Bucket). Without it, the brand ink. */
	bucket?: BucketColor;
	marker?: number;
	state?: "ahead" | "over";
	className?: string;
}) {
	const share = max > 0 ? clamp(value / max) : value > 0 ? 1 : 0;
	const at = marker === undefined ? undefined : clamp(marker);
	const over = state === "over";
	// Only the stretch past Today is "ahead"; what came before it is ordinary spending.
	const ahead = state === "ahead" && at !== undefined ? Math.max(0, share - at) : 0;
	const base = over ? 1 : share - ahead;
	return (
		// biome-ignore lint/a11y/useSemanticElements: a native <meter> can't hold the Today line or the stripes, and its look differs per browser.
		<div
			role="meter"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={Math.max(0, max)}
			aria-valuenow={Math.min(Math.max(0, value), Math.max(0, max))}
			aria-valuetext={valueText}
			data-slot="budget-bar"
			data-state={state}
			className={cn("relative h-2 w-full rounded-full bg-surface-3", className)}
			style={
				{
					["--bar" as string]: bucket ? `var(--bucket-${bucket})` : "var(--brand)",
				} as React.CSSProperties
			}
		>
			<div className="absolute inset-0 overflow-hidden rounded-full">
				<div
					data-slot="budget-bar-fill"
					className={cn(
						"absolute inset-y-0 left-0 transition-[width] duration-(--duration-meter) ease-spring",
						over ? `bg-over ${STRIPES}` : "bg-(--bar)",
					)}
					style={{ width: pct(base) }}
				/>
				{ahead > 0 ? (
					<div
						data-slot="budget-bar-ahead"
						className={cn(
							"absolute inset-y-0 bg-pace transition-[left,width] duration-(--duration-meter) ease-spring",
							STRIPES,
						)}
						style={{ left: pct(base), width: pct(ahead) }}
					/>
				) : null}
			</div>
			{at === undefined ? null : (
				<div
					data-slot="budget-bar-marker"
					className="absolute -inset-y-1 -ml-px w-0.5 rounded-full bg-foreground shadow-[0_0_0_2px_var(--card)] transition-[left] duration-(--duration-base) ease-standard"
					style={{ left: pct(at) }}
				/>
			)}
		</div>
	);
}

/** Light diagonal stripes over a fill: the "past Today" and "over" states, readable without colour. */
const STRIPES =
	"bg-[image:repeating-linear-gradient(135deg,transparent_0_3px,color-mix(in_oklab,var(--card)_45%,transparent)_3px_5px)]";

/**
 * A key for the bar, in words: the Today line, spent, left. Shown where bars first appear; it
 * replaces a paragraph of explanation.
 */
function BudgetBarKey({ className }: { className?: string }) {
	return (
		<ul
			aria-label="How to read the bars"
			className={cn(
				"flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground",
				className,
			)}
		>
			<li className="flex items-center gap-1.5">
				<span aria-hidden="true" className="h-2 w-4 rounded-full bg-muted-foreground" />
				Spent
			</li>
			<li className="flex items-center gap-1.5">
				<span aria-hidden="true" className="h-2 w-4 rounded-full bg-surface-3" />
				Left
			</li>
			<li className="flex items-center gap-1.5">
				<span aria-hidden="true" className="h-3.5 w-0.5 rounded-full bg-foreground" />
				Today, if you spent evenly
			</li>
			<li className="flex items-center gap-1.5">
				<span aria-hidden="true" className={cn("h-2 w-4 rounded-full bg-pace", STRIPES)} />
				Ahead of pace
			</li>
		</ul>
	);
}

const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export { BudgetBar, BudgetBarKey };
