import type * as React from "react";
import { cn } from "#lib/utils";

/**
 * The top of every screen: an optional eyebrow, the title (the page's only h1), and actions.
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
			className={cn("mb-6 flex items-center justify-between gap-4 lg:mb-8", className)}
		>
			<div className="flex min-w-0 items-center gap-1">
				{leading}
				<h1 className="min-w-0 px-0.5 text-2xl font-semibold tracking-[-0.025em] lg:text-[2rem]">
					{eyebrow ? (
						<span className="block text-[13px] font-medium tracking-normal text-muted-foreground">
							{eyebrow}
						</span>
					) : null}
					<span className="line-clamp-2 text-balance break-words">{title}</span>
				</h1>
				{trailing}
			</div>
			{actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
		</header>
	);
}

export { PageHeader };
