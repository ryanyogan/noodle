import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Guards how long an Undo stays (#103): "show the undo for 10 seconds and then remove the toast".
// A toast's Undo is `toast(message, { tone, undo: () => … })`, which shows the button and stays
// UNDO_TOAST_MS (packages/ui/src/components/toast.tsx); its type takes no `duration` or `sticky`.
// A toast action labelled Undo written by hand could stay any time, so it fails here, as does a
// second place that writes the time. Anything that waits for an Undo to go (a change sent once it
// can't be undone) imports UNDO_TOAST_MS rather than its own number.
const TOAST = "packages/ui/src/components/toast.tsx";

const repo = join(import.meta.dirname, "../../..");
const roots = ["apps/web/src", "packages/ui/src"].map((dir) => join(repo, dir));

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return sources(path);
		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

// `label: "Undo"` (any quote) is an action object for a toast; a page's own Undo button isn't one.
const UNDO_ACTION = /\blabel\s*:\s*["'`]Undo\b/;
// A time of its own for an Undo: UNDO_DELETE_MS = 6_000 and the like.
const OWN_TIME = /\b(?:const|let|var)\s+\w*UNDO\w*_MS\b/;

/** Lines of `text` that write a toast's Undo, or its time, by hand. */
const handWritten = (text: string) =>
	text
		.split("\n")
		.flatMap((line, index) =>
			UNDO_ACTION.test(line) || OWN_TIME.test(line) ? [`${index + 1}: ${line.trim()}`] : [],
		);

describe("toasts with Undo", () => {
	it("finds an Undo action or an Undo time written by hand", () => {
		expect(handWritten('action: { label: "Undo", onClick: put }')).toHaveLength(1);
		expect(handWritten("\tlabel: 'Undo',")).toHaveLength(1);
		expect(handWritten("const UNDO_DELETE_MS = 6_000;")).toHaveLength(1);
		expect(handWritten("toast(said, { tone, undo: () => put() })")).toEqual([]);
		expect(handWritten('action: { label: "Retry", onClick: again }')).toEqual([]);
		expect(handWritten("setTimeout(send, UNDO_TOAST_MS);")).toEqual([]);
	});

	it("all use `undo`, so each stays UNDO_TOAST_MS", () => {
		const found = roots.flatMap(sources).flatMap((path) => {
			const file = relative(repo, path);
			if (file === TOAST) return [];
			return handWritten(readFileSync(path, "utf8")).map((line) => `${file}:${line}`);
		});
		expect(found).toEqual([]);
	});

	it("has its time written once, in the toast", () => {
		const text = readFileSync(join(repo, TOAST), "utf8");
		expect(handWritten(text).filter((line) => OWN_TIME.test(line))).toEqual([
			expect.stringContaining("const UNDO_TOAST_MS = 10_000;"),
		]);
	});
});
