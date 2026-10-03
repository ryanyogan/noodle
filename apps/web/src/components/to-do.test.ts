import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToDo } from "./to-do";

describe("ToDo", () => {
	it("names its items and counts them while closed", () => {
		const html = renderToStaticMarkup(
			h(ToDo, {
				items: [
					{ label: "Close September", content: "close" },
					{ label: "Get started", content: "steps" },
					{ label: "To look at", content: "chips" },
				],
			}),
		);
		expect(html).toContain('aria-expanded="false"');
		expect(html).toContain("Close September · Get started · To look at");
		expect(html).toMatch(/>3<\/span>/);
	});

	it("is gone when nothing is in it", () => {
		expect(renderToStaticMarkup(h(ToDo, { items: [] }))).toBe("");
	});
});
