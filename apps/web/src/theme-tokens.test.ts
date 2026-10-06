import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

// Dark's tokens are written twice in globals.css, because CSS can't say "the device is dark, or the
// Parent chose Dark" in one rule: once under prefers-color-scheme (unless the Parent chose Light),
// once for `<html data-theme="dark">`. This keeps the two the same.
const css = readFileSync(
	join(import.meta.dirname, "..", "..", "..", "packages", "ui", "src", "styles", "globals.css"),
	"utf8",
);

const declarations = (opening: string) => {
	const start = css.indexOf(opening);
	expect(start, opening).toBeGreaterThan(-1);
	const body = css.slice(start + opening.length, css.indexOf("}", start));
	return body
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split(";")
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter(Boolean);
};

it("Dark chosen by the Parent has the same tokens as dark from the device", () => {
	const device = declarations(':not([data-theme="light"]):root {');
	const picked = declarations(':root[data-theme="dark"] {');
	expect(device.length).toBeGreaterThan(20);
	expect(picked, "change both dark blocks in globals.css together").toEqual(device);
});
