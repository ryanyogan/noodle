import { AI_MODELS } from "@noodle/ai";
import type { FoundPerk, PerkSourceKind } from "@noodle/domain";
import { z } from "zod";

// Reading a Perk Source's Perks: its benefits page is fetched, reduced to text, and a model
// (AI_MODELS.reason) lists the Perks that text describes, each with the page's own words. The
// model reads, it doesn't remember: it's told to use the page alone, and the run keeps only
// Perks whose quote is on the page (perksOnPage in @noodle/domain), so what it knows (or
// half-knows) from training never becomes a Perk. It never states an amount the app uses:
// every figure comes from the Household's own spending. Calls go through AI Gateway with
// `collectLog: false` (ADR-0012). E2E and unit tests use the fakes below (AI_MODEL=stub), which
// never touch the network.

/** A benefits page as read: where it ended up (after redirects), and its text. */
export type Page = { url: string; text: string } | { url: string; failed: number };

export type PerksRead = { tiers: string[]; perks: FoundPerk[] };

export type PerkSourceToRead = { name: string; kind: PerkSourceKind };

export type PerkReader = {
	/** Fetches a page; throws on a failure worth retrying (network, 5xx, 429). */
	fetchPage(url: string): Promise<Page>;
	/** The plan tiers and Perks the page's text describes, as the model read them. */
	readPerks(source: PerkSourceToRead, text: string): Promise<PerksRead>;
};

/** How much of a page the model reads: about twelve thousand tokens. */
export const MAX_PAGE_CHARS = 48_000;
/** A page with less text than this didn't render without a browser: it can't be read. */
export const MIN_PAGE_CHARS = 400;

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	rsquo: "’",
	lsquo: "‘",
	ldquo: "“",
	rdquo: "”",
	mdash: "—",
	ndash: "–",
	reg: "®",
	trade: "™",
};

/** A page's readable text: no scripts, styles or tags, entities decoded, space collapsed. */
export function pageText(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, " ")
		.replace(
			/<\/?(p|div|li|ul|ol|h[1-6]|tr|td|th|br|section|article|header|footer)\b[^>]*>/gi,
			"\n",
		)
		.replace(/<[^>]+>/g, " ")
		.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
			if (code.startsWith("#x")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
			if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
			return ENTITIES[code.toLowerCase()] ?? whole;
		})
		.replace(/[ \t\f\v ]+/g, " ")
		.replace(/\s*\n\s*/g, "\n")
		.trim()
		.slice(0, MAX_PAGE_CHARS);
}

/** Fetches a page, as a browser would ask for it; 4xx is a page that won't be read, not a retry. */
export async function fetchPage(url: string): Promise<Page> {
	const response = await fetch(url, {
		redirect: "follow",
		headers: {
			"user-agent": "Mozilla/5.0 (compatible; Noodle/1.0; +household perk check)",
			accept: "text/html,application/xhtml+xml",
			"accept-language": "en-US,en;q=0.9",
		},
		signal: AbortSignal.timeout(20_000),
	});
	if (response.status === 429 || response.status >= 500) {
		throw new Error(`${url} answered ${response.status}`);
	}
	if (!response.ok) return { url: response.url || url, failed: response.status };
	return { url: response.url || url, text: pageText(await response.text()) };
}

const perksAnswer = z.object({
	tiers: z.array(z.string()).default([]),
	perks: z
		.array(
			z.object({
				name: z.string(),
				kind: z.enum(["service", "cost"]),
				matches: z.string(),
				tiers: z.array(z.string()).default([]),
				quote: z.string(),
			}),
		)
		.default([]),
});

/** The JSON in a model's answer, which may come fenced or after some words. */
function jsonOf(text: string): unknown {
	try {
		return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
	} catch {
		return null;
	}
}

/** The model's answer, shaped; the run checks each Perk against the page. */
export function readPerksAnswer(text: string): PerksRead {
	const parsed = perksAnswer.safeParse(jsonOf(text));
	return parsed.success ? parsed.data : { tiers: [], perks: [] };
}

const READ_SYSTEM = `You read one web page for a US household's budgeting app and list the
benefits it says come with a product the household holds (a phone plan, credit card, membership
or insurance policy). Use only the page's text: never add what you remember about the product,
and leave out anything the page doesn't state. List two kinds of benefit:
- "service": a subscription or service included at no extra cost (e.g. Netflix, Hulu, Apple TV+,
  a DashPass membership).
- "cost": a cost it pays for, credits or reimburses (e.g. a TSA PreCheck or Global Entry fee
  credit, cell phone protection, rental car insurance).
For each: "name" (short, as the page names it), "kind", "matches" (the service or cost as it would
appear on a card statement: one or two words, e.g. "Netflix", "TSA PreCheck", "Global Entry"),
"tiers" (the plan or card tiers named on the page that include it; [] if every tier or the page
names no tiers), and "quote" (up to twenty words copied exactly from the page that say so). Also
list "tiers": every plan or card tier the page offers with different benefits. Leave out points,
cash back, discounts on the product itself, and perks with no statement name. Answer in JSON only:
{"tiers": [], "perks": [{"name","kind","matches","tiers","quote"}]}.`;

