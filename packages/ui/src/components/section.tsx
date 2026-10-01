import type * as React from "react";
import { cn } from "#lib/utils";
import { Badge } from "./badge";

/** A titled block of a page. Sections are 32px apart; the header sits 12px above its content. */
function Section({ className, ...props }: React.ComponentProps<"section">) {
	return <section data-slot="section" className={cn("grid gap-3", className)} {...props} />;
}

function SectionHeader({
	title,
	count,
	action,
	help,
	id,
}: {
	title: React.ReactNode;
	count?: number;
	action?: React.ReactNode;
	/** A term's help button, beside the heading rather than in it, so it isn't part of its name. */
	help?: React.ReactNode;
	id?: string;
}) {
	return (
		<div data-slot="section-header" className="flex min-h-7 items-center justify-between gap-3">
			<div className="inline-flex min-w-0 items-center gap-1">
				<h2 id={id} className="inline-flex items-center gap-2 text-sm font-semibold">
					{title}
					{count ? <Badge variant="count">{count}</Badge> : null}
				</h2>
				{help}
			</div>
			{action}
		</div>
	);
}

export { Section, SectionHeader };
