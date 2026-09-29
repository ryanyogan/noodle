import type { WorkflowStep, WorkflowStepConfig } from "cloudflare:workers";
import type { PerkResearchOutcome, PerkSourceToResearch } from "@noodle/db";
import { type DayKey, perksForPlan, perksOnPage } from "@noodle/domain";
import type { HouseholdChange } from "../household-changes";
import { MIN_PAGE_CHARS, type Page, type PerkReader, type PerksRead } from "./perks-model";

// The Perk research Workflow, one instance per Perk Source and run: when a Parent confirms or
// adds one, picks its plan tier, links its page or asks to check it again, and on the nightly
// re-check once its Perks are a month old. It fetches the page and has the model read it (each
// step retried on its own, so a flaky page or a busy model doesn't lose the other's work), keeps
// only the Perks the page really says (and, when they depend on the plan tier, only if the
// Parent said which: otherwise it asks), stores them with the page's link and today's date, then
// looks for the Perk Overlaps they make.

export type PerkResearchParams = { householdId: string; timeZone: string; perkSourceId: string };

/** A new instance for each run the Parent starts; the nightly re-check's is one a day. */
export const perkResearchInstanceId = (perkSourceId: string, run: string) =>
	`perk-research-${perkSourceId}-${run}`;

export type PerkResearchDeps = {
	loadSource: (params: PerkResearchParams) => Promise<PerkSourceToResearch | null>;
	reader: PerkReader;
	save: (
		params: PerkResearchParams,
		outcome: PerkResearchOutcome,
		checkedAt: Date,
	) => Promise<void>;
	/** Looks for Insights (Perk Overlaps among them) with the Perks just stored. */
	lookForOverlaps: (params: PerkResearchParams) => Promise<void>;
	notify: (householdId: string, changes: HouseholdChange[]) => Promise<void>;
};

/** The steps the Workflow uses, so tests can run it with fakes. */
export type PerkResearchStep = Pick<WorkflowStep, "do">;

/** A page is worth a few tries, a minute apart and growing: sites have bad minutes. */
export const FETCH_STEP: WorkflowStepConfig = {
	retries: { limit: 3, delay: "1 minute", backoff: "exponential" },
	timeout: "1 minute",
};
/** The model, twice more if it's busy or answers nonsense. */
export const READ_STEP: WorkflowStepConfig = {
	retries: { limit: 2, delay: "30 seconds", backoff: "exponential" },
	timeout: "5 minutes",
};

export type PerkResearchResult = PerkResearchOutcome["research"] | "gone";

/** What the page says of the Perk Source's Perks, for its plan tier. */
export function researchOutcome(
	source: PerkSourceToResearch,
	page: { url: string; text: string },
	read: PerksRead,
): PerkResearchOutcome {
	const onPage = perksOnPage(read.perks, page.text);
	const forPlan = perksForPlan({ tiers: read.tiers, perks: onPage }, source.plan);
	if ("askPlan" in forPlan) return { research: "needs-plan", planOptions: forPlan.askPlan };
	return { research: "done", perks: forPlan.perks, sourceUrl: page.url };
}

export async function runPerkResearch(
	params: PerkResearchParams,
	step: PerkResearchStep,
	deps: PerkResearchDeps,
): Promise<PerkResearchResult> {
	const source = await step.do("load", () => deps.loadSource(params));
	if (!source) return "gone";
	const finish = async (outcome: PerkResearchOutcome) => {
		// Stamped inside the step: a replayed run keeps the date it first stored.
		await step.do(`save ${outcome.research}`, () => deps.save(params, outcome, new Date()));
		if (outcome.research === "done") {
			await step.do("look for Perk Overlaps", () => deps.lookForOverlaps(params));
		}
		await deps.notify(params.householdId, ["perks"]);
		return outcome.research;
	};
	const pageUrl = source.pageUrl;
	if (!pageUrl) return finish({ research: "needs-link" });

	let page: Page;
	let read: PerksRead;
	try {
		page = await step.do("fetch page", FETCH_STEP, () => deps.reader.fetchPage(pageUrl));
		if ("failed" in page || page.text.length < MIN_PAGE_CHARS) {
			return finish({ research: "unreadable" });
		}
		const text = page.text;
		read = await step.do("read Perks", READ_STEP, () => deps.reader.readPerks(source, text));
	} catch (error) {
		// Out of retries: the Parent can link another page, or check again later.
		console.error(`Couldn’t research Perk Source ${params.perkSourceId}`, error);
		return finish({ research: "unreadable" });
	}
	return finish(researchOutcome(source, page, read));
}

/** A step that runs each callback at once, once: research inline, for E2E's fakes. */
export const inlineStep: PerkResearchStep = {
	do: ((_name: string, configOrFn: unknown, fn?: unknown) =>
		(typeof configOrFn === "function"
			? configOrFn
			: (fn as () => unknown))()) as PerkResearchStep["do"],
};

/** The nightly re-check's run of a Perk Source: at most one a day. */
export const recheckRun = (asOf: DayKey) => `recheck-${asOf}`;
