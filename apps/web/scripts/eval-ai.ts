// The eval set (src/server/ai-eval-set.ts) against the real models, through the AI Gateway: opt-in,
// it costs a little. Never run by CI or the tests. Run it by hand when changing the cleaner, the
// prompts or the models (ADR-0027):
//
//   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… AI_GATEWAY_ID=noodle bun run eval:ai
//
// The token needs Workers AI read. It prints accuracy before merchant names (the raw line's key)
// and after (cleaner, then the naming model for what it isn't sure of), with the same Rules and
// filed merchants (similar merchants by the stub's word match, not Vectorize). Counts only.

import { describeEval, runEval } from "../src/server/ai-eval";
import { workersAiClassifier } from "../src/server/categorize-model";
import { workersAiNamer } from "../src/server/merchant-model";

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const gatewayId = process.env.AI_GATEWAY_ID ?? "noodle";
if (!account || !token) {
	console.error(
		"Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to run the eval against the real model.",
	);
	process.exit(1);
}

/** The Workers AI binding's `run`, over the AI Gateway's REST endpoint. */
const ai = {
	async run(model: string, inputs: unknown) {
		const response = await fetch(
			`https://gateway.ai.cloudflare.com/v1/${account}/${gatewayId}/workers-ai/${model}`,
			{
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify(inputs),
			},
		);
		if (!response.ok) throw new Error(`Workers AI answered ${response.status}`);
		const body = (await response.json()) as { result: unknown };
		return body.result;
	},
} as unknown as Ai;

const classifier = workersAiClassifier(ai, gatewayId);
const started = Date.now();
const before = await runEval({ classifier }, "before");
console.log(`Before merchant names: ${describeEval(before)}`);
const after = await runEval({ classifier, namer: workersAiNamer(ai, gatewayId) }, "after");
console.log(`After merchant names:  ${describeEval(after)}`);
console.log(`${((Date.now() - started) / 1000).toFixed(1)} s`);
