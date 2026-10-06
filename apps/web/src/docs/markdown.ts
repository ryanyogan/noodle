/**
 * The small part of Markdown the Docs articles are written in (issue 126), read without a
 * library: `## ` and `### ` headings, paragraphs, `- ` and `1. ` lists, `> ` notes, and inside a
 * line **bold** and [links](/docs/this-month). Anything else is shown as it is typed.
 */
export type Inline = string | { bold: string } | { text: string; href: string };

export type Block =
	| { kind: "heading"; level: 2 | 3; id: string; text: string }
	| { kind: "paragraph"; inline: Inline[] }
	| { kind: "note"; inline: Inline[] }
	| { kind: "list"; ordered: boolean; items: Inline[][] };

const INLINE = /\*\*(.+?)\*\*|\[(.+?)\]\((.+?)\)/g;

export function parseInline(text: string): Inline[] {
	const parts: Inline[] = [];
	let last = 0;
	for (const match of text.matchAll(INLINE)) {
		if (match.index > last) parts.push(text.slice(last, match.index));
		parts.push(match[1] ? { bold: match[1] } : { text: match[2] ?? "", href: match[3] ?? "" });
		last = match.index + match[0].length;
	}
	if (last < text.length) parts.push(text.slice(last));
	return parts;
}

export const inlineText = (inline: Inline[]) =>
	inline
		.map((part) => (typeof part === "string" ? part : "bold" in part ? part.bold : part.text))
		.join("");

const slugify = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

/** The lines between the `---` at the top of a file, as `key: value`, and what follows them. */
export function splitFrontmatter(source: string): { fields: Record<string, string>; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
	if (!match) return { fields: {}, body: source };
	const fields: Record<string, string> = {};
	for (const line of (match[1] ?? "").split(/\r?\n/)) {
		const colon = line.indexOf(":");
		if (colon > 0) fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
	}
	return { fields, body: source.slice(match[0].length) };
}

export function parseBlocks(body: string): Block[] {
	const blocks: Block[] = [];
	for (const chunk of body.split(/\r?\n\s*\r?\n/)) {
		const lines = chunk.split(/\r?\n/).filter((line) => line.trim());
		const first = lines[0];
		if (!first) continue;
		const heading = /^(##|###) (.+)$/.exec(first);
		if (heading) {
			const text = (heading[2] ?? "").trim();
			blocks.push({ kind: "heading", level: heading[1] === "##" ? 2 : 3, id: slugify(text), text });
		} else if (lines.every((line) => /^- /.test(line))) {
			blocks.push({
				kind: "list",
				ordered: false,
				items: lines.map((l) => parseInline(l.slice(2))),
			});
		} else if (lines.every((line) => /^\d+\. /.test(line))) {
			blocks.push({
				kind: "list",
				ordered: true,
				items: lines.map((l) => parseInline(l.replace(/^\d+\. /, ""))),
			});
		} else if (lines.every((line) => /^> ?/.test(line))) {
			blocks.push({
				kind: "note",
				inline: parseInline(lines.map((l) => l.replace(/^> ?/, "")).join(" ")),
			});
		} else {
			blocks.push({ kind: "paragraph", inline: parseInline(lines.join(" ")) });
		}
	}
	return blocks;
}

/** A block's words, for the search. */
export const blockText = (block: Block) =>
	block.kind === "heading"
		? block.text
		: block.kind === "list"
			? block.items.map(inlineText).join(" ")
			: inlineText(block.inline);
