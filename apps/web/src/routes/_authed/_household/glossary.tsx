import { Card } from "@noodle/ui/components/card";
import { PageHeader } from "@noodle/ui/components/page-header";
import { createFileRoute } from "@tanstack/react-router";
import { glossaryEntries } from "../../../glossary";

export const Route = createFileRoute("/_authed/_household/glossary")({
	component: GlossaryPage,
});

/** Every word the app uses for money, in plain language, A to Z (ADR-0018). */
function GlossaryPage() {
	return (
		<>
			<PageHeader eyebrow="Household" title="Glossary" className="max-w-2xl" />
			<div className="grid max-w-2xl gap-6">
				<p className="text-sm text-muted-foreground">
					The words Noodle uses for your money, in plain language. A{" "}
					<span className="whitespace-nowrap">“?”</span> beside a word anywhere in the app opens the
					same explanation.
				</p>
				<Card className="p-(--card-pad)">
					<dl className="grid gap-5">
						{glossaryEntries.map(([id, entry]) => (
							<div key={id} id={id} className="grid scroll-mt-24 gap-1 target:rounded-md">
								<dt className="text-[15px] font-semibold">{entry.term}</dt>
								<dd className="grid gap-1 text-sm text-muted-foreground">
									<p>{entry.short}</p>
									{entry.more ? <p>{entry.more}</p> : null}
									{entry.was ? (
										<p className="text-[13px]">Used to be called “{entry.was}”.</p>
									) : null}
								</dd>
							</div>
						))}
					</dl>
				</Card>
			</div>
		</>
	);
}
