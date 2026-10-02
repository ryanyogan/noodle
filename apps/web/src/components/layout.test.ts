import { MasterDetail, SplitLayout, SplitMain, SplitRail } from "@noodle/ui/components/layout";
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

describe("MasterDetail", () => {
	const labels = { listLabel: "Buckets", detailLabel: "Bucket" };

	it("shows the list and the empty state while nothing is picked", () => {
		const html = renderToStaticMarkup(
			h(MasterDetail, { ...labels, list: "Groceries", empty: "Pick a Bucket to see it" }),
		);
		expect(html).toContain("Pick a Bucket to see it");
		// On phones only the list shows.
		expect(tag(html, "master-detail-list")).not.toContain("max-lg:hidden");
		expect(tag(html, "master-detail-detail")).toContain("max-lg:hidden");
	});

	it("shows the detail, and on phones only the detail, once one is picked", () => {
		const html = renderToStaticMarkup(
			h(MasterDetail, { ...labels, list: "Groceries", detail: "Groceries this month", empty: "x" }),
		);
		expect(html).toContain("Groceries this month");
		expect(html).not.toContain("master-detail-empty");
		expect(tag(html, "master-detail-list")).toContain("max-lg:hidden");
		expect(tag(html, "master-detail-detail")).not.toContain("max-lg:hidden");
	});

	it("marks both panes as the regions allowed to scroll, and names them", () => {
		const html = renderToStaticMarkup(h(MasterDetail, { ...labels, list: "a", detail: "b" }));
		expect(html.match(/data-scroll-pane/g)).toHaveLength(2);
		expect(tag(html, "master-detail-list")).toContain('aria-label="Buckets"');
		expect(tag(html, "master-detail-detail")).toContain('aria-label="Bucket"');
	});
});
