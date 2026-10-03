import { env } from "cloudflare:workers";
import {
	cancelFreshStart as cancelScheduled,
	countHouseholdData,
	type FreshStart,
	loadActiveFreshStart,
	scheduleFreshStart,
} from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { ulid } from "ulid";
import { z } from "zod";
import { getDb } from "./db";
import { filePrefixes } from "./fresh-start-clear";
import { householdMiddleware } from "./household";
import { notifyHousehold } from "./notify";

// Fresh start and Delete Household (#63, ADR-0029): what would be cleared, and starting or
// cancelling it. Only a Parent of the Household reaches these (householdMiddleware).

export type FreshStartStatus = {
	id: string;
	level: FreshStart["level"];
	status: FreshStart["status"];
	runAt: number;
	requestedBy: string;
	step: number;
	steps: number;
	label: string | null;
} | null;

const statusOf = (row: FreshStart | null): FreshStartStatus =>
	row && {
		id: row.id,
		level: row.level,
		status: row.status,
		runAt: row.runAt.getTime(),
		requestedBy: row.requestedBy,
		step: row.step,
		steps: row.steps,
		label: row.label,
	};

/** Statement and Receipt files in R2 (downloads aren't counted: they're the Parent's own copy). */
async function countFiles(householdId: string): Promise<number> {
	let n = 0;
	for (const prefix of filePrefixes(householdId).slice(0, 2)) {
		let cursor: string | undefined;
		do {
			const page = await env.STATEMENTS.list({ prefix, cursor, limit: 1000 });
			n += page.objects.length;
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
	}
	return n;
}

/** What a fresh start would clear, with counts, and one already scheduled or running. */
export const getFreshStartCounts = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }) => {
		const db = getDb();
		const householdId = context.household.id;
		const [counts, statementFiles, active] = await Promise.all([
			countHouseholdData(db, householdId),
			countFiles(householdId),
			loadActiveFreshStart(db, householdId),
		]);
		return { counts: { ...counts, statementFiles }, freshStart: statusOf(active) };
	});

/**
 * Schedules a fresh start or Delete Household and starts its Workflow. For now it runs at once;
 * the 24-hour grace period when both Parents are in comes with the Danger zone (#63's second part).
 */
export const startFreshStart = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ level: z.enum(["fresh-start", "delete"]) }))
	.handler(async ({ data, context }) => {
		const householdId = context.household.id;
		const now = Date.now();
		const { created, freshStart } = await scheduleFreshStart(getDb(), {
			id: ulid(),
			householdId,
			level: data.level,
			requestedBy: context.parent.id,
			runAt: now,
			now,
		});
		if (created) {
			await env.FRESH_START.create({
				id: freshStart.id,
				params: { id: freshStart.id, householdId, level: freshStart.level },
			});
		}
		return statusOf(freshStart);
	});

/** Either Parent cancels one still waiting out its grace period. */
export const cancelFreshStart = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.handler(async ({ context }) => {
		const householdId = context.household.id;
		const cancelled = await cancelScheduled(getDb(), householdId, context.parent.id);
		if (!cancelled) return { ok: false as const };
		try {
			await (await env.FRESH_START.get(cancelled.id)).terminate();
		} catch {
			// Already finished waiting: it reads the cancel and stops by itself.
		}
		await notifyHousehold(householdId, []);
		return { ok: true as const };
	});
