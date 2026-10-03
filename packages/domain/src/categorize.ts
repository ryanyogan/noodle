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

/**
 * How alike a merchant must be to one filed before for that Bucket to be kept as a guess for
 * Review (never filed). Between this and SIMILAR_MERCHANT_SCORE are different merchants of the same
 * kind ("hulu" to "netflix" scores 0.83), sometimes not ("walmart supercenter" to "the home
 * depot", also 0.83): good enough to suggest, with the merchant named, so the Parent can judge.
 */
export const SIMILAR_GUESS_SCORE = 0.75;

/** How a Transaction came to be filed. */
export type CategorizationMethod = "rule" | "similar" | "model";

/** Where a Review guess came from, or "none" when nothing had one. */
export type GuessMethod = CategorizationMethod | "none";

/** What categorization decided for one imported Transaction. */
export type Categorization =
	| {
			outcome: "filed";
			method: CategorizationMethod;
			/** Null only when a Rule filed it to `commitmentId` instead. */
			bucketId: string | null;
			commitmentId?: string | null;
			confidence: number;
			/** Who it was For, when a Rule that says so filed it; otherwise it's left as it is. */
			for?: string[];
			/** Why: the merchant filed before it was like, or the model's few words. */
			reason?: string | null;
	  }
	/** Left unassigned for Review, with the best guess if there was one, and where it came from. */
	| {
			outcome: "review";
			method: GuessMethod;
			bucketId: string | null;
			confidence: number | null;
			reason?: string | null;
	  };

/**
 * A stated mapping from a merchant pattern (a merchantKey, matched as whole words) to a Bucket
 * and, optionally, who it's For (Member IDs; none means the whole Household). A private Rule is
 * one into a Parent's own Personal Allowance: only that Parent sees it, and only their Imports
 * use it.
 */
/** A Rule files into a Bucket or, with `bucketId` null, a Commitment (ADR-0030). */
export type Rule = {
	pattern: string;
	bucketId: string | null;
	commitmentId?: string | null;
	for?: string[];
	private?: boolean;
};

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

/**
 * The Rule for a merchant: the one whose pattern appears in it as whole words, longest first.
 * Between a Household Rule and a Parent's private one for the same pattern, theirs wins: they
 * stated it for themselves.
 */
export function ruleFor<R extends Rule>(rules: R[], merchant: string): R | undefined {
	const padded = ` ${merchant} `;
	return rules
		.filter((rule) => rule.pattern.trim() && padded.includes(` ${rule.pattern.trim()} `))
		.sort(
			(a, b) =>
				b.pattern.trim().length - a.pattern.trim().length ||
				Number(b.private ?? false) - Number(a.private ?? false),
		)[0];
}

/**
 * What to do with an imported Transaction, given what each source said about its merchant, only
 * ever among Buckets the importing Parent may assign (the caller leaves the others out): a Rule
 * files it; failing that, a merchant filed before that's alike enough; failing that, the model's
 * guess if it's sure enough. Otherwise it's left for Review with a guess: the model's Bucket, if
 * it named one, else the merchant filed before if it's at least SIMILAR_GUESS_SCORE alike.
 */
export function decideCategorization(said: {
	rule?: Rule;
	/** The nearest merchant filed before: its Bucket, how alike (0–1), and its name. */
	similar?: { bucketId: string; score: number; merchant?: string };
	/** The model's guess, how sure (0–1), and its few words on why. */
	model?: { bucketId: string | null; confidence: number; why?: string };
}): Categorization {
	if (said.rule) {
		return {
			outcome: "filed",
			method: "rule",
			bucketId: said.rule.bucketId,
			commitmentId: said.rule.commitmentId ?? null,
			confidence: 1,
			for: said.rule.for ?? [],
		};
	}
	if (said.similar && said.similar.score >= SIMILAR_MERCHANT_SCORE) {
		return {
			outcome: "filed",
			method: "similar",
			bucketId: said.similar.bucketId,
			confidence: said.similar.score,
			reason: said.similar.merchant ?? null,
		};
	}
	const model = said.model;
	if (model?.bucketId && model.confidence >= AUTO_FILE_CONFIDENCE) {
		return {
			outcome: "filed",
			method: "model",
			bucketId: model.bucketId,
			confidence: model.confidence,
			reason: model.why ?? null,
		};
	}
	if (model?.bucketId) {
		return {
			outcome: "review",
			method: "model",
			bucketId: model.bucketId,
			confidence: model.confidence,
			reason: model.why ?? null,
		};
	}
	if (said.similar && said.similar.score >= SIMILAR_GUESS_SCORE) {
		return {
			outcome: "review",
			method: "similar",
			bucketId: said.similar.bucketId,
			confidence: said.similar.score,
			reason: said.similar.merchant ?? null,
		};
	}
	return { outcome: "review", method: "none", bucketId: null, confidence: null, reason: null };
}
