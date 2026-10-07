import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the accessibility run (issue 125): every spec starts its axe run from `settledAxe` in
// e2e/axe.ts, which waits for a toast that is fading out and leaves it out of the run. A raw
// `AxeBuilder` checks a half-faded toast nobody can read and fails now and then for no reason.
// So nothing under e2e but the helper itself may import the package or construct an AxeBuilder.
const HELPER = "axe.ts";

const root = join(import.meta.dirname, "..", "e2e");

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sources(path);
		return /\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

/** What a raw run looks like: the package imported, or an AxeBuilder made. */
function rawAxe(source: string): boolean {
	return /@axe-core\/playwright/.test(source) || /\bnew\s+AxeBuilder\b/.test(source);
}

describe("accessibility runs in the E2E specs", () => {
	it("tells a raw run from one through the helper", () => {
		expect(rawAxe('import AxeBuilder from "@axe-core/playwright";')).toBe(true);
		expect(rawAxe("const results = await new AxeBuilder({ page }).analyze();")).toBe(true);
		expect(rawAxe('const { default: Axe } = await import("@axe-core/playwright");')).toBe(true);
		expect(rawAxe('import { settledAxe } from "./axe";')).toBe(false);
		expect(rawAxe("const results = await (await settledAxe(page)).analyze();")).toBe(false);
	});

	it("start from settledAxe, never a raw AxeBuilder", () => {
		const files = sources(root);
		expect(files.length).toBeGreaterThan(10);
		const raw = files
			.map((path) => relative(root, path).replaceAll("\\", "/"))
			.filter((file) => file !== HELPER)
			.filter((file) => rawAxe(readFileSync(join(root, file), "utf8")));
		expect(
			raw,
			'use `settledAxe(page)` from "./axe" in place of `new AxeBuilder({ page })`',
		).toEqual([]);
	});

	it("still has the helper it sends specs to", () => {
		expect(readFileSync(join(root, HELPER), "utf8")).toMatch(/export async function settledAxe\b/);
	});
});
