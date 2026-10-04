import type * as React from "react";
import { cn } from "#lib/utils";
import { Card } from "./card";

/** A calm placeholder for a section with nothing in it yet. */
function EmptyState({
	icon,
	title,
	description,
	action,
	className,
}: {
	icon?: React.ReactNode;
	title: React.ReactNode;
	description?: React.ReactNode;
	action?: React.ReactNode;
	className?: string;
}) {
	return (
		<Card
			className={cn(
				"flex flex-col items-center gap-3 px-(--card-pad) py-[calc(var(--card-pad)*2)] text-center",
				className,
			)}
		>
			{icon ? (
				<span className="grid size-10 place-items-center rounded-xl bg-surface-2 text-muted-foreground [&_svg]:size-5">
					{icon}
				</span>
			) : null}
			<div className="grid max-w-sm gap-1">
				<p className="text-[15px] font-semibold">{title}</p>
				{description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
			</div>
			{action ? <div className="mt-1">{action}</div> : null}
		</Card>
	);
}

export { EmptyState };
