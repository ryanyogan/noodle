import { AI_MODELS } from "@noodle/ai";
import { DRAFT_BUCKET_NAMES, type DraftLabels, plainName } from "@noodle/domain";
import { z } from "zod";

// The model behind the first Plan's draft (AI_MODELS.reason), behind one small interface so the
// run is the same for Workers AI and for the deterministic fake E2E and unit tests use
// (AI_MODEL=stub). It only labels: it sorts merchants into Bucket names from a closed list and
// gives statement lines a readable name. It never sees or states an amount: every figure in the
// draft comes from domain code. Its answer is checked with zod, and anything naming a code it
// wasn't given, or a Bucket not on the list, is dropped. Calls go through AI Gateway with
// `collectLog: false` (ADR-0012): gateway logs are visible to anyone on the Cloudflare account.

/** A statement line for the model, by merchantKey. */
export type LineToLabel = { key: string; description: string };

export type DraftModel = {
	/**
	 * Bucket names for the merchants in `toSort` and readable names for the lines in `toName`, by
	 * merchantKey; any it leaves out go to Everyday or keep their plain name.
	 */
	label(toSort: LineToLabel[], toName: LineToLabel[]): Promise<DraftLabels>;
};

/** What the model may answer for a merchant that fits none of the Bucket names. */
const NO_BUCKET = "none";

const labelsAnswer = z.object({
	lines: z.array(z.object({ code: z.string(), name: z.string(), bucket: z.string().optional() })),
});

/** The JSON in a model's answer, which may come fenced or after some words. */
function jsonOf(text: string): unknown {
	try {
		return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
	} catch {
		return null;
	}
}

/** Each line once, by code, and whether its merchant is to be sorted. */
export function linesToLabel(toSort: LineToLabel[], toName: LineToLabel[]) {
	const sort = new Set(toSort.map((line) => line.key));
	const lines = new Map<string, LineToLabel>();
	for (const line of [...toName, ...toSort]) if (!lines.has(line.key)) lines.set(line.key, line);
	return [...lines.values()].map((line, i) => ({
		...line,
		code: `m${i + 1}`,
		sort: sort.has(line.key),
	}));
}

/**
 * The model's labels for the lines it was given: a Bucket name from the list for a merchant it
 * was asked to sort, and a name that fits for any line. Anything else is dropped.
 */
export function readLabels(text: string, lines: ReturnType<typeof linesToLabel>): DraftLabels {
	const labels: DraftLabels = { buckets: {}, names: {} };
	const parsed = labelsAnswer.safeParse(jsonOf(text));
	if (!parsed.success) return labels;
	const byCode = new Map(lines.map((line) => [line.code, line]));
	const bucketNames = new Set<string>(DRAFT_BUCKET_NAMES);
	for (const answer of parsed.data.lines) {
		const line = byCode.get(answer.code);
		if (!line) continue;
		const name = answer.name.replace(/\s+/g, " ").trim();
		if (name.length > 0 && name.length <= 40 && !/[$€£%]/.test(name)) labels.names[line.key] = name;
		if (line.sort && answer.bucket && bucketNames.has(answer.bucket)) {
			labels.buckets[line.key] = answer.bucket;
		}
	}
	return labels;
}

const LABEL_SYSTEM = `You help a US household set up its budget from its bank and card statements.
You get statement lines, each with a code. For each, give a short readable name for who was paid
or who paid them, as a person would say it (e.g. "TRADER JOE'S #552 PORTLAND OR" is "Trader
Joe's", "ACME CORP PAYROLL PPD" is "Acme Corp payroll"). For a line marked "sort", also say which
of these budget Buckets its spending belongs in: ${DRAFT_BUCKET_NAMES.join(", ")}. Say "${NO_BUCKET}"
when none fits or you aren't sure. Answer in JSON only: {"lines": [{"code","name","bucket"}]}.`;

export function labelPrompt(lines: ReturnType<typeof linesToLabel>): string {
	return lines
		.map(
			(line) =>
				`${line.code}${line.sort ? " (sort)" : ""}: ${line.description.replace(/\s+/g, " ").slice(0, 60)}`,
		)
		.join("\n");
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

/** The draft's model on Workers AI (AI_MODELS.reason), through the AI Gateway `gatewayId`. */
export function workersAiDraftModel(ai: Ai, gatewayId: string): DraftModel {
	return {
		async label(toSort, toName) {
			const lines = linesToLabel(toSort, toName);
			if (lines.length === 0) return { buckets: {}, names: {} };
			const schema = {
				type: "object",
				properties: {
					lines: {
						type: "array",
						items: {
							type: "object",
							properties: {
								code: { type: "string", enum: lines.map((line) => line.code) },
								name: { type: "string" },
								bucket: { type: "string", enum: [...DRAFT_BUCKET_NAMES, NO_BUCKET] },
							},
							required: ["code", "name"],
						},
					},
				},
				required: ["lines"],
			};
			const out = await ai.run(
				AI_MODELS.reason,
				{
					messages: [
						{ role: "system", content: LABEL_SYSTEM },
						{ role: "user", content: labelPrompt(lines) },
					],
					response_format: { type: "json_schema", json_schema: { name: "labels", schema } },
					// Once per Household, after its first statements; low effort is plenty for names.
					reasoning_effort: "low",
					max_completion_tokens: 8192,
				},
				{ gateway: { id: gatewayId, collectLog: false } },
			);
			return readLabels(textOf(out), lines);
		},
	};
}

// ---------------------------------------------------------------------------------------------
// The fake

/** The Buckets the fake model knows, by words in a merchant's statement line. */
const STUB_BUCKETS: [string, (typeof DRAFT_BUCKET_NAMES)[number]][] = [
	["costco", "Groceries"],
	["trader joe", "Groceries"],
	["safeway", "Groceries"],
	["chipotle", "Eating out"],
	["starbucks", "Eating out"],
	["shell", "Gas"],
	["chevron", "Gas"],
	["target", "Shopping"],
	["amazon", "Shopping"],
];

/** Names the fake model knows, by words in a statement line. */
const STUB_NAMES: [string, string][] = [["netflix", "Netflix"]];

/**
 * A deterministic stand-in for the model (AI_MODEL=stub, unit tests): merchants sort by the
 * words above, and lines are named by the names above, else by their plain name.
 */
export const stubDraftModel: DraftModel = {
	async label(toSort, toName) {
		const lines = linesToLabel(toSort, toName).map((line) => {
			const text = line.description.toLowerCase();
			return {
				code: line.code,
				name: STUB_NAMES.find(([word]) => text.includes(word))?.[1] ?? plainName(line.description),
				bucket: STUB_BUCKETS.find(([word]) => text.includes(word))?.[1] ?? NO_BUCKET,
			};
		});
		return readLabels(JSON.stringify({ lines }), linesToLabel(toSort, toName));
	},
};
