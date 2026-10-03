import { env, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
	createDb,
	type Db,
	listHouseholds,
	loadPerkSourceToResearch,
	perkSourcesToRecheck,
	saveResearch,
} from "@noodle/db";
import { dayKeyAt, PERK_RECHECK_DAYS } from "@noodle/domain";
import { ulid } from "ulid";
import { clearedCheck, isClearedSince, stopIfCleared } from "./cleared-since";
import { getDb } from "./db";
import { insightDeps } from "./insights-nightly";
import { lookForHouseholdInsights } from "./insights-run";
import { notifyHousehold } from "./notify";
import {
	inlineStep,
	type PerkResearchDeps,
	type PerkResearchParams,
	perkResearchInstanceId,
	recheckRun,
	runPerkResearch,
} from "./perk-research-run";
import { stubPerkReader, workersAiPerkReader } from "./perks-model";

// The Perk research Workflow's Worker side: the class the Worker exports, starting a run when a
// Parent asks for one, and the nightly re-check's starts. The logic is runPerkResearch.

function researchDeps(db: Db): PerkResearchDeps {
	return {
		loadSource: ({ householdId, perkSourceId }) =>
			loadPerkSourceToResearch(db, householdId, perkSourceId),
		reader: __AI_STUB__ ? stubPerkReader : workersAiPerkReader(env.AI, env.AI_GATEWAY_ID),
		save: ({ householdId, perkSourceId }, outcome, checkedAt) =>
			saveResearch(db, { householdId, perkSourceId, checkedAt, outcome, newId: ulid }),
		async lookForOverlaps({ householdId, timeZone }) {
			const asOf = dayKeyAt(new Date(), timeZone);
			const added = await lookForHouseholdInsights(insightDeps(), householdId, asOf);
			if (added > 0) await notifyHousehold(householdId, ["insights"]);
		},
		notify: notifyHousehold,
	};
}

export class PerkResearchWorkflow extends WorkflowEntrypoint<Env, PerkResearchParams> {
	override async run(event: Readonly<WorkflowEvent<PerkResearchParams>>, step: WorkflowStep) {
		const db = createDb(this.env.DB);
		const cleared = clearedCheck(db, event.payload.householdId, event.timestamp);
		try {
			await runPerkResearch(
				event.payload,
				stopIfCleared(step, cleared, (message) => new NonRetryableError(message)),
				researchDeps(db),
			);
		} catch (error) {
			if (!isClearedSince(error)) throw error;
		}
	}
}

/**
 * Researches a Perk Source now, after a Parent confirmed or added it, picked its plan tier,
 * linked its page, or asked to check again. With the fakes (AI_MODEL=stub) it runs inline, so
 * E2E sees the outcome as soon as the Parent's request returns; otherwise a Workflow does it.
 */
export async function startPerkResearch(params: PerkResearchParams): Promise<void> {
	if (__AI_STUB__) {
		await runPerkResearch(params, inlineStep, researchDeps(getDb()));
		return;
	}
	await env.PERK_RESEARCH.create({
		id: perkResearchInstanceId(params.perkSourceId, ulid()),
		params,
	});
}

/** The nightly re-check: every confirmed Perk Source whose Perks are a month old. */
export async function startPerkRechecks(now: Date): Promise<void> {
	const db = getDb();
	const before = new Date(now.getTime() - PERK_RECHECK_DAYS * 86_400_000);
	const due = await perkSourcesToRecheck(db, before);
	const zoneOf = new Map((await listHouseholds(db)).map((h) => [h.id, h.timeZone]));
	const instances = due.map(({ id, householdId }) => {
		const timeZone = zoneOf.get(householdId) ?? "UTC";
		return {
			id: perkResearchInstanceId(id, recheckRun(dayKeyAt(now, timeZone))),
			params: { householdId, timeZone, perkSourceId: id },
		};
	});
	// createBatch takes up to 100 at a time, and skips instances that already exist.
	for (let i = 0; i < instances.length; i += 100) {
		await env.PERK_RESEARCH.createBatch(instances.slice(i, i + 100));
	}
}
