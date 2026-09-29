/** Workers AI model per job. Money math never happens in a model: domain code computes, models pick tools and phrase. */
export const AI_MODELS = {
	/** Ask, Check-in phrasing: fast tool calling, cheap, cached input. $0.15/$0.50 per M. */
	chat: "@cf/zai-org/glm-5.3-flash",
	/** Categorization, receipt line items: high volume, short JSON out. MoE with 4B active. $0.10/$0.30 per M. */
	classify: "@cf/google/gemma-4-26b-a4b-it",
	/** Insights, Plan drafting: nightly/one-off, latency doesn't matter, strongest reasoning at mid price. $0.35/$0.75 per M. */
	reason: "@cf/openai/gpt-oss-120b",
	/** Merchant similarity in Vectorize. $0.012 per M. */
	embed: "@cf/qwen/qwen3-embedding-0.6b",
	/** Snap and speak: voice capture. */
	speech: "@cf/openai/whisper-large-v3-turbo",
	/** Snap and speak, receipt photos: vision with function calling. */
	vision: "@cf/meta/llama-4-scout-17b-16e-instruct",
} as const;
