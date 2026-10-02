import { AI_MODELS } from "@noodle/ai";
import type { Cents } from "@noodle/domain";

// The models behind categorization, behind two small interfaces so the pipeline is the same for
// Workers AI and Vectorize and for the deterministic fakes E2E and unit tests use (ADR-0012). All
// model calls go through AI Gateway with `collectLog: false`: statement lines say where a Parent
// spent, and gateway logs are visible to anyone on the Cloudflare account.

/** A Bucket the model may choose, by name. */
export type BucketChoice = { id: string; name: string };

/** A merchant to file, as its statement line described it, with one of its amounts for context. */
export type MerchantToFile = { key: string; description: string; amountCents: Cents };

/**
 * The model's answer for one merchant: a Bucket from those offered, or none, how sure it is, and
 * its few words on why. `problem` says, without the merchant, why an answer couldn't be read.
 */
export type Classification = {
	key: string;
	bucketId: string | null;
	confidence: number;
	why?: string;
	problem?: "not JSON" | "unanswered" | "unknown Bucket code";
};

export type Classifier = {
	/** Chooses a Bucket for each merchant from `buckets` only, answering for every merchant. */
	classify(buckets: BucketChoice[], merchants: MerchantToFile[]): Promise<Classification[]>;
};

/** A merchant the Household filed before: its Bucket, how alike it is (cosine, 0–1), its name. */
export type Neighbour = { bucketId: string; score: number; merchant?: string };

/** Merchants a Household has filed, by embedding, to reuse for merchants like them. */
export type MerchantIndex = {
	/** For each merchant, the most alike one the Household filed, if any. */
	nearest(householdId: string, merchants: string[]): Promise<Map<string, Neighbour>>;
	/** Remembers that the Household files `merchant` in `bucketId` (replacing what it knew). */
	learn(householdId: string, merchant: string, bucketId: string): Promise<void>;
};

/**
 * How many merchants go to the model in one prompt. It answers at about 40 tokens a second, some
 * 40 tokens a merchant, so a prompt of 10 takes about 10 seconds; prompts run in parallel, which
 * keeps a whole statement inside waitUntil's 30 seconds.
 */
export const MERCHANTS_PER_PROMPT = 10;

// ---------------------------------------------------------------------------------------------
// Workers AI and Vectorize

const gateway = (gatewayId: string) => ({ gateway: { id: gatewayId, collectLog: false } });

const SYSTEM = `You file a US household's card and bank transactions into its budget Buckets.
For each merchant, choose the one Bucket it most likely belongs to, only from the Buckets listed, by
its code; or "none" if no Bucket fits. Give your confidence from 0 to 1: above 0.8 only when the
merchant is well known and the Bucket clearly fits. Say why in at most five plain words, like
"looks like dining out". Answer every merchant, in JSON only.`;

/** The prompt for one batch: Buckets and merchants by short codes, so the answer can't invent IDs. */
export function classifyPrompt(buckets: BucketChoice[], merchants: MerchantToFile[]): string {
	const bucketLines = buckets.map((bucket, i) => `b${i + 1}: ${bucket.name}`);
	const merchantLines = merchants.map(
		(merchant, i) =>
			`m${i + 1}: ${merchant.description.replace(/\s+/g, " ").slice(0, 80)} ($${(merchant.amountCents / 100).toFixed(2)})`,
	);
	return `Buckets:\n${bucketLines.join("\n")}\n\nMerchants:\n${merchantLines.join("\n")}`;
}

/** The JSON the model must answer with: one result per merchant code, a Bucket code or "none". */
function answerSchema(buckets: BucketChoice[], merchants: MerchantToFile[]) {
	return {
		type: "object",
		properties: {
			results: {
				type: "array",
				items: {
					type: "object",
					properties: {
						merchant: { type: "string", enum: merchants.map((_, i) => `m${i + 1}`) },
						bucket: { type: "string", enum: [...buckets.map((_, i) => `b${i + 1}`), "none"] },
						confidence: { type: "number", minimum: 0, maximum: 1 },
						why: { type: "string", maxLength: 60 },
					},
					required: ["merchant", "bucket", "confidence"],
				},
			},
		},
		required: ["results"],
	};
}

