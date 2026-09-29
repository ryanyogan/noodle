// Categorization: filing an imported Transaction into a Bucket without a Parent. Three sources, in
// order: a Rule (stated, always wins), a merchant the Household has filed before (similarity of
// merchant embeddings), then a model's guess. Only a confident answer files it; anything else is
// left unassigned for Review.

/** How sure a model must be (0–1) to file a Transaction on its own. */
export const AUTO_FILE_CONFIDENCE = 0.8;

/**
 * How alike (cosine similarity, 0–1) a merchant must be to one the Household filed before for
 * that filing to be reused. Statement lines for the same merchant differ in store numbers and
 * towns, not in name, so this is high: two different merchants shouldn't pass it. Measured on
 * AI_MODELS.embed: different merchants score up to 0.83 ("walmart supercenter" to "the home
 * depot", "hulu" to "netflix"), a merchant's own lines 0.92 and up ("starbucks coffee" to
 * "starbucks store"). What falls short goes to the model, which knows well-known merchants.
 */
export const SIMILAR_MERCHANT_SCORE = 0.9;

/** How a Transaction came to be filed. */
export type CategorizationMethod = "rule" | "similar" | "model";

/** What categorization decided for one imported Transaction. */
export type Categorization =
	| { outcome: "filed"; method: CategorizationMethod; bucketId: string; confidence: number }
	/** Left unassigned for Review, with the best guess if there was one. */
	| { outcome: "review"; bucketId: string | null; confidence: number | null };

/** A stated mapping from a merchant pattern (a merchantKey, matched as whole words) to a Bucket. */
export type Rule = { pattern: string; bucketId: string };

/** Words statements put around a merchant's name that say nothing about it. */
const NOISE =
	/\b(pos|debit|credit|card|purchase|purchases|recurring|payment|pymt|ach|checkcard|visa|mastercard|dbt|pre ?auth(?:orized)?|authorized|on|ppd|web|id|inc|llc|co|www|com)\b/g;

const US_STATES = new Set(
	"al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc".split(
		" ",
	),
);

/**
 * A statement line's description reduced to what names the merchant: lower case, without store
 * numbers, dates, reference numbers, card-network words, or a trailing US state. So
 * "COSTCO WHSE #0123 SEATTLE WA" and "Costco Whse 0456 Kirkland WA" are both "costco whse …".
 * Never empty for a non-empty description.
 */
export function merchantKey(description: string): string {
	const words = description
		.toLowerCase()
		// Payment processors' prefixes: "SQ *BLUE BOTTLE", "TST* CHIPOTLE".
		.replace(/\b(sq|tst|sp|pp|py|ckr)\s?\*/g, " ")
		.replace(/[*#]/g, " ")
		// Anything with a digit in it: store numbers, dates, phone and reference numbers.
		.replace(/\S*\d\S*/g, " ")
		.replace(/[^a-z&' ]+/g, " ")
		.replace(NOISE, " ")
		.split(/\s+/)
		.filter(Boolean);
	// A trailing state after the name and town: "shell oil houston tx".
	if (words.length > 2 && US_STATES.has(words.at(-1) as string)) words.pop();
	const key = words.join(" ").slice(0, 64).trim();
	return key || description.trim().toLowerCase().slice(0, 64);
}

/** The Rule for a merchant: the one whose pattern appears in it as whole words, longest first. */
export function ruleFor(rules: Rule[], merchant: string): Rule | undefined {
	const padded = ` ${merchant} `;
	return rules
		.filter((rule) => rule.pattern.trim() && padded.includes(` ${rule.pattern.trim()} `))
		.sort((a, b) => b.pattern.length - a.pattern.length)[0];
}

/**
 * What to do with an imported Transaction, given what each source said about its merchant, only
 * ever among Buckets the importing Parent may assign (the caller leaves the others out): a Rule
 * files it; failing that, a merchant filed before that's alike enough; failing that, the model's
 * guess if it's sure enough. Otherwise it's left for Review with the model's guess, if any.
 */
export function decideCategorization(said: {
	rule?: Rule;
	similar?: { bucketId: string; score: number };
	model?: { bucketId: string | null; confidence: number };
}): Categorization {
	if (said.rule) {
		return { outcome: "filed", method: "rule", bucketId: said.rule.bucketId, confidence: 1 };
	}
	if (said.similar && said.similar.score >= SIMILAR_MERCHANT_SCORE) {
		return {
			outcome: "filed",
			method: "similar",
			bucketId: said.similar.bucketId,
			confidence: said.similar.score,
		};
	}
	const model = said.model;
	if (model?.bucketId && model.confidence >= AUTO_FILE_CONFIDENCE) {
		return {
			outcome: "filed",
			method: "model",
			bucketId: model.bucketId,
			confidence: model.confidence,
		};
	}
	return {
		outcome: "review",
		bucketId: model?.bucketId ?? null,
		confidence: model?.bucketId ? model.confidence : null,
	};
}
