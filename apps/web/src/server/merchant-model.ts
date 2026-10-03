import { AI_MODELS } from "@noodle/ai";
import { cleanMerchant } from "@noodle/domain";

// Merchant names the normaliser couldn't settle, from the model (ADR-0027): one batched,
// schema-validated prompt per background run, on the small classify model.

export type MerchantNamer = {
	/** A clean merchant name for each raw statement line it could name, by raw line. */
	name(raws: string[]): Promise<Map<string, string>>;
};

/** At most this many raw lines go to the model in a run; the rest wait for the next. */
export const LEFTOVERS_PER_RUN = 40;

const SYSTEM = `You clean US card and bank statement lines into the merchant's everyday name, as a person
would say it: "COSTCO WHSE #1042 SEATTLE WA" is "Costco", "SQ *BLUE BOTTLE OAKLAND" is "Blue Bottle".
Drop payment processors, store numbers, towns, states, phone numbers and reference codes. Use normal
capitalisation. If you can't tell, give the line's readable words. Answer every line, in JSON only.`;

export function namePrompt(raws: string[]): string {
	return raws.map((raw, i) => `l${i + 1}: ${raw.replace(/\s+/g, " ").slice(0, 80)}`).join("\n");
}

function answerSchema(raws: string[]) {
	return {
		type: "object",
		properties: {
			results: {
				type: "array",
				items: {
					type: "object",
					properties: {
						line: { type: "string", enum: raws.map((_, i) => `l${i + 1}`) },
						name: { type: "string", minLength: 1, maxLength: 40 },
					},
					required: ["line", "name"],
				},
			},
		},
		required: ["results"],
	};
}

/** The model's answer read back: only lines it was asked about, with a plausible name. */
export function readNames(text: string, raws: string[]): Map<string, string> {
	const names = new Map<string, string>();
	let results: unknown;
	try {
		results = (
			JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { results?: unknown }
		).results;
	} catch {
		return names;
	}
	if (!Array.isArray(results)) return names;
	for (const result of results) {
		if (!result || typeof result !== "object") continue;
		const { line, name } = result as { line?: unknown; name?: unknown };
		const index = typeof line === "string" ? /^l(\d+)$/.exec(line) : null;
		const raw = index ? raws[Number(index[1]) - 1] : undefined;
		const clean = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 40) : "";
		// Not a code or number: a name has letters.
		if (raw && /[a-z]/i.test(clean)) names.set(raw, clean);
	}
	return names;
}

const gateway = (gatewayId: string) => ({ gateway: { id: gatewayId, collectLog: false } });

/** On Workers AI (AI_MODELS.name), through the AI Gateway, whose cache answers a repeat prompt. */
export function workersAiNamer(ai: Ai, gatewayId: string): MerchantNamer {
	return {
		async name(raws) {
			if (raws.length === 0) return new Map();
			const out = await ai.run(
				AI_MODELS.name,
				{
					messages: [
						{ role: "system", content: SYSTEM },
						{ role: "user", content: namePrompt(raws) },
					],
					response_format: {
						type: "json_schema",
						json_schema: { name: "merchant_names", schema: answerSchema(raws) },
					},
					chat_template_kwargs: { enable_thinking: false },
					temperature: 0,
					max_completion_tokens: 30 * raws.length + 100,
				},
				gateway(gatewayId),
			);
			const content = out.choices[0]?.message?.content;
			return readNames(typeof content === "string" ? content : "", raws);
		},
	};
}

/** For AI_MODEL=stub: the normaliser's best guess, so tests are deterministic. */
export const stubNamer: MerchantNamer = {
	async name(raws) {
		return new Map(raws.map((raw) => [raw, cleanMerchant(raw).name]));
	},
};
