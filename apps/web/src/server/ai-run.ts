import type { HouseholdChange } from "../household-changes";
import type { AiBatch } from "./ai-coalescer";
import {
	type CategorizeDeps,
	type CategorizeResult,
	categorizeCapture,
	categorizeImport,
	describeResult,
	lookAgainAtReview,
} from "./categorize-run";
import type { MerchantNamer } from "./merchant-model";
import { nameMerchants } from "./merchant-run";
import { spotSuggestions } from "./suggestion-run";

// One background AI run for a Household (ADR-0027), apart from the Agent so unit tests can run it
// with fakes. Filing first: look again at what waits in Review when something it depends on
// changed, then file what's new, all with the existing pipeline (Rule, similar, model) and ADR-0021's
// thresholds. Each Parent's work runs in that Parent's own view only, so another Parent's Personal
// Allowance, Rules and guesses never reach it (ADR-0003). Later phases add steps here.

export type AiRunDeps = CategorizeDeps & {
	/** Names merchants the normaliser can't settle (merchant-model.ts). */
	namer: MerchantNamer;
	/** Asks for another run, when naming had more than one run's share. */
	again?: () => Promise<void>;
	/** The Household's Parents now, for looking again at each one's Review. */
	parents: (householdId: string) => Promise<string[]>;
	/** Tells the Household's open screens what changed. */
	notify: (changes: HouseholdChange[]) => Promise<void>;
};

const add = (a: CategorizeResult, b: CategorizeResult): CategorizeResult => ({
	filed: a.filed + b.filed,
	review: a.review + b.review,
	months: [...new Set([...a.months, ...b.months])].sort(),
	methods: {
		rule: a.methods.rule + b.methods.rule,
		similar: a.methods.similar + b.methods.similar,
		model: a.methods.model + b.methods.model,
		none: a.methods.none + b.methods.none,
	},
});

const nothing = (): CategorizeResult => ({
	filed: 0,
	review: 0,
	months: [],
	methods: { rule: 0, similar: 0, model: 0, none: 0 },
});

/**
 * Runs a batch. Throws when the database does (the coalescer retries); the model or similar
 * merchants failing only sends what they'd have filed to Review. Idempotent: what's filed or
 * decided already isn't loaded again.
 */
export async function runAiBatch(deps: AiRunDeps, batch: AiBatch): Promise<CategorizeResult> {
	const { householdId } = batch;
	let total = nothing();
	// Merchants are named first, so filing, Rules and similar merchants go by the clean name.
	const naming = await nameMerchants(deps, householdId);
	if (naming.more) await deps.again?.();
	// Looked again first, so what's filed next isn't looked at twice.
	if (batch.lookAgain) {
		for (const memberId of await deps.parents(householdId)) {
			total = add(total, await lookAgainAtReview(deps, { householdId, memberId }));
		}
	}
	for (const { memberId, id } of batch.imports) {
		total = add(total, await categorizeImport(deps, { householdId, memberId }, id));
	}
	for (const { memberId, id } of batch.captures) {
		total = add(total, await categorizeCapture(deps, { householdId, memberId }, id));
	}
	// Suggestions rest on spending and Commitments: looked for when either may have changed.
	let suggested = 0;
	if (
		batch.imports.length > 0 ||
		batch.lookAgain ||
		batch.events["commitment-changed"] ||
		batch.events["month-started"]
	) {
		suggested = await spotSuggestions(deps.db, householdId);
	}
	const events = Object.entries(batch.events)
		.map(([kind, count]) => `${kind} ${count}`)
		.join(", ");
	console.log(
		`Background AI for ${householdId} (${events}): ${naming.named} merchants named (${naming.byModel} by the model), ${describeResult(total)}, ${suggested} suggestions changed`,
	);
	// Filing changes spending, which carries into later months.
	if (total.filed + total.review > 0) await deps.notify(["months", "for-earlier", "bucket-uses"]);
	if (suggested > 0) await deps.notify(["suggestions"]);
	return total;
}
