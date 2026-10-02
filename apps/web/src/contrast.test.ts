/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Text tokens against every surface they're drawn on, in both themes: WCAG 2.2 AA (1.4.3) needs
// 4.5:1 for normal text. The tokens live in packages/ui's globals.css.

const css = readFileSync(
	join(import.meta.dirname, "..", "..", "..", "packages", "ui", "src", "styles", "globals.css"),
	"utf8",
);

/** The hex colour tokens in the first `:root { … }` block after `from`. */
function tokens(from: number): Record<string, string> {
	const start = css.indexOf(":root {", from);
	const block = css.slice(start, css.indexOf("}", start));
	return Object.fromEntries(
		[...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, hex]) => [name, hex]),
	);
}

const light = tokens(0);
const dark = { ...light, ...tokens(css.indexOf("@media (prefers-color-scheme: dark)")) };

const luminance = (hex: string) => {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
};

/** `soft` (an rgb(… / alpha) tint of `over`) laid over `under`. */
const tint = (over: string, alpha: number, under: string) =>
	`#${[1, 3, 5]
		.map((i) => {
			const top = Number.parseInt(over.slice(i, i + 2), 16);
			const bottom = Number.parseInt(under.slice(i, i + 2), 16);
			return Math.round(top * alpha + bottom * (1 - alpha))
				.toString(16)
				.padStart(2, "0");
		})
		.join("")}`;

describe.each([
	["light", light, 0.1],
	["dark", dark, 0.14],
])("text contrast, %s theme", (_theme, t, overAlpha) => {
	const surfaces = ["card", "background", "surface-2", "surface-3"];

	it.each(["foreground", "muted-foreground", "subtle-foreground"])(
		"%s is at least 4.5:1 on every surface",
		(text) => {
			for (const surface of surfaces) {
				expect(contrast(t[text] as string, t[surface] as string)).toBeGreaterThanOrEqual(4.5);
			}
		},
	);

	it("a bar's Today line and over fill are at least 3:1 on its track (BudgetBar, #64)", () => {
		for (const ink of ["foreground", "over"]) {
			expect(contrast(t[ink] as string, t["surface-3"] as string)).toBeGreaterThanOrEqual(3);
		}
	});

	it("the Over badge's text is at least 4.5:1 on its tint, over a card", () => {
		const badge = tint(t.over as string, overAlpha, t.card as string);
		expect(contrast(t["over-foreground"] as string, badge)).toBeGreaterThanOrEqual(4.5);
	});
});
