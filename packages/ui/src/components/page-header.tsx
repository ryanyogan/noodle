import type * as React from "react";
import { cn } from "#lib/utils";

/**
 * The top of every screen: an optional eyebrow (a line above the h1, not part of it), the title
 * (the page's only h1), and actions.
 * `leading`/`trailing` sit either side of the title (e.g. previous/next month).
 */
function PageHeader({
	eyebrow,
	title,
	leading,
	trailing,
	actions,
	className,
}: {
	eyebrow?: React.ReactNode;
	title: React.ReactNode;
	leading?: React.ReactNode;
	trailing?: React.ReactNode;
	actions?: React.ReactNode;
	className?: string;
}) {
	return (
		<header
			data-slot="page-header"
			className={cn(
				// Wraps: when a title word and the actions don't fit on one line (320 px phones), the actions
				// drop to their own row instead of squeezing the title mid-word.
				"mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 lg:mb-8",
				className,
			)}
		>
			<div className="flex max-w-full items-center gap-1">
				{leading}
				{/* Phones: the title on the 16 px gutter like everything under it (74c). */}
				<div className="min-w-0 lg:px-0.5">
					{eyebrow ? (
						<p data-slot="page-eyebrow" className="text-[13px] font-medium text-muted-foreground">
							{eyebrow}
						</p>
					) : null}
					<h1 className="text-2xl font-semibold tracking-[-0.025em] text-balance break-words lg:text-[2rem]">
						{title}
					</h1>
				</div>
				{trailing}
			</div>
			{actions ? (
				<div className="ms-auto flex max-w-full flex-wrap items-center justify-end gap-3">
					{actions}
				</div>
			) : null}
		</header>
	);
}

export { PageHeader };