/**
 * The model's answer read back into Classifications: codes mapped to IDs, anything outside the
 * lists (or unanswered) is "no Bucket". Tolerates a fenced or prefixed JSON answer.
 */
export function readAnswer(
	text: string,
	buckets: BucketChoice[],
	merchants: MerchantToFile[],
): Classification[] {
	const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
	let results: unknown = [];
	let readable = true;
	try {
		results = (JSON.parse(json) as { results?: unknown }).results ?? [];
	} catch {
		readable = false;
	}
	type Answer = { bucket: unknown; confidence: unknown; why?: unknown };
	const answers = new Map<string, Answer>();
	if (Array.isArray(results)) {
		for (const result of results) {
			if (result && typeof result === "object" && "merchant" in result) {
				answers.set(String(result.merchant), result as Answer);
			}
		}
	}
	return merchants.map((merchant, i): Classification => {
		const answer = answers.get(`m${i + 1}`);
		const code = typeof answer?.bucket === "string" ? /^b(\d+)$/.exec(answer.bucket) : null;
		const bucket = code ? buckets[Number(code[1]) - 1] : undefined;
		const confidence = Number(answer?.confidence);
		const why = typeof answer?.why === "string" ? answer.why.trim().slice(0, 60) : "";
		const problem = !readable
			? "not JSON"
			: !answer
				? "unanswered"
				: answer.bucket !== "none" && !bucket
					? "unknown Bucket code"
					: undefined;
		return {
			key: merchant.key,
			bucketId: bucket?.id ?? null,
			confidence: bucket && Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
			...(why && bucket ? { why } : {}),
			...(problem ? { problem } : {}),
		};
	});
}

/** Categorization's model on Workers AI (AI_MODELS.classify), through the AI Gateway `gatewayId`. */
export function workersAiClassifier(ai: Ai, gatewayId: string): Classifier {
	return {
		async classify(buckets, merchants) {
			if (buckets.length === 0 || merchants.length === 0) return [];
			const out = await ai.run(
				AI_MODELS.classify,
				{
					messages: [
						{ role: "system", content: SYSTEM },
						{ role: "user", content: classifyPrompt(buckets, merchants) },
					],
					response_format: {
						type: "json_schema",
						json_schema: { name: "categorization", schema: answerSchema(buckets, merchants) },
					},
					// Short JSON, no thinking: this runs for every Import.
					chat_template_kwargs: { enable_thinking: false },
					temperature: 0,
					max_completion_tokens: 80 * merchants.length + 200,
				},
				gateway(gatewayId),
			);
			const content = out.choices[0]?.message?.content;
			return readAnswer(typeof content === "string" ? content : "", buckets, merchants);
		},
	};
}

/** How many Vectorize matches to look at: the Household's own come first after the filter. */
const TOP_K = 1;

/** Vector IDs are at most 64 bytes: the Household's ID and a hash of the merchant. */
async function vectorId(householdId: string, merchant: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(merchant));
	const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
	return `${householdId}:${hex.slice(0, 32)}`;
}

/**
 * Merchant similarity on Vectorize (the `noodle-merchants` index), embedded with AI_MODELS.embed
 * through the AI Gateway. Every query is filtered to the Household (`householdId` is an indexed
 * metadata field), so one Household never sees another's merchants.
 */
