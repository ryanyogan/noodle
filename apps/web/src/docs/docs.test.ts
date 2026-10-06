import { describe, expect, it } from "vitest";
import { docsArticles, neighbours, searchDocs } from "./index";
import { parseBlocks } from "./markdown";

describe("Docs", () => {
	it("reads every article, each with an address of its own", () => {
		expect(docsArticles.length).toBeGreaterThanOrEqual(4);
		expect(new Set(docsArticles.map((a) => a.slug)).size).toBe(docsArticles.length);
		for (const article of docsArticles) expect(article.blocks.length).toBeGreaterThan(0);
	});

	it("links between articles only go to articles that exist", () => {
		const slugs = new Set(docsArticles.map((a) => a.slug));
		for (const article of docsArticles) {
			const hrefs = JSON.stringify(article.blocks).match(/"href":"\/docs\/[^"#]*/g) ?? [];
			for (const href of hrefs)
				expect(slugs, article.slug).toContain(href.replace('"href":"/docs/', ""));
		}
	});

	it("finds an article by a word in its text, the title counting most", () => {
		expect(searchDocs("lumpy")[0]?.article.slug).toBe("how-to-budget");
		expect(searchDocs("lumpy")[0]?.snippet.toLowerCase()).toContain("lumpy");
		expect(searchDocs("this month")[0]?.article.slug).toBe("this-month");
		expect(searchDocs("zzzz")).toEqual([]);
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
