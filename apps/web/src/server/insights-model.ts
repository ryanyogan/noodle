import { AI_MODELS } from "@noodle/ai";
import type { InsightKind } from "@noodle/domain";
import { z } from "zod";

// The model behind Insights (AI_MODELS.reason), behind one small interface so the run is the
// same for Workers AI and for the deterministic fake E2E and unit tests use (AI_MODEL=stub). It
// does two things only: says which of a closed list of names are the same service, and rewords
// the plain title and body domain code wrote for each Insight. It never sees or states an amount:
// every figure is shown beside its words, from domain code. Its answers are checked with zod,
// and anything naming a code it wasn't given is dropped. Calls go through AI Gateway with
// `collectLog: false` (ADR-0012): gateway logs are visible to anyone on the Cloudflare account.

/** A service the model may group, by a code so its answer can't invent one. */
export type NameToGroup = { code: string; name: string };

/** An Insight for the model to reword: what kind, what it's about, and the plain wording. */
export type InsightToWord = {
	code: string;
	kind: InsightKind;
	subjects: string[];
	title: string;
	body: string;
};

export type Wording = { code: string; title: string; body: string };

export type InsightModel = {
	/** Groups of codes naming the same service, or services where one includes the other. */
	group(names: NameToGroup[]): Promise<string[][]>;
	/** A plainer title and body for each Insight it can improve; any it leaves out keep theirs. */
	word(insights: InsightToWord[]): Promise<Wording[]>;
};

/** How many names go to the model at most: services, not every merchant. */
export const MAX_NAMES = 60;

const groupsAnswer = z.object({ groups: z.array(z.array(z.string())) });
const wordingAnswer = z.object({
	insights: z.array(z.object({ code: z.string(), title: z.string(), body: z.string() })),
});

/** The JSON in a model's answer, which may come fenced or after some words. */
function jsonOf(text: string): unknown {
	try {
		return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
	} catch {
		return null;
	}
}

/** The model's groups, keeping only codes it was given, each once, in groups of two or more. */
export function readGroups(text: string, names: NameToGroup[]): string[][] {
	const parsed = groupsAnswer.safeParse(jsonOf(text));
	if (!parsed.success) return [];
	const known = new Set(names.map((n) => n.code));
	const used = new Set<string>();
	return parsed.data.groups.flatMap((group) => {
		const codes = [...new Set(group)].filter((code) => known.has(code) && !used.has(code));
		if (codes.length < 2) return [];
		for (const code of codes) used.add(code);
		return [codes];
	});
}

/** Words a model must not write: amounts and percentages belong to domain code. */
const FIGURES = /[$€£%]|\d/;

/**
 * The model's wordings for Insights it was given, each fitting and free of figures; anything
 * else (an unknown code, a figure, too long, empty) is dropped, so the Insight keeps its own.
 */
export function readWording(text: string, insights: InsightToWord[]): Wording[] {
	const parsed = wordingAnswer.safeParse(jsonOf(text));
	if (!parsed.success) return [];
	const known = new Set(insights.map((i) => i.code));
	return parsed.data.insights.flatMap((wording) => {
		const title = wording.title.trim();
		const body = wording.body.trim();
		const ok =
			known.has(wording.code) &&
			title.length > 0 &&
			title.length <= 80 &&
			body.length > 0 &&
			body.length <= 320 &&
			!FIGURES.test(title) &&
			!FIGURES.test(body);
		return ok ? [{ code: wording.code, title, body }] : [];
	});
}

const GROUP_SYSTEM = `You help a US household spot services it pays for twice. You get a list of the
names of things it pays for regularly, each with a code; names may be raw card statement text.
Group codes that are the same service (e.g. "NETFLIX.COM" and "Netflix"), or where one already
includes the other (e.g. a Disney bundle that includes Hulu, and Hulu). Do not group services
that merely share a category (two different gyms, a phone and an internet bill) unless one
includes the other. Only group when you are sure; most names belong in no group. Answer in
JSON only: {"groups": [["s1","s4"]]}.`;

