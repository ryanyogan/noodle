import { Card } from "@noodle/ui/components/card";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { LinkTab, LinkTabs } from "@noodle/ui/components/tabs";
import { Link, type LinkProps, Outlet } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";

/** One page of a section: its tab's words and where it goes (build `link` with `linkOptions`). */
/** `badge` sits after the label, e.g. how many wait in Review. */
export type SectionTab = { label: string; link: LinkProps; badge?: ReactNode };

/**
 * A section with sibling pages (the Plan's parts, and so on): one header and one row of tabs that
 * stay put, and the current page beneath them. It belongs on the section's layout route, so going
 * between tabs changes only what's below them: the header isn't re-mounted, and the page keeps
 * its scroll position.
 */
export function SectionLayout({
	top,
	eyebrow,
	title,
	leading,
	actions,
	tabs,
	tabsLabel,
	children = <Outlet />,
	...props
}: {
	/** A row above the header, e.g. the switch between a month and its Plan. */
	top?: ReactNode;
	eyebrow?: ReactNode;
	title: ReactNode;
	/** Beside the title, e.g. a back link on phones. */
	leading?: ReactNode;
	actions?: ReactNode;
	/** The section's pages. Without them it's the same header over one page (This Month). */
	tabs?: SectionTab[];
	/** Names the tabs' `<nav>`, e.g. "Plan pages". */
	tabsLabel?: string;
	/** The current page. Defaults to the route's outlet; a pending layout passes its skeleton. */
	children?: ReactNode;
} & Omit<ComponentProps<"div">, "title" | "children">) {
	return (
		<div data-slot="section-layout" {...props}>
			<div data-slot="section-layout-header">
				{top}
				<PageHeader eyebrow={eyebrow} title={title} leading={leading} actions={actions} />
				{tabs ? (
					<LinkTabs aria-label={tabsLabel} className="mb-6">
						{tabs.map((tab) => (
							<LinkTab key={tab.label} asChild>
								{/* The link marks itself current (aria-current="page") on its own page only, whatever
								    the page's search (`?lever=`, `?kind=`): exact matching alone compares that too. A tab
							    leaves the scroll where it is: only the part below the tabs changes. */}
								<Link
									{...tab.link}
									activeOptions={{ exact: true, includeSearch: false }}
									resetScroll={false}
								>
									{tab.label}
									{tab.badge}
								</Link>
							</LinkTab>
						))}
					</LinkTabs>
				) : null}
			</div>
			<div data-slot="section-layout-outlet">{children}</div>
		</div>
	);
}

/**
 * A section page that's slow to load, in the outlet only: the header and tabs above it stay as
 * they are. Give it to each page of a section as its `pendingComponent`.
 */
export function SectionPending() {
	return (
		<div
			role="status"
			aria-label="Loading"
			className="grid max-w-2xl animate-enter gap-8 lg:max-w-none"
		>
			<Card className="grid gap-3 p-(--card-pad)">
				<Skeleton className="h-3.5 w-24" />
				<Skeleton className="h-10 w-36" />
				<Skeleton className="h-3.5 w-52" />
			</Card>
			<div className="grid gap-3">
				<Skeleton className="h-4 w-28" />
				<Card>
					{[0, 1, 2].map((row) => (
						<div
							key={row}
							className="flex items-center gap-3 border-t px-(--card-pad) py-3.5 first:border-t-0"
						>
							<Skeleton className="size-9 rounded-xl" />
							<div className="grid flex-1 gap-2">
								<Skeleton className="h-3.5 w-1/3" />
								<Skeleton className="h-3 w-1/2" />
							</div>
							<Skeleton className="h-4 w-14" />
						</div>
					))}
				</Card>
			</div>
		</div>
	);
}
