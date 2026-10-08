import { describe, expect, it } from "vitest";
import { blockText } from "../docs/markdown";
import { changelog, latestRelease, readChangelog, releases, releasesSince } from "./index";

describe("Changelog", () => {
	it("reads every release, each with a title and changes", () => {
		expect(changelog.length).toBeGreaterThanOrEqual(5);
		for (const release of changelog) {
			expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(release.title.length).toBeGreaterThan(0);
			expect(release.blocks.some((block) => block.kind === "list")).toBe(true);
			// A heading inside a release would break the page's outline.
			expect(release.blocks.filter((block) => block.kind === "heading")).toEqual([]);
		}
	});

	it("is newest first", () => {
		const dates = changelog.map((release) => release.date);
		expect(dates).toEqual([...dates].sort().reverse());
		expect(latestRelease?.date).toBe(dates[0]);
	});

	it("gives each release an anchor of its own", () => {
		const ids = changelog.map((release) => release.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^[\w-]+$/);
	});

	it("lists the same releases without their changes", () => {
		expect(releases).toEqual(changelog.map(({ date, id, title }) => ({ date, id, title })));
	});

	it("is written in a Parent's words: no ticket numbers", () => {
		for (const release of changelog) {
			const text = [release.title, ...release.blocks.map(blockText)].join(" ");
			expect(text, release.date).not.toMatch(/#\d+|\bissue \d+|\bADR\b/i);
		}
	});

	it("tells the releases a Parent hasn't seen from the day of the last one they saw", () => {
		const all = readChangelog("## 2026-03-02: Second\n\n- B\n\n## 2026-03-01: First\n\n- A\n");
		expect(releasesSince("2026-03-01", all).map((r) => r.title)).toEqual(["Second"]);
		expect(releasesSince("2026-03-02", all)).toEqual([]);
		expect(releasesSince(undefined, all)).toHaveLength(2);
	});

	it("leaves out the note above the first release", () => {
		const read = readChangelog(
			"<!--\n## 2026-01-01: Not one\n-->\n\n## 2026-03-01: First\n\n- A\n",
		);
		expect(read.map((r) => r.id)).toEqual(["2026-03-01"]);
	});

	it.each([
		["a heading without a date", "## Soon\n\n- A\n"],
		["a day that doesn't exist", "## 2026-02-30: Never\n\n- A\n"],
		["a release with nothing under it", "## 2026-03-01: Empty\n"],
		["a day given twice", "## 2026-03-01: One\n\n- A\n\n## 2026-03-01: Two\n\n- B\n"],
		["oldest first", "## 2026-03-01: One\n\n- A\n\n## 2026-03-02: Two\n\n- B\n"],
	])("refuses %s", (_what, markdown) => {
		expect(() => readChangelog(markdown)).toThrow(/^Changelog: /);
	});
});
