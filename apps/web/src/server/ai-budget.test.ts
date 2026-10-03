import { describe, expect, it } from "vitest";
import {
	AI_BUDGET,
	type BudgetStorage,
	budgetedClassifier,
	budgetedNamer,
	ModelBudget,
} from "./ai-budget";
import type { Classifier } from "./categorize-model";

function memoryStorage(): BudgetStorage & { data: Map<string, unknown> } {
	const data = new Map<string, unknown>();
	return {
		data,
		async get<T>(key: string) {
			return data.get(key) as T | undefined;
		},
		async put<T>(key: string, value: T) {
			data.set(key, structuredClone(value));
		},
	};
}

const at = (iso: string) => () => Date.parse(iso);
const limits = {
	modelCallsPerDay: 3,
	insightRefreshesPerDay: 2,
	insightRefreshGapMs: 60 * 60 * 1000,
};

describe("background AI's daily model budget", () => {
	it("allows calls up to the day's budget, then skips them", async () => {
		const budget = await ModelBudget.open(memoryStorage(), limits, at("2026-10-03T10:00:00Z"));
		expect([budget.take("name"), budget.take("file"), budget.take("file")]).toEqual([
			true,
			true,
			true,
		]);
		expect(budget.take("file")).toBe(false);
		expect(budget.steps.file).toMatchObject({ calls: 2, skipped: 1 });
		expect(budget.describe()).toContain("3/3 today");
	});

	it("keeps the count across runs the same UTC day, and starts again the next", async () => {
		const storage = memoryStorage();
		const first = await ModelBudget.open(storage, limits, at("2026-10-03T22:00:00Z"));
		first.take("file");
		first.take("file");
		await first.save();
		const later = await ModelBudget.open(storage, limits, at("2026-10-03T23:59:00Z"));
		expect(later.used).toBe(2);
		expect(later.take("file")).toBe(true);
		expect(later.take("file")).toBe(false);
		await later.save();
		const tomorrow = await ModelBudget.open(storage, limits, at("2026-10-04T00:01:00Z"));
		expect(tomorrow.used).toBe(0);
	});

	it("past the budget, the classifier gives no guesses and the namer no names, without calling the model", async () => {
		let calls = 0;
		const inner: Classifier = {
			async classify(_buckets, merchants) {
				calls += 1;
				return merchants.map((m) => ({ key: m.key, bucketId: "b1", confidence: 0.99 }));
			},
		};
		const budget = await ModelBudget.open(memoryStorage(), { ...limits, modelCallsPerDay: 1 });
		const classifier = budgetedClassifier(inner, budget);
		const buckets = [{ id: "b1", name: "Groceries" }];
		const merchant = [{ key: "acme", description: "Acme", amountCents: 100 }];
		expect(await classifier.classify(buckets, merchant)).toHaveLength(1);
		expect(await classifier.classify(buckets, merchant)).toEqual([]);
		expect(calls).toBe(1);
		const namer = budgetedNamer({ name: async () => new Map([["X", "Y"]]) }, budget);
		expect((await namer.name(["X"])).size).toBe(0);
	});

	it("has sensible defaults", () => {
		expect(AI_BUDGET.modelCallsPerDay).toBeGreaterThan(10);
		expect(AI_BUDGET.insightRefreshesPerDay).toBeLessThanOrEqual(5);
	});
});

describe("refreshing Insights in a run", () => {
	it("refreshes only when stale, at most a few times a day, and not too close together", async () => {
		const storage = memoryStorage();
		let now = Date.parse("2026-10-03T08:00:00Z");
		const clock = () => now;
		const run = async (changed: boolean) => {
			const budget = await ModelBudget.open(storage, limits, clock);
			if (changed) budget.markStale();
			const refresh = budget.shouldRefreshInsights();
			if (refresh) budget.refreshedInsights();
			await budget.save();
			return refresh;
		};
		expect(await run(false)).toBe(false);
		expect(await run(true)).toBe(true);
		now += 10 * 60 * 1000;
		// Too soon: stays stale for a later run.
		expect(await run(true)).toBe(false);
		now += 60 * 60 * 1000;
		expect(await run(false)).toBe(true);
		now += 2 * 60 * 60 * 1000;
		// Two today already.
		expect(await run(true)).toBe(false);
		now = Date.parse("2026-10-04T08:00:00Z");
		expect(await run(false)).toBe(true);
	});
});
