import {
	type CategorizationDecision,
	type Db,
	fileCategorizations,
	loadCategorizableBuckets,
	loadCorrection,
	loadRules,
	loadUncategorized,
	loadUncategorizedTransaction,
	settleCategorization,
	type Uncategorized,
	type Viewer,
} from "@noodle/db";
import { decideCategorization, merchantKey, ruleFor } from "@noodle/domain";
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

export type CategorizeResult = { filed: number; review: number; months: string[] };

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
	return categorize(deps, viewer, await loadUncategorized(deps.db, viewer.householdId, importId));
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
	return categorize(deps, viewer, rows);
}

async function categorize(
	deps: CategorizeDeps,
	viewer: Viewer,
	rows: Uncategorized[],
): Promise<CategorizeResult> {
	const { db } = deps;
	if (rows.length === 0) return { filed: 0, review: 0, months: [] };
	const months = [...new Set(rows.map((row) => row.date.slice(0, 7)))].sort();
	const [buckets, allRules] = await Promise.all([
		loadCategorizableBuckets(db, viewer, months[0] as string, months.at(-1) as string),
		loadRules(db, viewer.householdId),
	]);
	const choosable = new Set(buckets.map((bucket) => bucket.id));
	// A Rule into a Bucket this Parent can't assign (the other's Personal Allowance) isn't theirs.
	const rules = allRules.filter((rule) => choosable.has(rule.bucketId));

	const merchantOf = new Map(rows.map((row) => [row.id, merchantKey(row.note ?? "")]));
	const byMerchant = new Map<string, Uncategorized>();
	for (const row of rows) {
		const merchant = merchantOf.get(row.id) as string;
		if (!byMerchant.has(merchant)) byMerchant.set(merchant, row);
	}
	const unruled = [...byMerchant.keys()].filter((merchant) => !ruleFor(rules, merchant));

	const similar = await nearest(deps.merchants, viewer.householdId, unruled, choosable);
	const toModel: MerchantToFile[] = unruled
		.filter((merchant) => !similarEnough(similar.get(merchant)))
		.map((merchant) => {
			const row = byMerchant.get(merchant) as Uncategorized;
			return { key: merchant, description: row.note ?? merchant, amountCents: row.amountCents };
		});
	const modelled = await classify(
		deps.classifier,
		buckets.map(({ id, name }) => ({ id, name })),
		toModel,
	);

	const personal = new Set(buckets.filter((bucket) => bucket.personal).map((b) => b.id));
	const decisions = rows.map((row): CategorizationDecision => {
		const merchant = merchantOf.get(row.id) as string;
		const guess = modelled.get(merchant);
		const categorization = decideCategorization({
			rule: ruleFor(rules, merchant),
			similar: similar.get(merchant),
			model:
				guess && (guess.bucketId === null || choosable.has(guess.bucketId))
					? { bucketId: guess.bucketId, confidence: guess.confidence }
					: undefined,
		});
		// Review may be seen by either Parent: an unsure guess of a Personal Allowance isn't kept.
		if (
			categorization.outcome === "review" &&
			categorization.bucketId &&
			personal.has(categorization.bucketId)
		) {
			return {
				transactionId: row.id,
				merchant,
				categorization: { outcome: "review", bucketId: null, confidence: null },
			};
		}
		return { transactionId: row.id, merchant, categorization };
	});
	await fileCategorizations(db, viewer, decisions);
	const filed = decisions.filter((d) => d.categorization.outcome === "filed").length;
	return { filed, review: decisions.length - filed, months };
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
