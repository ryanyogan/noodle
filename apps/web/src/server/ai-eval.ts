import type { Uncategorized } from "@noodle/db";
import { cleanMerchant } from "@noodle/domain";
import { EVAL_BUCKETS, EVAL_FILED, EVAL_RULES, EVAL_SET } from "./ai-eval-set";
import { type Classifier, type MerchantIndex, memoryMerchants } from "./categorize-model";
import { decideRows } from "./categorize-run";
import type { MerchantNamer } from "./merchant-model";

// Runs the eval set (ai-eval-set.ts) through the filing pipeline as background AI does it
// (ADR-0027): the cleaner names each line (the model naming what it isn't sure of), then a Rule,
// a similar merchant the Household filed before, and the model decide, with ADR-0021's thresholds.
// "before" is the pipeline as it was before merchant names: the raw line's key, no cleaner.
// Only counts come out, never a merchant.

export type EvalResult = {
	total: number;
	/** Filed into the expected Bucket. */
	right: number;
	/** Filed, but into another Bucket: the costly mistake. */
	wrong: number;
	/** Sent to Review (a guess or none): safe, but a Parent's job. */
	review: number;
	accuracy: number;
	methods: Record<"rule" | "similar" | "model" | "none", number>;
};

const HOUSEHOLD = "eval";

export async function runEval(
	deps: { classifier: Classifier; namer?: MerchantNamer; merchants?: MerchantIndex },
	mode: "before" | "after" = "after",
): Promise<EvalResult> {
	const buckets = EVAL_BUCKETS.map((name, i) => ({ id: `b${i + 1}`, name }));
	const idOf = (name: string) => buckets.find((bucket) => bucket.name === name)?.id as string;
	const rules = EVAL_RULES.map((rule, i) => ({
		id: `r${i + 1}`,
		pattern: rule.pattern,
		bucketId: idOf(rule.bucket),
	}));
	const merchants = deps.merchants ?? memoryMerchants();
	for (const filed of EVAL_FILED)
		await merchants.learn(HOUSEHOLD, filed.merchant, idOf(filed.bucket));

	const names = mode === "after" ? await nameLines(deps.namer) : new Map<string, string>();
	const rows: Uncategorized[] = EVAL_SET.map((item, i) => ({
		id: `t${i + 1}`,
		date: "2026-10-01",
		amountCents: 2500,
		note: item.line,
		merchant: names.get(item.line) ?? null,
	}));
	const decisions = await decideRows(
		{ classifier: deps.classifier, merchants },
		HOUSEHOLD,
		buckets,
		rules,
		rows,
		"the eval set",
	);
	const result: EvalResult = {
		total: rows.length,
		right: 0,
		wrong: 0,
		review: 0,
		accuracy: 0,
		methods: { rule: 0, similar: 0, model: 0, none: 0 },
	};
	decisions.forEach((decision, i) => {
		const { categorization } = decision;
		result.methods[categorization.method] += 1;
		if (categorization.outcome !== "filed") result.review += 1;
		else if (categorization.bucketId === idOf(EVAL_SET[i]?.bucket as string)) result.right += 1;
		else result.wrong += 1;
	});
	result.accuracy = result.right / result.total;
	return result;
}

/** As merchant-run.ts names: the cleaner's sure names, the model for the rest, else the cleaner's guess. */
async function nameLines(namer: MerchantNamer | undefined): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	const guesses = new Map<string, string>();
	for (const { line } of EVAL_SET) {
		const cleaned = cleanMerchant(line);
		if (cleaned.sure) names.set(line, cleaned.name);
		else guesses.set(line, cleaned.name);
	}
	let modelled = new Map<string, string>();
	if (namer && guesses.size > 0) {
		modelled = await namer.name([...guesses.keys()]).catch(() => new Map<string, string>());
	}
	for (const [line, guess] of guesses) names.set(line, modelled.get(line) ?? guess);
	return names;
}

export const describeEval = (result: EvalResult) =>
	`${result.right}/${result.total} right (${(result.accuracy * 100).toFixed(1)}%), ${result.wrong} wrong, ${result.review} for Review (rule ${result.methods.rule}, similar ${result.methods.similar}, model ${result.methods.model}, none ${result.methods.none})`;
