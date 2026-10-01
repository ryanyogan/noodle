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
			<PageHeader eyebrow="Household" title="Glossary" className="max-w-2xl" />
			<div className="grid max-w-2xl gap-6">
				<p className="text-sm text-muted-foreground">
					The words Noodle uses for your money, in plain language. A{" "}
					<span className="whitespace-nowrap">“?”</span> beside a word anywhere in the app opens the
					same explanation.
				</p>
				<GlossarySearch query={query} onQueryChange={setQuery} />
				<Card className="p-2">
					<GlossaryList query={query} />
				</Card>
			</div>
		</>
	);
}
