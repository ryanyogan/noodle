import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the shared controls (#56, packages/ui/COMPONENTS.md "Control sizes"): every button, field,
// select and table in apps/web comes from packages/ui, and a Button, Input or SelectTrigger gets its
// height from its `size`, never from an `h-*` class. A new raw element or height class under
// apps/web/src fails here. If it really can't be the shared component, add it below with the reason.
const RAW_ALLOWED: Record<string, { count: number; why: string }> = {
	"components/report-charts.tsx": {
		count: 3,
		why: "the heatmap: a <table> of tinted data cells with a sticky column and its own scroller, a <button> per cell, and a <button> per calendar day; none is a Button or a Table row",
	},
	"components/statements.tsx": {
		count: 1,
		why: "a hidden <input type=file>; a Button opens it",
	},
	"components/quick-add-capture.tsx": {
		count: 1,
		why: "a hidden <input type=file>; a Button opens it",
	},
};

// No height class on a control is allowed today. Add a file here only with a reason.
const HEIGHT_ALLOWED: Record<string, { count: number; why: string }> = {};

const RAW = /<(?:button|input|select|textarea|table)(?=[\s>/])/g;
const CONTROL = /<(?:Button|Input|SelectTrigger)(?=[\s>/])/g;
// `h-9`, `lg:h-10`, `h-auto`, `h-[2.5rem]`; not `min-h-*` or `max-h-*`, which leave the size's height.
const HEIGHT = /(?<![\w-])h-[\w[]/;

const root = join(import.meta.dirname, ".");

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sources(path);
		return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [path] : [];
	});
}

/** The opening tag starting at `start`, up to the `>` that closes it (skipping `{…}` and strings). */
function openingTag(text: string, start: number): string {
	let depth = 0;
	let quote = "";
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (quote) {
			if (ch === quote) quote = "";
		} else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
		else if (ch === "{") depth++;
		else if (ch === "}") depth--;
		else if (ch === ">" && depth === 0 && text[i - 1] !== "=") return text.slice(start, i + 1);
	}
	return text.slice(start);
}

/** The text of every `className` on the tag: a string, or whatever sits inside `{…}`. */
function classNames(tag: string): string {
	return [...tag.matchAll(/className=(?:"([^"]*)"|\{([\s\S]*?)\}(?=\s|\/?>))/g)]
		.map((m) => m[1] ?? m[2] ?? "")
		.join(" ");
}

function stripComments(text: string): string {
	return text.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
}

function over(found: Map<string, number>, allowed: Record<string, { count: number }>): string[] {
	return [...found]
		.filter(([file, count]) => count > (allowed[file]?.count ?? 0))
		.map(([file, count]) => `${file}: ${count} (allowed ${allowed[file]?.count ?? 0})`);
}

function stale(found: Map<string, number>, allowed: Record<string, { count: number }>): string[] {
	return Object.entries(allowed)
		.filter(([file, { count }]) => (found.get(file) ?? 0) < count)
		.map(([file]) => file);
}

describe("shared controls", () => {
	const raw = new Map<string, number>();
	const heights = new Map<string, number>();
	for (const path of sources(root)) {
		const file = relative(root, path).replaceAll("\\", "/");
		const text = stripComments(readFileSync(path, "utf8"));
		const rawCount = text.match(RAW)?.length ?? 0;
		if (rawCount > 0) raw.set(file, rawCount);
		const heightCount = [...text.matchAll(CONTROL)].filter((m) =>
			HEIGHT.test(classNames(openingTag(text, m.index))),
		).length;
		if (heightCount > 0) heights.set(file, heightCount);
	}

	it("has no raw button, input, select, textarea or table", () => {
		expect(
			over(raw, RAW_ALLOWED),
			"use the component from @noodle/ui (packages/ui/COMPONENTS.md)",
		).toEqual([]);
	});

	it("has no height class on a Button, Input or SelectTrigger", () => {
		expect(
			over(heights, HEIGHT_ALLOWED),
			"pick a `size` instead; add one in packages/ui if none fits (COMPONENTS.md, Control sizes)",
		).toEqual([]);
	});

	it("allows only what is still there", () => {
		expect(
			[...stale(raw, RAW_ALLOWED), ...stale(heights, HEIGHT_ALLOWED)],
			"lower or remove these entries in RAW_ALLOWED or HEIGHT_ALLOWED",
		).toEqual([]);
	});
});
