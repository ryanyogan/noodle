import { type Block, blockText, parseBlocks, splitFrontmatter } from "./markdown";

/**
 * The Docs (issue 126): one Markdown file per article in ./articles, named for its address
 * (`this-month.md` is /docs/this-month). Each starts with `title`, `summary`, `section` and
 * `order` between `---` lines. This one index, made from those files when the app is built,
 * drives the list of articles, Previous and Next, and the search. To add an article, add a file.
 */
export const docsSections = [
	"Getting started",
	"Budgeting basics",
	"Features",
	"How-to",
	"Reference",
] as const;
export type DocsSection = (typeof docsSections)[number];

export type DocsArticle = {
	slug: string;
	title: string;
	summary: string;
	section: DocsSection;
	order: number;
	blocks: Block[];
	/** The h2 headings, for "On this page". */
	headings: { id: string; text: string }[];
};

type Indexed = { title: string; headings: string; summary: string; body: string; shown: string };

const files = import.meta.glob<string>("./articles/*.md", {
	query: "?raw",
	import: "default",
	eager: true,
});

export function readArticle(path: string, source: string): DocsArticle {
	const slug = path.replace(/^.*\//, "").replace(/\.md$/, "");
	const { fields, body } = splitFrontmatter(source);
	const section = docsSections.find((name) => name === fields.section);
	if (!fields.title || !fields.summary || !section || !Number.isFinite(Number(fields.order))) {
		throw new Error(`Docs article ${slug} needs title, summary, section and order`);
	}
	const blocks = parseBlocks(body);
	return {
		slug,
		title: fields.title,
		summary: fields.summary,
		section,
		order: Number(fields.order),
		blocks,
		headings: blocks.flatMap((b) =>
			b.kind === "heading" && b.level === 2 ? [{ id: b.id, text: b.text }] : [],
		),
	};
}

/** Every article, in reading order: by section, then by `order`. */
export const docsArticles: DocsArticle[] = Object.entries(files)
	.map(([path, source]) => readArticle(path, source))
	.sort(
		(a, b) =>
			docsSections.indexOf(a.section) - docsSections.indexOf(b.section) ||
			a.order - b.order ||
			a.title.localeCompare(b.title),
	);

export const docsBySection = docsSections
	.map((section) => ({ section, articles: docsArticles.filter((a) => a.section === section) }))
	.filter((group) => group.articles.length > 0);

export const findArticle = (slug: string) => docsArticles.find((a) => a.slug === slug);

export function neighbours(slug: string) {
	const at = docsArticles.findIndex((a) => a.slug === slug);
	return { previous: docsArticles[at - 1], next: at < 0 ? undefined : docsArticles[at + 1] };
}

function indexArticle(article: DocsArticle): Indexed {
	const shown = article.blocks
		.filter((b) => b.kind !== "heading")
		.map(blockText)
		.join(" ");
	return {
		title: article.title.toLowerCase(),
		headings: article.blocks
			.filter((b) => b.kind === "heading")
			.map(blockText)
			.join(" ")
			.toLowerCase(),
		summary: article.summary.toLowerCase(),
		body: shown.toLowerCase(),
		shown,
	};
}

const searchIndex = new Map(docsArticles.map((article) => [article.slug, indexArticle(article)]));

export type DocsHit = { article: DocsArticle; snippet: string; score: number };

/** The words around the first place `word` is in the article, else its summary. */
function snippetFor(article: DocsArticle, entry: Indexed, words: string[]) {
	const at = words.map((w) => entry.body.indexOf(w)).find((i) => i >= 0);
	if (at === undefined) return article.summary;
	const start = Math.max(0, entry.shown.lastIndexOf(" ", Math.max(0, at - 50)));
	const end = entry.shown.indexOf(" ", Math.min(entry.shown.length, at + 90));
	const text = entry.shown.slice(start, end < 0 ? undefined : end).trim();
	return `${start > 0 ? "… " : ""}${text}${end >= 0 ? " …" : ""}`;
}

/**
 * Articles with every word of `query` in them, best first: a word in the title counts most, then
 * a heading, the summary, the text.
 */
export function searchDocs(query: string, articles: DocsArticle[] = docsArticles): DocsHit[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];
	const hits: DocsHit[] = [];
	for (const article of articles) {
		const entry = searchIndex.get(article.slug) ?? indexArticle(article);
		let score = 0;
		for (const word of words) {
			const found =
				(entry.title.includes(word) ? 10 : 0) +
				(entry.headings.includes(word) ? 5 : 0) +
				(entry.summary.includes(word) ? 3 : 0) +
				(entry.body.includes(word) ? 1 : 0);
			if (found === 0) {
				score = 0;
				break;
			}
			score += found;
		}
		if (score > 0) hits.push({ article, snippet: snippetFor(article, entry, words), score });
	}
	return hits.sort((a, b) => b.score - a.score).slice(0, 8);
}
