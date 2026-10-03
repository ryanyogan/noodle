/** Workers AI model per job. Money math never happens in a model: domain code computes, models pick tools and phrase. */
export const AI_MODELS = {
	/** Ask, Check-in phrasing: fast tool calling, cheap, cached input. $0.15/$0.50 per M. */
	chat: "@cf/zai-org/glm-5.3-flash",
	/** Categorization, receipt line items (photos too), spoken Quick Adds: high volume, short JSON out. MoE with 4B active. $0.10/$0.30 per M. */
	classify: "@cf/google/gemma-4-26b-a4b-it",
	/** Merchant names the normaliser can't settle (ADR-0027): a few short JSON lines a run, the same small MoE as classify. */
	name: "@cf/google/gemma-4-26b-a4b-it",
	/** Insights, Plan drafting: nightly/one-off, latency doesn't matter, strongest reasoning at mid price. $0.35/$0.75 per M. */
	reason: "@cf/openai/gpt-oss-120b",
	/** Merchant similarity in Vectorize. $0.012 per M. */
	embed: "@cf/qwen/qwen3-embedding-0.6b",
} as const;

/**
 * Which model each background AI step uses (ADR-0027, "Models per step"). Bucket naming is
 * deterministic (no model); the others name an `AI_MODELS` entry so a change is made in one place.
 */
export const BACKGROUND_AI_MODELS = {
	/** Merchant names the normaliser can't settle: a few short JSON lines, the small MoE. */
	nameLeftovers: AI_MODELS.name,
	/** Filing what no Rule or similar merchant decides: the current classify model. */
	file: AI_MODELS.classify,
	/** Suggested Buckets' names: from a merchant-kind list, no model. */
	nameBuckets: null,
	/** Insights' grouping and plainer words: the current reasoning model. */
	insights: AI_MODELS.reason,
} as const;
