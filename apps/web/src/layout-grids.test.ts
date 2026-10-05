import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the page grid (ADR-0024): a page's columns come from PageLayout, SplitLayout or
// ListWithPanel in packages/ui, never from a column template written in the page. A new
// `lg:grid-cols-[…]` under apps/web/src fails here. If it really is a grid inside one card or one
// row, add it below with the reason; if it lays out a page, use one of the three layouts.
const ALLOWED: Record<string, { count: number; why: string }> = {
	"components/app-shell.tsx": { count: 1, why: "the shell itself: the sidebar beside every page" },
	"components/report-views.tsx": { count: 2, why: "inside one card: a chart beside its figures" },
	"routes/_authed/_household/glossary.tsx": {
		count: 1,
		why: "an index of letters beside the terms, narrower than a rail; a deep-link page",
	},
	"routes/_authed/_household/check-in.tsx": {
		count: 1,
		why: "the Check-in's steps, narrower than a rail, beside its one card",
	},
};

const root = join(import.meta.dirname, ".");

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sources(path);
		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

describe("page grids", () => {
	const found = new Map<string, number>();
	for (const path of sources(root)) {
		const count = readFileSync(path, "utf8").match(/\blg:grid-cols-\[/g)?.length ?? 0;
		if (count > 0) found.set(relative(root, path).replaceAll("\\", "/"), count);
	}

	it("has no column template written in a page", () => {
		const extra = [...found]
			.filter(([file, count]) => count > (ALLOWED[file]?.count ?? 0))
			.map(([file, count]) => `${file}: ${count} (allowed ${ALLOWED[file]?.count ?? 0})`);
		expect(
			extra,
			"use PageLayout, SplitLayout or ListWithPanel (packages/ui/COMPONENTS.md)",
		).toEqual([]);
	});

	it("allows only what is still there", () => {
		const stale = Object.entries(ALLOWED)
			.filter(([file, { count }]) => (found.get(file) ?? 0) < count)
			.map(([file]) => file);
		expect(stale, "lower or remove these entries in ALLOWED").toEqual([]);
	});
});
