import type { Classifier, MerchantToFile } from "./categorize-model";
import type { InsightModel } from "./insights-model";
import type { MerchantNamer } from "./merchant-model";

// Background AI's daily model budget and run metrics (ADR-0027), apart from the Agent so unit tests
// can run them with a fake storage and clock. Each Household's Agent keeps one count of model calls
// per UTC day in its own storage. Past the budget the model steps are skipped, quietly: filing sends
// what the model would have guessed to Review, naming keeps the normaliser's guess, and Insights wait
// for the nightly job. Metrics are counts and milliseconds only, never a merchant (ADR-0021).

export const AI_BUDGET = {
	/** Model calls a Household's background AI may make in a UTC day: naming, filing prompts, Insights. */
	modelCallsPerDay: 60,
	/** Insights refreshed by background AI in a day, at most; the nightly job is the backstop. */
	insightRefreshesPerDay: 3,
	/** And at least this long apart, so a busy day refreshes a few times, not every run. */
	insightRefreshGapMs: 2 * 60 * 60 * 1000,
};

export const STUB_AI_BUDGET: typeof AI_BUDGET = {
	modelCallsPerDay: 60,
	insightRefreshesPerDay: 3,
	insightRefreshGapMs: 0,
};

export type BudgetStorage = {
	get<T>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
};

type BudgetState = {
	/** The UTC day the counts are for. */
	day: string;
	calls: number;
	skipped: number;
	refreshes: number;
	/** When background AI last refreshed Insights (ms), across days. */
	refreshedAt: number;
	/** Insights' inputs changed since then. */
	stale: boolean;
};

const KEY = "ai:budget";

export type ModelStep = "name" | "file" | "insights";

/** One step's model use in a run: calls made and skipped, and the time they took. */
type StepMetrics = { calls: number; skipped: number; ms: number };

/**
 * A run's view of the day's budget. Counts are taken in memory (prompts run in parallel), then
 * saved once at the end of the run; the Agent runs one batch at a time, so nothing races it.
 */
export class ModelBudget {
	readonly steps: Record<ModelStep, StepMetrics> = {
		name: { calls: 0, skipped: 0, ms: 0 },
		file: { calls: 0, skipped: 0, ms: 0 },
		insights: { calls: 0, skipped: 0, ms: 0 },
	};

	private constructor(
		private readonly storage: BudgetStorage,
		private readonly state: BudgetState,
		private readonly limits: typeof AI_BUDGET,
		private readonly now: () => number,
	) {}

	static async open(
		storage: BudgetStorage,
		limits: typeof AI_BUDGET = AI_BUDGET,
		now: () => number = Date.now,
	): Promise<ModelBudget> {
		const day = new Date(now()).toISOString().slice(0, 10);
		const saved = await storage.get<BudgetState>(KEY);
		const state: BudgetState =
			saved?.day === day
				? { ...saved }
				: {
						day,
						calls: 0,
						skipped: 0,
						refreshes: 0,
						refreshedAt: saved?.refreshedAt ?? 0,
						stale: saved?.stale ?? false,
					};
		return new ModelBudget(storage, state, limits, now);
	}

	/** True, and counted, when a model call for `step` fits today's budget; else counted as skipped. */
	take(step: ModelStep): boolean {
		if (this.state.calls >= this.limits.modelCallsPerDay) {
			this.state.skipped += 1;
			this.steps[step].skipped += 1;
			return false;
		}
		this.state.calls += 1;
		this.steps[step].calls += 1;
		return true;
	}

	/** Times a model call for `step`. */
	async time<T>(step: ModelStep, call: () => Promise<T>): Promise<T> {
		const started = this.now();
		try {
			return await call();
		} finally {
			this.steps[step].ms += this.now() - started;
		}
	}

	get used(): number {
		return this.state.calls;
	}

	/** Insights' inputs changed: refresh them when the debounce allows. */
	markStale(): void {
		this.state.stale = true;
	}

	/** Whether to refresh Insights now: stale, and not refreshed too often or too lately today. */
	shouldRefreshInsights(): boolean {
		return (
			this.state.stale &&
			this.state.refreshes < this.limits.insightRefreshesPerDay &&
			this.now() - this.state.refreshedAt >= this.limits.insightRefreshGapMs
		);
	}

	refreshedInsights(): void {
		this.state.stale = false;
		this.state.refreshes += 1;
		this.state.refreshedAt = this.now();
	}

	async save(): Promise<void> {
		await this.storage.put(KEY, this.state);
	}

	/** The run's model use, for the log line: counts and milliseconds only. */
	describe(): string {
		const steps = Object.entries(this.steps)
			.filter(([, s]) => s.calls + s.skipped > 0)
			.map(
				([step, s]) =>
					`${step} ${s.calls} calls ${s.ms} ms${s.skipped ? `, ${s.skipped} skipped` : ""}`,
			);
		return `model ${steps.length ? steps.join("; ") : "not called"} (${this.state.calls}/${this.limits.modelCallsPerDay} today)`;
	}
}

/** The classifier, within the budget: past it, no guesses, so those merchants go to Review. */
export function budgetedClassifier(inner: Classifier, budget: ModelBudget): Classifier {
	return {
		async classify(buckets, merchants: MerchantToFile[]) {
			if (merchants.length === 0 || buckets.length === 0) return [];
			if (!budget.take("file")) return [];
			return budget.time("file", () => inner.classify(buckets, merchants));
		},
	};
}

/** The namer, within the budget: past it, no names, so the normaliser's guesses stand. */
export function budgetedNamer(inner: MerchantNamer, budget: ModelBudget): MerchantNamer {
	return {
		async name(raws) {
			if (raws.length === 0 || !budget.take("name")) return new Map();
			return budget.time("name", () => inner.name(raws));
		},
	};
}

/** Insights' model, within the budget: past it, no grouping or plainer words; the facts still show. */
export function budgetedInsightModel(inner: InsightModel, budget: ModelBudget): InsightModel {
	return {
		async group(names) {
			if (names.length === 0 || !budget.take("insights")) return [];
			return budget.time("insights", () => inner.group(names));
		},
		async word(insights) {
			if (insights.length === 0 || !budget.take("insights")) return [];
			return budget.time("insights", () => inner.word(insights));
		},
	};
}
