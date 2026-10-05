import { SplitLayout, SplitMain, SplitRail } from "@noodle/ui/components/layout";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

/** The opening tag of the element with this `data-slot`. */
const tag = (html: string, slot: string) =>
	html.match(new RegExp(`<[a-z]+ [^>]*data-slot="${slot}"[^>]*>`))?.[0] ?? "";

describe("SplitLayout", () => {
	it("puts main before the rail, and the rail has no scroll of its own", () => {
		const html = renderToStaticMarkup(
			h(SplitLayout, null, h(SplitMain, null, "Buckets"), h(SplitRail, null, "Free to Spend")),
		);
		expect(html.indexOf("Buckets")).toBeLessThan(html.indexOf("Free to Spend"));
		const rail = tag(html, "split-rail");
		expect(rail).not.toMatch(/overflow|max-h/);
		// Sticky only once it has measured itself and fits the window.
		expect(rail).toContain('data-fits="false"');
		expect(rail).toContain("lg:data-[fits=true]:sticky");
		expect(tag(html, "split-layout")).toContain("var(--rail-width)");
	});

	it("stacks the rail first on phones when asked", () => {
		const html = renderToStaticMarkup(
			h(SplitLayout, { stack: "rail" }, h(SplitMain, null, "a"), h(SplitRail, null, "b")),
		);
		expect(tag(html, "split-rail")).toContain("max-lg:order-first");
	});

	it("dissolves both columns on phones so each block's order places it", () => {
		const html = renderToStaticMarkup(
			h(SplitLayout, { stack: "children" }, h(SplitMain, null, "a"), h(SplitRail, null, "b")),
		);
		expect(tag(html, "split-main")).toContain("contents lg:grid");
		expect(tag(html, "split-rail")).toContain("contents lg:grid");
	});
});