export function vectorizeMerchants(ai: Ai, gatewayId: string, index: Vectorize): MerchantIndex {
	const embed = async (texts: string[]) => {
		const out = await ai.run(AI_MODELS.embed, { text: texts }, gateway(gatewayId));
		return out.data ?? [];
	};
	return {
		async nearest(householdId, merchants) {
			const found = new Map<string, Neighbour>();
			if (merchants.length === 0) return found;
			const vectors = await embed(merchants);
			const matches = await Promise.all(
				vectors.map((vector) =>
					index.query(vector, {
						topK: TOP_K,
						filter: { householdId },
						returnMetadata: "all",
					}),
				),
			);
			matches.forEach((result, i) => {
				const best = result.matches[0];
				const bucketId = best?.metadata?.bucketId;
				// Belt and braces: the filter already keeps to the Household.
				if (best && typeof bucketId === "string" && best.metadata?.householdId === householdId) {
					const merchant = best.metadata?.merchant;
					found.set(merchants[i] as string, {
						bucketId,
						score: best.score,
						...(typeof merchant === "string" ? { merchant } : {}),
					});
				}
			});
			return found;
		},
		async learn(householdId, merchant, bucketId) {
			const [values] = await embed([merchant]);
			if (!values) return;
			await index.upsert([
				{
					id: await vectorId(householdId, merchant),
					values,
					metadata: { householdId, bucketId, merchant },
				},
			]);
		},
	};
}

// ---------------------------------------------------------------------------------------------
// The fakes

/** Merchants the fake model knows, by the word a Bucket's name must contain to take them. */
const STUB_KNOWS: Record<string, string[]> = {
	grocer: ["costco", "kroger", "safeway", "trader joe", "whole foods", "aldi", "publix", "heb"],
	gas: ["shell", "chevron", "exxon", "bp", "marathon", "speedway"],
	eat: ["starbucks", "chipotle", "mcdonald", "panera", "doordash", "chick fil a"],
	stream: ["netflix", "spotify", "hulu", "disney plus"],
	kids: ["target", "old navy", "toys"],
};

/**
 * A deterministic stand-in for the model (AI_MODEL=stub): a merchant it knows goes, sure, to a
 * Bucket whose name has the right word ("Groceries" takes Costco); one whose name is in the
 * merchant goes there, less sure; anything else gets no Bucket.
 */
export const stubClassifier: Classifier = {
	async classify(buckets, merchants) {
		return merchants.map((merchant) => {
			for (const [word, known] of Object.entries(STUB_KNOWS)) {
				const bucket = buckets.find((b) => b.name.toLowerCase().includes(word));
				if (bucket && known.some((name) => merchant.key.includes(name))) {
					return {
						key: merchant.key,
						bucketId: bucket.id,
						confidence: 0.95,
						why: `a ${word} merchant`,
					};
				}
			}
			const named = buckets.find((b) => merchant.key.includes(b.name.toLowerCase()));
			if (named) {
				return { key: merchant.key, bucketId: named.id, confidence: 0.5, why: "named like it" };
			}
			return { key: merchant.key, bucketId: null, confidence: 0 };
		});
	},
};

/**
 * A deterministic stand-in for Vectorize (AI_MODEL=stub, unit tests): merchants are alike only
 * when one's words contain the other's, scored by how many words they share.
 */
export function memoryMerchants(): MerchantIndex & { size(): number } {
	const known = new Map<string, Map<string, string>>();
	return {
		async nearest(householdId, merchants) {
			const found = new Map<string, Neighbour>();
			const filed = known.get(householdId) ?? new Map<string, string>();
			for (const merchant of merchants) {
				const words = new Set(merchant.split(" "));
				for (const [other, bucketId] of filed) {
					const theirs = other.split(" ");
					if (!theirs.every((word) => words.has(word))) continue;
					const score = theirs.length / words.size;
					if (score > (found.get(merchant)?.score ?? 0)) {
						found.set(merchant, { bucketId, score, merchant: other });
					}
				}
			}
			return found;
		},
		async learn(householdId, merchant, bucketId) {
			const filed = known.get(householdId) ?? new Map<string, string>();
			filed.set(merchant, bucketId);
			known.set(householdId, filed);
		},
		size: () => [...known.values()].reduce((sum, filed) => sum + filed.size, 0),
	};
}
