import { describe, expect, it } from "vitest";
import { describeEval, runEval } from "./ai-eval";
import { EVAL_SET } from "./ai-eval-set";
import { stubClassifier } from "./categorize-model";
import { stubNamer } from "./merchant-model";

// The eval set through the whole filing pipeline with AI_MODEL=stub's model and namer. The floors
// sit just under today's results, so a regression in the cleaner, Rules or similar merchants fails.
// The real model's accuracy comes from the opt-in `bun run eval:ai` (scripts/eval-ai.ts).

describe("background AI eval set (stub)", () => {
	it("has about 60 lines", () => {
		expect(EVAL_SET.length).toBeGreaterThanOrEqual(55);
	});

	it("files most lines right, and few wrong", async () => {
		const before = await runEval({ classifier: stubClassifier }, "before");
		const after = await runEval({ classifier: stubClassifier, namer: stubNamer }, "after");
		console.log(`Eval (stub) before: ${describeEval(before)}`);
		console.log(`Eval (stub) after: ${describeEval(after)}`);
		// Today: 35 of 60 right after (58%), 32 before; 2 wrong (Costco and Safeway fuel, which the
		// stub takes for groceries). The rest go to Review, never a wrong Bucket.
		expect(after.accuracy).toBeGreaterThanOrEqual(0.55);
		expect(after.wrong).toBeLessThanOrEqual(2);
		expect(after.right).toBeGreaterThan(before.right);
	});
});
