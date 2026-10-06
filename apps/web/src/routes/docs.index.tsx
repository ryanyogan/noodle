import { createFileRoute, Link } from "@tanstack/react-router";
import { docsBySection } from "../docs";

export const Route = createFileRoute("/docs/")({ component: DocsHome });

/** The front of the Docs: every article by section, each with its one-line summary. */
function DocsHome() {
	return (
		<div className="grid max-w-[70ch] gap-8">
			<div className="grid gap-2">
				<h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em]">Docs</h1>
				<p className="text-base text-muted-foreground">
					How to get started, how to budget with Noodle, and what each page does. Short where it can
					be, detailed where it helps.
				</p>
			</div>
			{docsBySection.map(({ section, articles }) => (
				<section
					key={section}
					aria-labelledby={`docs-${section}`.replaceAll(" ", "-")}
					className="grid gap-2"
				>
					<h2 id={`docs-${section}`.replaceAll(" ", "-")} className="text-lg font-semibold">
						{section}
					</h2>
					<ul className="grid gap-2">
						{articles.map((article) => (
							<li key={article.slug}>
								<Link
									to="/docs/$slug"
									params={{ slug: article.slug }}
									className="grid gap-0.5 rounded-xl border border-border bg-card px-4 py-3 hover:border-border-strong"
								>
									<span className="font-medium text-foreground">{article.title}</span>
									<span className="text-sm text-muted-foreground">{article.summary}</span>
								</Link>
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}