/** The answer's text, from a chat completion or a Responses-style output. */
function textOf(out: unknown): string {
	const chat = out as { choices?: { message?: { content?: unknown } }[] };
	const content = chat.choices?.[0]?.message?.content;
	if (typeof content === "string") return content;
	const responses = out as { output?: { type?: string; content?: { text?: string }[] }[] };
	return (responses.output ?? [])
		.filter((item) => item.type === "message")
		.flatMap((item) => item.content ?? [])
		.map((part) => part.text ?? "")
		.join("");
}

const PERKS_SCHEMA = {
	type: "object",
	properties: {
		tiers: { type: "array", items: { type: "string" } },
		perks: {
			type: "array",
			items: {
				type: "object",
				properties: {
					name: { type: "string" },
					kind: { type: "string", enum: ["service", "cost"] },
					matches: { type: "string" },
					tiers: { type: "array", items: { type: "string" } },
					quote: { type: "string" },
				},
				required: ["name", "kind", "matches", "tiers", "quote"],
			},
		},
	},
	required: ["tiers", "perks"],
};

/** Perk research on the web and Workers AI (AI_MODELS.reason), through the AI Gateway `gatewayId`. */
export function workersAiPerkReader(ai: Ai, gatewayId: string): PerkReader {
	return {
		fetchPage,
		async readPerks(source, text) {
			const out = await ai.run(
				AI_MODELS.reason,
				{
					messages: [
						{ role: "system", content: READ_SYSTEM },
						{
							role: "user",
							content: `Product: ${source.name} (${source.kind})\n\nPage text:\n${text}`,
						},
					],
					response_format: {
						type: "json_schema",
						json_schema: { name: "perks", schema: PERKS_SCHEMA },
					},
					// Monthly per Perk Source, so latency doesn't matter; tiers take some care.
					reasoning_effort: "medium",
					max_completion_tokens: 8192,
				},
				{ gateway: { id: gatewayId, collectLog: false } },
			);
			return readPerksAnswer(textOf(out));
		},
	};
}

// ---------------------------------------------------------------------------------------------
// The fakes

/** A phone plan's page whose Perks depend on the plan tier. */
const STUB_PLAN_PAGE = `Compare our plans: Essentials, Go5G and Go5G Plus. Every plan comes with
unlimited talk and text, and a lot more to enjoy with your line.
Netflix Standard with ads is on us with Go5G and Go5G Plus.
Hulu (With Ads) is on us with Go5G Plus.
T-Mobile Tuesdays: weekly thanks and deals on every plan.
${"Fine print about taxes, fees and data. ".repeat(10)}`;

/** A card's page: the same benefits whichever card. */
const STUB_CARD_PAGE = `Card benefits. Travel better with credits that pay for themselves.
Get a statement credit for the TSA PreCheck or Global Entry application fee every four years.
Complimentary DashPass membership when you activate by the end of the year.
${"Terms apply to every benefit on this page. ".repeat(10)}`;

/** What the fake model reads in each fake page. */
const STUB_READS: Record<string, PerksRead> = {
	[STUB_PLAN_PAGE]: {
		tiers: ["Essentials", "Go5G", "Go5G Plus"],
		perks: [
			{
				name: "Netflix Standard with ads",
				kind: "service",
				matches: "Netflix",
				tiers: ["Go5G", "Go5G Plus"],
				quote: "Netflix Standard with ads is on us with Go5G and Go5G Plus.",
			},
			{
				name: "Hulu (With Ads)",
				kind: "service",
				matches: "Hulu",
				tiers: ["Go5G Plus"],
				quote: "Hulu (With Ads) is on us with Go5G Plus.",
			},
			{
				// Remembered, not on the page: the run must drop it.
				name: "Apple TV+",
				kind: "service",
				matches: "Apple TV+",
				tiers: ["Go5G Plus"],
				quote: "Apple TV+ is on us with Go5G Plus.",
			},
		],
	},
	[STUB_CARD_PAGE]: {
		tiers: [],
		perks: [
			{
				name: "TSA PreCheck or Global Entry fee credit",
				kind: "cost",
				matches: "TSA PreCheck",
				tiers: [],
				quote: "a statement credit for the TSA PreCheck or Global Entry application fee",
			},
			{
				name: "DashPass",
				kind: "service",
				matches: "DashPass",
				tiers: [],
				quote: "Complimentary DashPass membership",
			},
		],
	},
};

/**
 * A deterministic stand-in (AI_MODEL=stub, unit tests): a phone plan's page for any address on
 * t-mobile.com, a page that can't be found for one with "missing" in it, and a card's page for
 * anything else. The fake model reads each as a careful model would, plus one Perk it only
 * "remembers", which the run must drop.
 */
export const stubPerkReader: PerkReader = {
	async fetchPage(url) {
		if (url.includes("missing")) return { url, failed: 404 };
		return {
			url,
			text: new URL(url).hostname.endsWith("t-mobile.com") ? STUB_PLAN_PAGE : STUB_CARD_PAGE,
		};
	},
	async readPerks(_source, text) {
		return STUB_READS[text] ?? { tiers: [], perks: [] };
	},
};
