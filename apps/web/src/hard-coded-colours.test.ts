import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the colour tokens (#75, ADR-0034; Indigo, ADR-0038): every colour comes from the tokens in
// packages/ui/src/styles/globals.css, so light and dark change in one place. A hex, rgb(), hsl(),
// oklch(), oklab(), lab(), lch() or hwb() colour written anywhere else under apps/web/src or
// packages/ui/src fails here. Use a token (bg-card, text-muted-foreground, var(--pace), …); if a
// file really can't read CSS variables, add it below with the reason.
const ALLOWED: Record<string, string> = {
	"apps/web/src/routes/__root.tsx":
		"the theme-color metas: the browser reads them before any CSS, one per mode (#f7f7f8 / #0c0d10)",
	"apps/web/src/server/email/templates.ts":
		"email HTML can't use the app's CSS; the email's own brand",
	"packages/ui/src/components/logo.tsx": "the mark's marigold dot, the logo's own colour",
	"packages/ui/src/components/chart.tsx":
		"selectors that find Recharts' default strokes (#ccc, #fff) to replace them with tokens",
	"apps/web/src/server/ai-eval-set.ts":
		"store numbers in bank lines (COSTCO WHSE #0482), not colours",
	"apps/web/src/server/merchant-model.ts":
		"store numbers in a prompt's example bank lines, not colours",
	"apps/web/src/server/plan-draft-model.ts":
		"store numbers in a prompt's example bank lines, not colours",
};

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/;

const repo = join(import.meta.dirname, "../../..");
const roots = ["apps/web/src", "packages/ui/src"].map((dir) => join(repo, dir));

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sources(path);
		if (entry.name === "globals.css") return [];
		return /\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

describe("hard-coded colours", () => {
	const found = new Map<string, string>();
	for (const path of roots.flatMap(sources)) {
		const lines = readFileSync(path, "utf8").split("\n");
		const at = lines.findIndex((line) => COLOUR.test(line));
		if (at >= 0)
			found.set(relative(repo, path).replaceAll("\\", "/"), `${at + 1}: ${lines[at]?.trim()}`);
	}

	it("has no colour written outside the tokens", () => {
		const extra = [...found]
			.filter(([file]) => !(file in ALLOWED))
			.map(([file, line]) => `${file}:${line.slice(0, 120)}`);
		expect(extra, "use a token from packages/ui/src/styles/globals.css").toEqual([]);
	});

	it("allows only what is still there", () => {
		const stale = Object.keys(ALLOWED).filter((file) => !found.has(file));
		expect(stale, "remove these entries from ALLOWED").toEqual([]);
	});
});
