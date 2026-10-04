import { Card } from "@noodle/ui/components/card";
import { PageHeader } from "@noodle/ui/components/page-header";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { GlossaryList, GlossarySearch } from "../../../components/glossary";

export const Route = createFileRoute("/_authed/_household/glossary")({
	component: GlossaryPage,
});

/**
 * Every word the app uses for money, in plain language, A to Z (ADR-0018): the same list the help
 * icon opens over a page, here as a page to link to (/glossary#sweep).
 */
function GlossaryPage() {
	const [query, setQuery] = useState("");
	return (
		<>
			<PageHeader eyebrow="Household" title="Glossary" />
			{/* At lg, the explanation and search stay in a left rail beside the words (#47). */}
			<div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-8">
				<div className="grid gap-6 lg:sticky lg:top-6">
					<p className="text-sm text-muted-foreground">
						The words Noodle uses for your money, in plain language. A{" "}
						<span className="whitespace-nowrap">“?”</span> beside a word anywhere in the app opens
						the same explanation.
					</p>
					<GlossarySearch query={query} onQueryChange={setQuery} />
				</div>
				{/* From 1680 px the words run in two columns, A to Z down each, so the page uses its width (#73). */}
				<Card className="min-w-0 p-2 lg:max-w-3xl min-[105rem]:max-w-none">
					<GlossaryList
						query={query}
						className="min-[105rem]:block min-[105rem]:columns-2 min-[105rem]:gap-x-2 min-[105rem]:[&>*]:break-inside-avoid"
					/>
				</Card>
			</div>
		</>
	);
}