const WORD_SYSTEM = `You write short notes for a US household's budgeting app. For each finding,
rewrite its title and body in plain, calm, friendly words a busy parent reads at a glance: a
title under 60 characters and one or two short sentences. Say what was found and what they could
do. Use what you know about the services named (e.g. which bundle includes which) when it helps.
Never write amounts, numbers, or percentages: the app shows the figures itself. Never tell them
what they must do. The app's own words keep their capitals: the Plan, a Commitment. Answer in JSON only: {"insights": [{"code","title","body"}]}.`;

const KIND_TEXT: Record<InsightKind, string> = {
	"duplicate-service":
		"Two or more services that look like the same service or cover the same need",
	"duplicate-charge": "The same amount charged twice at the same place a day or two apart",
	"price-increase": "A regular charge that went up",
	unused: "A Commitment in the Plan with no charges for a while",
	"perk-service": "A service they pay for that one of their plans, cards or memberships includes",
	"perk-cost": "A cost they paid that one of their cards or memberships covers or credits",
};

export function groupPrompt(names: NameToGroup[]): string {
	return names.map((n) => `${n.code}: ${n.name.replace(/\s+/g, " ").slice(0, 60)}`).join("\n");
}

export function wordPrompt(insights: InsightToWord[]): string {
	return insights
		.map((i) =>
			[
				`${i.code}: ${KIND_TEXT[i.kind]}`,
				`  About: ${i.subjects.map((s) => s.replace(/\s+/g, " ").slice(0, 60)).join("; ")}`,
				`  Title: ${i.title}`,
				`  Body: ${i.body}`,
			].join("\n"),
		)
		.join("\n\n");
}

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

/** Insights' model on Workers AI (AI_MODELS.reason), through the AI Gateway `gatewayId`. */
export function workersAiInsightModel(ai: Ai, gatewayId: string): InsightModel {
	const options = { gateway: { id: gatewayId, collectLog: false } };
	const ask = async (
		system: string,
		prompt: string,
		schema: Record<string, unknown>,
		name: string,
	) => {
		const out = await ai.run(
			AI_MODELS.reason,
			{
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: prompt },
				],
				response_format: { type: "json_schema", json_schema: { name, schema } },
				// Nightly, so latency doesn't matter much; low effort is plenty for names and wording.
				reasoning_effort: "low",
				max_completion_tokens: 4096,
			},
			options,
		);
		return textOf(out);
	};
	return {
		async group(names) {
			if (names.length < 2) return [];
			const schema = {
				type: "object",
				properties: {
					groups: {
						type: "array",
						items: {
							type: "array",
							items: { type: "string", enum: names.map((n) => n.code) },
						},
					},
				},
				required: ["groups"],
			};
			return readGroups(await ask(GROUP_SYSTEM, groupPrompt(names), schema, "groups"), names);
		},
		async word(insights) {
			if (insights.length === 0) return [];
			const schema = {
				type: "object",
				properties: {
					insights: {
						type: "array",
						items: {
							type: "object",
							properties: {
								code: { type: "string", enum: insights.map((i) => i.code) },
								title: { type: "string" },
								body: { type: "string" },
							},
							required: ["code", "title", "body"],
						},
					},
				},
				required: ["insights"],
			};
			return readWording(await ask(WORD_SYSTEM, wordPrompt(insights), schema, "wording"), insights);
		},
	};
}

// ---------------------------------------------------------------------------------------------
// The fake

/** Services the fake model knows, by the words in their names; one family is one service. */
const STUB_FAMILIES: string[][] = [
	["netflix"],
	["disney", "hulu", "espn"],
	["spotify"],
	["apple music", "apple one"],
	["youtube"],
	["peacock"],
];

/**
 * A deterministic stand-in for the model (AI_MODEL=stub, unit tests): names sharing a family
 * above are one service, and each Insight's wording is its own with "(stub)" on the title, so
 * E2E can see the wording went through the model.
 */
export const stubInsightModel: InsightModel = {
	async group(names) {
		const groups = STUB_FAMILIES.map((family) =>
			names
				.filter((n) => family.some((word) => n.name.toLowerCase().includes(word)))
				.map((n) => n.code),
		);
		return readGroups(JSON.stringify({ groups }), names);
	},
	async word(insights) {
		return insights.map((i) => ({ code: i.code, title: `${i.title} (stub)`, body: i.body }));
	},
};
