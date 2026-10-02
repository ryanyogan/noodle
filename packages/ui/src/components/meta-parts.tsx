import type * as React from "react";

import { cn } from "#lib/utils";

/**
 * Short facts on one line, joined by "·". When the line wraps, no line starts with a lone "·":
 * each part draws its separator before itself, and the list is shifted left by one separator
 * width inside a clipping box, so the separator of whichever part starts a line is cut off.
 */
export function MetaParts({ parts, className }: { parts: React.ReactNode[]; className?: string }) {
	const shown = parts.filter(
		(part) => part !== null && part !== undefined && part !== false && part !== "",
	);
	return (
		<span data-slot="meta-parts" className={cn("block min-w-0 overflow-hidden", className)}>
			<span className="-ms-[1.25em] flex flex-wrap items-center gap-y-0.5">
				{shown.map((part, index) => (
					<span
						// The parts are plain facts in a fixed order; their positions are stable keys.
						// biome-ignore lint/suspicious/noArrayIndexKey: see above
						key={index}
						className="inline-flex min-w-0 items-center before:w-[1.25em] before:shrink-0 before:text-center before:content-['·']"
					>
						{part}
					</span>
				))}
			</span>
		</span>
	);
}
