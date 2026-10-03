import {
	type CategorizationDecision,
	type Db,
	fileCategorizations,
	loadCategorizableBuckets,
	loadCorrection,
	loadReviewToLookAgain,
	loadRules,
	loadUncategorized,
	loadUncategorizedTransaction,
	settleCategorization,
	type Uncategorized,
	type Viewer,
} from "@noodle/db";
import {
	decideCategorization,
	type GuessMethod,
	merchantKey,
	type Rule,
	ruleFor,
} from "@noodle/domain";
import {
	type Classification,
	type Classifier,
	MERCHANTS_PER_PROMPT,
	type MerchantIndex,
	type MerchantToFile,
	type Neighbour,
} from "./categorize-model";

// Categorizing an Import, apart from the Worker so unit tests can run it with fakes. Everything is
// done for the Parent who imported (the Viewer): the Rules, merchants, and model only ever choose
// among the Buckets they may assign, so another Parent's Personal Allowance never reaches the
// model's context or gets a Transaction filed into it (ADR-0003). The model sees statement lines
// and Bucket names only, never other Transactions.

export type CategorizeDeps = { db: Db; classifier: Classifier; merchants: MerchantIndex };

export type CategorizeResult = {
	filed: number;
	review: number;
	months: string[];
	/** How many were filed or guessed by each method; "none" had no guess. */
	methods: Record<GuessMethod, number>;
};

const noMethods = (): Record<GuessMethod, number> => ({ rule: 0, similar: 0, model: 0, none: 0 });

/** One line for the logs: counts only, never merchants. */
export const describeResult = (result: CategorizeResult) =>
	`${result.filed} filed, ${result.review} for Review (rule ${result.methods.rule}, similar ${result.methods.similar}, model ${result.methods.model}, none ${result.methods.none})`;

/**
 * Files an Import's uncategorized Transactions: by Rule, else by a merchant the Household filed
 * before, else by the model when it's sure; the rest are flagged for Review. Each distinct
 * merchant is looked up once, and the model gets them in a few prompts at once. If similarity or
 * the model fails, what they would have filed goes to Review instead.
 */
export async function categorizeImport(
	deps: CategorizeDeps,
	viewer: Viewer,
	importId: string,
): Promise<CategorizeResult> {
	const rows = await loadUncategorized(deps.db, viewer.householdId, importId);
	return categorize(deps, viewer, rows, `Import ${importId}`);
}

/**
 * Looks again at what waits in Review that `viewer` imported, the same way, against the Plan as it
 * is now (after Buckets are added, say): what's now sure is filed, the rest gets a new guess, or
 * none. Idempotent: looking again with nothing changed decides the same.
 */
export async function lookAgainAtReview(
	deps: CategorizeDeps,
	viewer: Viewer,
): Promise<CategorizeResult> {
	const rows = await loadReviewToLookAgain(deps.db, viewer);
	return categorize(deps, viewer, rows, `Review for ${viewer.memberId}`);
}

/**
 * Files a captured Quick Add the same way, for the Parent who captured it (the Viewer): its note
 * is the merchant Wallet named. Nothing to do once it's assigned or categorized, so a redelivered
 * capture is categorized once.
 */
export async function categorizeCapture(
	deps: CategorizeDeps,
	viewer: Viewer,
	transactionId: string,
): Promise<CategorizeResult> {
	const rows = await loadUncategorizedTransaction(deps.db, viewer.householdId, transactionId);
	return categorize(deps, viewer, rows, `Quick Add ${transactionId}`);
}

async function categorize(
	deps: CategorizeDeps,
	viewer: Viewer,
	rows: Uncategorized[],
	/** What's categorized, for the logs: an ID, never a merchant. */
	label: string,
): Promise<CategorizeResult> {
	const { db } = deps;
	if (rows.length === 0) return { filed: 0, review: 0, months: [], methods: noMethods() };
	const months = [...new Set(rows.map((row) => row.date.slice(0, 7)))].sort();
	const [buckets, allRules] = await Promise.all([
		loadCategorizableBuckets(db, viewer, months[0] as string, months.at(-1) as string),
		// Never the other Parent's private Rules.
		loadRules(db, viewer),
	]);
	const choosable = new Set(buckets.map((bucket) => bucket.id));
	// Nor one into a Bucket this Parent can't assign, or that isn't in the Plan for these months.
	const rules = allRules.filter((rule) => choosable.has(rule.bucketId));
	const decisions = await decideRows(deps, viewer.householdId, buckets, rules, rows, label);
	await fileCategorizations(db, viewer, decisions);
	const filed = decisions.filter((d) => d.categorization.outcome === "filed").length;
	const methods = noMethods();
	for (const { categorization } of decisions) methods[categorization.method] += 1;
	return { filed, review: decisions.length - filed, months, methods };
}

/**
 * The filing pipeline's decisions for some rows, without the database: Rule, then a similar
 * merchant, then the model, with ADR-0021's thresholds. `buckets` and `rules` are the Viewer's
 * own, already limited to what they may choose. The eval set (ai-eval.ts) runs this too.
 */
