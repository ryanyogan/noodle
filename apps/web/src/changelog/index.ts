import { type Block, parseBlocks } from "../docs/markdown";
import source from "./changelog.md?raw";

/**
 * The Changelog (issue 157): what changed in Noodle, release by release, newest first, written in
 * ./changelog.md and read when the app is built (nothing is read at request time). To add a
 * release, add a `## YYYY-MM-DD: Title` heading and its list at the top of that file and deploy;
 * the file's own first lines say how.
 */

/** A release as a list needs it: enough to link to it, and to tell a newer one from an older. */
export type ReleaseSummary = {
	/** The day it went out, `YYYY-MM-DD`. Days compare as text. */
	date: string;
	/** Its anchor on the Changelog page (`/household/changelog` then `#` and this): the date. */
	id: string;
	title: string;
};

export type Release = ReleaseSummary & { blocks: Block[] };

const HEADING = /^## (\d{4}-\d{2}-\d{2}): (.+)$/;

const isDay = (date: string) => {
	const day = new Date(`${date}T00:00:00Z`);
	return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === date;
};

/**
 * The releases written in `markdown`, in the order they are written. It throws on a heading it
 * can't read, a release with nothing under it, a day given twice or releases out of order, so a
 * slip in the file fails the build's tests instead of showing on the page.
 */
export function readChangelog(markdown: string): Release[] {
	const releases: Release[] = [];
	// What is above the first release (the file's note on how to add one) isn't shown.
	const parts = markdown
		.replace(/<!--[\s\S]*?-->/g, "")
		.split(/^(?=## )/m)
		.filter((part) => part.startsWith("## "));
	for (const part of parts) {
		const [first = "", ...rest] = part.split(/\r?\n/);
		const heading = HEADING.exec(first.trim());
		const date = heading?.[1];
		const title = heading?.[2]?.trim();
		if (!date || !title || !isDay(date)) {
			throw new Error(`Changelog: "${first}" should read "## YYYY-MM-DD: Title"`);
		}
		const blocks = parseBlocks(rest.join("\n"));
		if (blocks.length === 0) throw new Error(`Changelog: ${date} has no changes under it`);
		const last = releases.at(-1);
		if (last && last.date <= date) {
			throw new Error(`Changelog: ${date} is under ${last.date}; newest first, one release a day`);
		}
		releases.push({ date, id: date, title, blocks });
	}
	return releases;
}

/** Every release with its changes, newest first. */
export const changelog: Release[] = readChangelog(source);

/** Every release without its changes, newest first: what tells whether there is one unseen. */
export const releases: ReleaseSummary[] = changelog.map(({ date, id, title }) => ({
	date,
	id,
	title,
}));

/** The newest release, if there is one. */
export const latestRelease: ReleaseSummary | undefined = releases[0];

/** The releases that went out after `date` (a `YYYY-MM-DD`), newest first; all of them without one. */
export const releasesSince = (date: string | undefined, all: ReleaseSummary[] = releases) =>
	date === undefined ? all : all.filter((release) => release.date > date);
