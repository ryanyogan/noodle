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
	id,
}: {
	title: React.ReactNode;
	count?: number;
	action?: React.ReactNode;
	id?: string;
}) {
	return (
		<div data-slot="section-header" className="flex min-h-7 items-center justify-between gap-3">
			<h2 id={id} className="inline-flex items-center gap-2 text-sm font-semibold">
				{title}
				{count ? <Badge variant="count">{count}</Badge> : null}
			</h2>
			{action}
		</div>
	);
}

export { Section, SectionHeader };
