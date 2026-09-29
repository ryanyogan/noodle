import { AI_MODELS } from "@noodle/ai";
import { findSpokenAmount } from "@noodle/domain";
import type { BucketChoice } from "./categorize-model";
import type { MemberChoice } from "./receipt-model";

// The model behind a spoken or typed Quick Add ("forty on pizza after hockey"), behind one small
// interface so reading a phrase is the same for Workers AI and for the deterministic fake E2E and
// unit tests use (ADR-0012). The model only points: at the words that say the amount, at a Bucket
// and Members from those offered, and at a short note. The amount is read from those words by
// @noodle/domain (spokenAmount). Calls go through AI Gateway with `collectLog: false`: a phrase
// says where a Parent spent and on what.

/** What the model read from a phrase: everything as said, null for what it couldn't find. */
export type PhraseReading = {
	/** The words of the phrase that say the amount, as said ("forty", "$12.50"). */
	amount: string | null;
	bucketId: string | null;
	for: string[];
	note: string | null;
};

export type PhraseReader = {
	/** Reads a phrase, choosing its Bucket from `buckets` and For from `members` only. */
	read(phrase: string, buckets: BucketChoice[], members: MemberChoice[]): Promise<PhraseReading>;
};

/** Nothing read: what a failed model call comes to. */
export const NOTHING_SAID: PhraseReading = { amount: null, bucketId: null, for: [], note: null };

/** The longest phrase read: a sentence or two, as said. */
export const MAX_PHRASE = 200;

// ---------------------------------------------------------------------------------------------
// Workers AI

const SYSTEM = `A parent in a US household said or typed what they just spent, for the family
budget: "forty on pizza after hockey", "$12.50 at Target for Maya", "twelve fifty gas".
Give "amount": the words of the phrase that say how much was spent, copied exactly as they appear
(for example "forty", "$12.50", "twelve fifty"), or "" if it says no amount. Never turn words into
digits, add up or change them.
Give "bucket": the one Bucket the spending belongs to, only from the Buckets listed, by its code, or
"none" if none clearly fits.
Give "for": the Member codes it was for, only when the phrase names them, else an empty list.
Give "note": what it was, in at most six words from the phrase, without the amount.
Answer in JSON only.`;

/** The prompt: Buckets and Members by short codes, so the answer can't invent IDs. */
export function phrasePrompt(phrase: string, buckets: BucketChoice[], members: MemberChoice[]) {
	const bucketLines = buckets.map((bucket, i) => `b${i + 1}: ${bucket.name}`);
	const memberLines = members.map((member, i) => `p${i + 1}: ${member.name}`);
	return `Buckets:\n${bucketLines.join("\n")}\n\nMembers:\n${memberLines.join("\n") || "(none)"}\n\nSaid: ${phrase}`;
}

function answerSchema(buckets: BucketChoice[], members: MemberChoice[]) {
	const memberCodes = members.map((_, i) => `p${i + 1}`);
	return {
		type: "object",
		properties: {
			amount: { type: "string" },
			bucket: { type: "string", enum: [...buckets.map((_, i) => `b${i + 1}`), "none"] },
			for: {
				type: "array",
				items: memberCodes.length > 0 ? { type: "string", enum: memberCodes } : {},
			},
			note: { type: "string" },
		},
		required: ["amount", "bucket", "for", "note"],
	};
}

const text = (value: unknown) =>
	typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/**
 * The model's answer read back: codes mapped to IDs, anything outside the lists dropped. Tolerates
 * a fenced or prefixed JSON answer; one that isn't JSON reads as nothing.
 */
export function readPhraseAnswer(
	answer: string,
	buckets: BucketChoice[],
	members: MemberChoice[],
): PhraseReading {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1));
	} catch {
		return NOTHING_SAID;
	}
	if (!parsed || typeof parsed !== "object") return NOTHING_SAID;
	const codeOf = (value: unknown, prefix: string) => {
		const match = typeof value === "string" ? new RegExp(`^${prefix}(\\d+)$`).exec(value) : null;
		return match ? Number(match[1]) - 1 : -1;
	};
	const forCodes = Array.isArray(parsed.for) ? parsed.for : [];
	return {
		amount: text(parsed.amount)?.slice(0, 60) ?? null,
		bucketId: buckets[codeOf(parsed.bucket, "b")]?.id ?? null,
		for: [...new Set(forCodes.flatMap((code) => members[codeOf(code, "p")]?.id ?? []))],
		note: text(parsed.note)?.slice(0, 80) ?? null,
	};
}

/** Phrases on Workers AI (AI_MODELS.classify: short JSON, fast), through AI Gateway `gatewayId`. */
export function workersAiPhraseReader(ai: Ai, gatewayId: string): PhraseReader {
	return {
		async read(phrase, buckets, members) {
			const out = await ai.run(
				AI_MODELS.classify,
				{
					messages: [
						{ role: "system", content: SYSTEM },
						{ role: "user", content: phrasePrompt(phrase, buckets, members) },
					],
					response_format: {
						type: "json_schema",
						json_schema: { name: "phrase", schema: answerSchema(buckets, members) },
					},
					// JSON only, no thinking: the domain reads the amount.
					chat_template_kwargs: { enable_thinking: false },
					temperature: 0,
					max_completion_tokens: 300,
				},
				{ gateway: { id: gatewayId, collectLog: false } },
			);
			const answer = out.choices[0]?.message?.content;
			return readPhraseAnswer(typeof answer === "string" ? answer : "", buckets, members);
		},
	};
}

// ---------------------------------------------------------------------------------------------
// The fake

/** Words the fake model knows, by the word a Bucket's name must contain to take them. */
const STUB_KNOWS: Record<string, string[]> = {
	eat: ["pizza", "burrito", "latte", "coffee", "lunch", "dinner", "takeout"],
	grocer: ["milk", "eggs", "groceries", "costco", "bread"],
	gas: ["gas", "fuel", "shell"],
	kids: ["toy", "lego", "backpack"],
};

const escaped = (literal: string) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A deterministic stand-in for the model (AI_MODEL=stub, unit tests): the amount is the first
 * run of words that says one; the Bucket is one whose name has the right word for a thing it
 * knows ("pizza" to "Eating out"), else one the phrase names; For is every Member it names; the
 * note is what's left after the amount, without a leading "on", "at" or "for".
 */
export const stubPhraseReader: PhraseReader = {
	async read(phrase, buckets, members) {
		const lower = phrase.toLowerCase();
		const said = findSpokenAmount(phrase)?.said ?? null;
		let bucketId: string | null = null;
		for (const [word, known] of Object.entries(STUB_KNOWS)) {
			const bucket = buckets.find((b) => b.name.toLowerCase().includes(word));
			if (bucket && known.some((thing) => new RegExp(`\\b${thing}\\b`).test(lower))) {
				bucketId = bucket.id;
				break;
			}
		}
		bucketId ??= buckets.find((b) => lower.includes(b.name.toLowerCase()))?.id ?? null;
		const rest = (said ? lower.replace(said, " ") : lower)
			.replace(/[$]/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.replace(/^(on|at|for)\s+/, "");
		return {
			amount: said,
			bucketId,
			for: members
				.filter((member) => new RegExp(`\\b${escaped(member.name.toLowerCase())}\\b`).test(lower))
				.map((member) => member.id),
			note: rest || null,
		};
	},
};
