import * as React from "react";
import { cn } from "#lib/utils";
import { Badge } from "./badge";

/** A titled block of a page. Sections are 32px apart; the header sits 12px above its content. */
function Section({ className, ...props }: React.ComponentProps<"section">) {
	return <section data-slot="section" className={cn("grid gap-3", className)} {...props} />;
}

/** The heading level a SectionHeader takes: 2 on a page, 3 inside a SectionGroup. */
const SectionLevel = React.createContext<2 | 3>(2);

/**
 * A group of Sections under one short heading (a settings page's People, Reminders, Setup). Its
 * Sections' headings sit a level below it, so the page reads as an outline.
 */
function SectionGroup({
	title,
	id,
	className,
	children,
	...props
}: React.ComponentProps<"section"> & { title: React.ReactNode; id: string }) {
	return (
		<section
			data-slot="section-group"
			aria-labelledby={id}
			className={cn("grid gap-5", className)}
			{...props}
		>
			<h2 id={id} className="text-base font-semibold">
				{title}
			</h2>
			<SectionLevel.Provider value={3}>{children}</SectionLevel.Provider>
		</section>
	);
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
	const Heading = React.useContext(SectionLevel) === 3 ? "h3" : "h2";
	return (
		<div data-slot="section-header" className="flex min-h-7 items-center justify-between gap-3">
			<div className="flex min-w-0 flex-wrap items-center gap-1">
				<Heading
					id={id}
					className="inline-flex min-w-0 flex-wrap items-center gap-x-2 text-sm font-semibold"
				>
					{title}
					{count ? <Badge variant="count">{count}</Badge> : null}
				</Heading>
				{help}
			</div>
			{action}
		</div>
	);
}

export { Section, SectionGroup, SectionHeader };
