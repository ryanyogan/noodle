import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArticleBody } from "../components/docs";
import { findArticle, neighbours } from "../docs";

export const Route = createFileRoute("/docs/$slug")({
	loader: ({ params }) => {
		const article = findArticle(params.slug);
		if (!article) throw notFound();
		return { title: article.title, summary: article.summary };
	},
	head: ({ loaderData }) => ({
		meta: loaderData
			? [
					{ title: `${loaderData.title} · Noodle Docs` },
					{ name: "description", content: loaderData.summary },
				]
			: [],
	}),
	component: DocsArticlePage,
});

const stepLook =
	"grid min-w-0 flex-1 basis-56 gap-0.5 rounded-xl border border-border bg-card px-4 py-3 hover:border-border-strong";

function DocsArticlePage() {
	const { slug } = Route.useParams();
	const article = findArticle(slug);
	if (!article) return null;
	const { previous, next } = neighbours(slug);
	return (
		<div className="flex gap-10">
			<article className="grid min-w-0 max-w-[70ch] flex-1 gap-6">
				<header className="grid gap-2">
					<p className="text-sm font-medium text-subtle-foreground">{article.section}</p>
					<h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] lg:text-[2rem]">
						{article.title}
					</h1>
					<p className="text-lg text-muted-foreground">{article.summary}</p>
				</header>
				<ArticleBody article={article} />
				<nav
					aria-label="More articles"
					className="mt-6 flex flex-wrap gap-3 border-t border-border pt-6"
				>
					{previous ? (
						<Link to="/docs/$slug" params={{ slug: previous.slug }} className={stepLook}>
							<span className="text-xs text-muted-foreground">Previous</span>
							<span className="font-medium">{previous.title}</span>
						</Link>
					) : null}
					{next ? (
						<Link to="/docs/$slug" params={{ slug: next.slug }} className={`${stepLook} text-end`}>
							<span className="text-xs text-muted-foreground">Next</span>
							<span className="font-medium">{next.title}</span>
						</Link>
					) : null}
				</nav>
			</article>
			{article.headings.length > 2 ? (
				<nav
					aria-label="On this page"
					className="sticky top-24 hidden max-h-[calc(100dvh-7rem)] w-52 shrink-0 self-start overflow-y-auto xl:block"
				>
					<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle-foreground">
						On this page
					</p>
					<ul className="grid gap-1.5 text-sm">
						{article.headings.map((heading) => (
							<li key={heading.id}>
								<a href={`#${heading.id}`} className="text-muted-foreground hover:text-foreground">
									{heading.text}
								</a>
							</li>
						))}
					</ul>
				</nav>
			) : null}
		</div>
	);
}
