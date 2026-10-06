import { Button } from "@noodle/ui/components/button";
import { Logo } from "@noodle/ui/components/logo";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { List } from "lucide-react";
import { useState } from "react";
import { DocsNav, DocsSearch } from "../components/docs";

/**
 * The Docs (issue 126): public, outside the app's frame, so they read the same signed in or out
 * and show nothing of a Household. A computer has the list of articles beside the one being read;
 * a phone has the article first and the list behind "All docs".
 */
export const Route = createFileRoute("/docs")({
	head: () => ({
		meta: [
			{ title: "Docs · Noodle" },
			{
				name: "description",
				content: "How to budget with Noodle: getting started, every page, and what the words mean.",
			},
		],
	}),
	component: DocsLayout,
});

function DocsLayout() {
	const [listOpen, setListOpen] = useState(false);
	return (
		<div className="min-h-dvh">
			<header className="sticky top-0 z-10 border-b border-border bg-background pt-(--safe-top)">
				{/* One line above the search on the narrowest phone (320): the gap tightens and "All docs" is
				    its icon alone there, still named for a screen reader. */}
				<div className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center gap-x-2 gap-y-2 px-(--gutter) py-3 min-[22.5rem]:gap-x-4">
					<Link to="/docs" className="flex items-center gap-2 rounded-lg">
						<Logo />
						<span className="text-base font-medium text-muted-foreground">Docs</span>
					</Link>
					<div className="flex flex-1 items-center justify-end gap-1 min-[22.5rem]:gap-2 lg:order-last lg:flex-none">
						<Button
							variant="outline"
							size="sm"
							className="lg:hidden"
							onClick={() => setListOpen(true)}
						>
							<List aria-hidden="true" />
							<span className="max-[22.5rem]:sr-only">All docs</span>
						</Button>
						<Button variant="ghost" size="sm" className="max-[22.5rem]:px-1.5" asChild>
							<a href="/">Open Noodle</a>
						</Button>
					</div>
					<DocsSearch className="w-full lg:mx-auto lg:w-auto lg:max-w-md lg:flex-1" />
				</div>
			</header>
			<div className="mx-auto flex w-full max-w-[90rem] gap-10 px-(--gutter) pt-6 pb-[calc(var(--safe-bottom)+48px)] lg:pt-10">
				<aside className="sticky top-24 hidden max-h-[calc(100dvh-7rem)] w-60 shrink-0 self-start overflow-y-auto lg:block">
					<DocsNav label="All docs" />
				</aside>
				<main className="min-w-0 flex-1">
					<Outlet />
				</main>
			</div>
			<Sheet open={listOpen} onOpenChange={setListOpen}>
				<SheetContent>
					<SheetHeader title="All docs" />
					<DocsNav label="Articles" onPick={() => setListOpen(false)} />
				</SheetContent>
			</Sheet>
		</div>
	);
}
