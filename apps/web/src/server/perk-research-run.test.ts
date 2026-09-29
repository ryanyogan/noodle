import type { PerkResearchOutcome, PerkSourceToResearch } from "@noodle/db";
import { describe, expect, it } from "vitest";
import {
	type PerkResearchParams,
	type PerkResearchStep,
	runPerkResearch,
} from "./perk-research-run";
import { type PerkReader, pageText, stubPerkReader } from "./perks-model";

const params: PerkResearchParams = {
	householdId: "household-1",
	timeZone: "America/Chicago",
	perkSourceId: "source-1",
};

const tMobile: PerkSourceToResearch = {
	name: "T-Mobile",
	kind: "phone-plan",
	plan: null,
	pageUrl: "https://www.t-mobile.com/cell-phone-plans",
};

/** A Workflow step that runs each step once, recording its name. */
function fakeStep() {
	const steps: string[] = [];
	const step = {
		do: async (name: string, configOrFn: unknown, fn?: () => Promise<unknown>) => {
			steps.push(name);
			return (typeof configOrFn === "function" ? configOrFn : fn)?.();
		},
	} as unknown as PerkResearchStep;
	return { step, steps };
}

function fakeDeps(source: PerkSourceToResearch | null, reader: PerkReader = stubPerkReader) {
	const saved: PerkResearchOutcome[] = [];
	const notified: unknown[] = [];
	let looked = 0;
	return {
		saved,
		notified,
		looked: () => looked,
		deps: {
			loadSource: async () => source,
			reader,
			save: async (_params: PerkResearchParams, outcome: PerkResearchOutcome) => {
				saved.push(outcome);
			},
			lookForOverlaps: async () => {
				looked++;
			},
			notify: async (_householdId: string, changes: unknown) => {
				notified.push(changes);
			},
		},
	};
}

describe("runPerkResearch", () => {
	it("asks for the plan tier when the page's Perks depend on it", async () => {
		const { step, steps } = fakeStep();
		const run = fakeDeps(tMobile);
		expect(await runPerkResearch(params, step, run.deps)).toBe("needs-plan");
		expect(run.saved).toEqual([
			{ research: "needs-plan", planOptions: ["Essentials", "Go5G", "Go5G Plus"] },
		]);
		expect(steps).toEqual(["load", "fetch page", "read Perks", "save needs-plan"]);
		expect(run.looked()).toBe(0);
		expect(run.notified).toEqual([["perks"]]);
	});

	it("stores the chosen tier's Perks the page says, dropping one the model only remembers", async () => {
		const { step, steps } = fakeStep();
		const run = fakeDeps({ ...tMobile, plan: "Go5G Plus" });
		expect(await runPerkResearch(params, step, run.deps)).toBe("done");
		const [outcome] = run.saved;
		expect(outcome?.research).toBe("done");
		if (outcome?.research !== "done") return;
		expect(outcome.sourceUrl).toBe(tMobile.pageUrl);
		// Apple TV+ isn't on the page: the model's memory never becomes a Perk.
		expect(outcome.perks.map((p) => p.matches)).toEqual(["Netflix", "Hulu"]);
		expect(steps.at(-1)).toBe("look for Perk Overlaps");
		expect(run.looked()).toBe(1);
	});

	it("keeps only the Perks of a lower tier", async () => {
		const run = fakeDeps({ ...tMobile, plan: "Go5G" });
		await runPerkResearch(params, fakeStep().step, run.deps);
		const [outcome] = run.saved;
		expect(outcome?.research === "done" && outcome.perks.map((p) => p.matches)).toEqual([
			"Netflix",
		]);
	});

	it("marks a page it couldn't fetch, after its retries, unreadable", async () => {
		const reader: PerkReader = {
			...stubPerkReader,
			fetchPage: async () => {
				throw new Error("answered 503");
			},
		};
		const run = fakeDeps(tMobile, reader);
		const logged = console.error;
		console.error = () => {};
		try {
			expect(await runPerkResearch(params, fakeStep().step, run.deps)).toBe("unreadable");
		} finally {
			console.error = logged;
		}
		expect(run.saved).toEqual([{ research: "unreadable" }]);
	});

	it("marks a missing page, or one with next to no text, unreadable", async () => {
		const missing = fakeDeps({ ...tMobile, pageUrl: "https://example.com/missing" });
		expect(await runPerkResearch(params, fakeStep().step, missing.deps)).toBe("unreadable");
		const empty = fakeDeps(tMobile, {
			...stubPerkReader,
			fetchPage: async (url) => ({
				url,
				text: pageText("<html><body><div id=app></div></body></html>"),
			}),
		});
		expect(await runPerkResearch(params, fakeStep().step, empty.deps)).toBe("unreadable");
	});

	it("asks for a link when there's no page to read", async () => {
		const { step, steps } = fakeStep();
		const run = fakeDeps({
			name: "Credit union card",
			kind: "credit-card",
			plan: null,
			pageUrl: null,
		});
		expect(await runPerkResearch(params, step, run.deps)).toBe("needs-link");
		expect(steps).toEqual(["load", "save needs-link"]);
	});

	it("does nothing for a Perk Source no longer confirmed", async () => {
		const run = fakeDeps(null);
		expect(await runPerkResearch(params, fakeStep().step, run.deps)).toBe("gone");
		expect(run.saved).toEqual([]);
		expect(run.notified).toEqual([]);
	});
});

describe("pageText", () => {
	it("keeps the words, not the markup", () => {
		expect(
			pageText(
				"<head><title>x</title></head><script>var a=1</script><p>Netflix&nbsp;is <b>on us</b> &amp; more</p>",
			),
		).toBe("Netflix is on us & more");
	});
});