export async function decideRows<R extends Rule & { id: string }>(
	deps: Pick<CategorizeDeps, "classifier" | "merchants">,
	householdId: string,
	buckets: { id: string; name: string }[],
	rules: R[],
	rows: Uncategorized[],
	/** What's categorized, for the logs: an ID, never a merchant. */
	label: string,
): Promise<CategorizationDecision[]> {
	const choosable = new Set(buckets.map((bucket) => bucket.id));

	// By the clean merchant name once named (ADR-0027); a Rule stated for the raw text still matches.
	const merchantOf = new Map(
		rows.map((row) => [row.id, merchantKey(row.merchant ?? row.note ?? "")]),
	);
	const ruleOf = (merchant: string, row: Uncategorized) =>
		ruleFor(rules, merchant) ?? ruleFor(rules, merchantKey(row.note ?? ""));
	const byMerchant = new Map<string, Uncategorized>();
	for (const row of rows) {
		const merchant = merchantOf.get(row.id) as string;
		if (!byMerchant.has(merchant)) byMerchant.set(merchant, row);
	}
	const unruled = [...byMerchant.entries()]
		.filter(([merchant, row]) => !ruleOf(merchant, row))
		.map(([merchant]) => merchant);

	const similar = await nearest(deps.merchants, householdId, unruled, choosable);
	const toModel: MerchantToFile[] = unruled
		.filter((merchant) => !similarEnough(similar.get(merchant)))
		.map((merchant) => {
			const row = byMerchant.get(merchant) as Uncategorized;
			return {
				key: merchant,
				description: row.merchant ?? row.note ?? merchant,
				amountCents: row.amountCents,
			};
		});
	const modelled = await classify(
		deps.classifier,
		buckets.map(({ id, name }) => ({ id, name })),
		toModel,
		label,
	);

	// An unsure guess of the importing Parent's own Personal Allowance is kept (never filed): only
	// they see it in Review (loadReview); the other Parent's is never choosable here.
	const decisions = rows.map((row): CategorizationDecision => {
		const merchant = merchantOf.get(row.id) as string;
		const guess = modelled.get(merchant);
		const rule = ruleOf(merchant, row);
		const categorization = decideCategorization({
			rule,
			similar: similar.get(merchant),
			model:
				guess && (guess.bucketId === null || choosable.has(guess.bucketId))
					? { bucketId: guess.bucketId, confidence: guess.confidence, why: guess.why }
					: undefined,
		});
		return { transactionId: row.id, merchant, categorization, ruleId: rule?.id };
	});
	return decisions;
}

const similarEnough = (neighbour: Neighbour | undefined) =>
	neighbour !== undefined && decideCategorization({ similar: neighbour }).outcome === "filed";

/** The nearest filed merchant for each, kept only when it's in a Bucket this Parent may choose. */
async function nearest(
	merchants: MerchantIndex,
	householdId: string,
	keys: string[],
	choosable: Set<string>,
): Promise<Map<string, Neighbour>> {
	if (keys.length === 0) return new Map();
	try {
		const found = await merchants.nearest(householdId, keys);
		return new Map([...found].filter(([, neighbour]) => choosable.has(neighbour.bucketId)));
	} catch (error) {
		console.error("Couldn’t look up similar merchants", error);
		return new Map();
	}
}

/** The model's guesses, by merchant, asked in prompts of MERCHANTS_PER_PROMPT merchants each, in parallel. */
async function classify(
	classifier: Classifier,
	buckets: { id: string; name: string }[],
	merchants: MerchantToFile[],
	label: string,
): Promise<Map<string, Classification>> {
	if (merchants.length === 0 || buckets.length === 0) return new Map();
	const batches: MerchantToFile[][] = [];
	for (let i = 0; i < merchants.length; i += MERCHANTS_PER_PROMPT) {
		batches.push(merchants.slice(i, i + MERCHANTS_PER_PROMPT));
	}
	const answers = await Promise.all(
		batches.map((batch) =>
			classifier.classify(buckets, batch).catch((error: unknown) => {
				console.error("Couldn’t categorize with the model", error);
				return [] as Classification[];
			}),
		),
	);
	answers.forEach((answer, i) => {
		const problems = [...new Set(answer.flatMap((a) => (a.problem ? [a.problem] : [])))];
		if (problems.length === 0) return;
		const unread = answer.filter((a) => a.problem).length;
		console.warn(
			`Couldn’t read the model’s answer for ${label} (prompt ${i + 1}): ${unread} of ${batches[i]?.length} merchants, ${problems.join(", ")}`,
		);
	});
	return new Map(answers.flat().map((answer) => [answer.key, answer]));
}

/**
 * After a Parent changes or confirms a Transaction: it leaves categorization (no marker, not in
 * Review), and, if it's an imported one now in a Bucket, `teach` has the Household's merchant
 * index learn its merchant goes there, so the next statement's line for it is filed alike.
 * Teaching calls the embedding model, so the caller can run it after responding.
 */
export async function settleAssignment(
	deps: Pick<CategorizeDeps, "db" | "merchants">,
	viewer: Viewer,
	transactionId: string,
): Promise<{ teach: () => Promise<void> }> {
	const correction = await loadCorrection(deps.db, viewer, transactionId);
	await settleCategorization(deps.db, viewer.householdId, transactionId);
	return {
		teach: async () => {
			if (!correction) return;
			await deps.merchants.learn(viewer.householdId, correction.merchant, correction.bucketId);
		},
	};
}
