import { describe, expect, it } from "vitest";
import { docsArticles, neighbours, readArticle, searchDocs } from "./index";
import { parseBlocks } from "./markdown";

const fixture = (slug: string, title: string, summary: string, body: string) =>
	readArticle(
		`./articles/${slug}.md`,
		`---\ntitle: ${title}\nsummary: ${summary}\nsection: Features\norder: 1\n---\n\n${body}`,
	);

describe("Docs", () => {
	it("reads every article, each with an address of its own", () => {
		expect(docsArticles.length).toBeGreaterThanOrEqual(4);
		expect(new Set(docsArticles.map((a) => a.slug)).size).toBe(docsArticles.length);
		for (const article of docsArticles) expect(article.blocks.length).toBeGreaterThan(0);
	});

	it("gives each article in a section a place of its own in the order", () => {
		const places = docsArticles.map((a) => `${a.section} ${a.order}`);
		expect(new Set(places).size).toBe(places.length);
	});

	it("links between articles only go to articles that exist", () => {
		const slugs = new Set(docsArticles.map((a) => a.slug));
		for (const article of docsArticles) {
			const hrefs = JSON.stringify(article.blocks).match(/"href":"\/docs\/[^"#]*/g) ?? [];
			for (const href of hrefs)
				expect(slugs, article.slug).toContain(href.replace('"href":"/docs/', ""));
		}
	});

	it("finds the articles with a word in their text", () => {
		// Which article comes first is not pinned here: any article may have a "Lumpy months" heading.
		const lumpy = searchDocs("lumpy");
		const hit = lumpy.find((h) => h.article.slug === "how-to-budget");
		expect(hit?.snippet.toLowerCase()).toContain("lumpy");
		expect(searchDocs("this month").map((h) => h.article.slug)).toContain("this-month");
		expect(searchDocs("zzzz")).toEqual([]);
	});

	it("ranks a word in the title first, then a heading, the summary, the text", () => {
		const articles = [
			fixture("in-text", "Alpha", "About alpha.", "Some wombat here."),
			fixture("in-summary", "Beta", "A wombat summary.", "Nothing more."),
			fixture("in-heading", "Gamma", "About gamma.", "## Wombat days\n\nNothing more."),
			fixture("in-title", "Wombat", "About it.", "Nothing more."),
			fixture("elsewhere", "Delta", "About delta.", "Nothing more."),
		];
		expect(searchDocs("wombat", articles).map((h) => h.article.slug)).toEqual([
			"in-title",
			"in-heading",
			"in-summary",
			"in-text",
		]);
		// Every word must be in the article.
		expect(searchDocs("wombat days", articles).map((h) => h.article.slug)).toEqual(["in-heading"]);
		expect(searchDocs("wombat", articles)[3]?.snippet).toContain("wombat");
	});

	it("runs Previous and Next through the reading order", () => {
		const first = docsArticles[0];
		expect(first && neighbours(first.slug).previous).toBeUndefined();
		expect(first && neighbours(first.slug).next).toBe(docsArticles[1]);
	});

	it("reads headings, lists, notes, bold and links", () => {
		expect(parseBlocks("## A b\n\n- one **two**\n- [x](/docs/y)\n\n> note\n\n1. a\n2. b")).toEqual([
			{ kind: "heading", level: 2, id: "a-b", text: "A b" },
			{
				kind: "list",
				ordered: false,
				items: [["one ", { bold: "two" }], [{ text: "x", href: "/docs/y" }]],
			},
			{ kind: "note", inline: ["note"] },
			{ kind: "list", ordered: true, items: [["a"], ["b"]] },
		]);
	});
});
