import { env } from "cloudflare:workers";
import {
	agreeToFreshStart,
	cancelFreshStart as cancelScheduled,
	countHouseholdData,
	type FreshStart,
	type FreshStartHandOver,
	freshStartRunAt,
	linkedBankNames,
	listParents,
	loadActiveFreshStart,
	retryFreshStart as retryStopped,
	scheduleFreshStart,
} from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { ulid } from "ulid";
import { z } from "zod";
import { getDb } from "./db";
import { filePrefixes } from "./fresh-start-clear";
import { type FreshStartTrouble, troubleOf } from "./fresh-start-trouble";
import { householdMiddleware } from "./household";
import { notifyHousehold } from "./notify";
import type { NudgeDelivery } from "./nudge-delivery";

// Fresh start and Delete Household (#63, ADR-0029): what would be cleared, and starting or
// cancelling it. Only a Parent of the Household reaches these (householdMiddleware).

export type { FreshStartTrouble };

export type FreshStartStatus = {
	id: string;
	level: FreshStart["level"];
	status: FreshStart["status"];
	runAt: number;
	requestedBy: string;
	/** The Parent who asked, by name ("Ryan asked to start fresh"). */
	requestedByName: string;
	/** Whether the Parent reading this is the one who asked: they can't skip their own wait. */
	mine: boolean;
	/** For the other Parent's typed confirmation of "Start it now". */
	householdName: string;
	step: number;
	steps: number;
	label: string | null;
	/** Failed, or not moved for 20 minutes: what is done, and Try again (issue 118). */
	trouble: FreshStartTrouble | null;
} | null;

type Reader = { household: { id: string; name: string }; parent: { id: string } };

async function statusOf(row: FreshStart | null, context: Reader): Promise<FreshStartStatus> {
	if (!row) return null;
	const parents = await listParents(getDb(), context.household.id);
	return {
		id: row.id,
		level: row.level,
		status: row.status,
		runAt: row.runAt.getTime(),
		requestedBy: row.requestedBy,
		requestedByName:
			parents.find((parent) => parent.id === row.requestedBy)?.name ?? "The other Parent",
		mine: row.requestedBy === context.parent.id,
		householdName: context.household.name,
		step: row.step,
		steps: row.steps,
		label: row.label,
		trouble: troubleOf(row, Date.now()),
	};
}

/**
 * A new Workflow instance takes the request over (Try again, "Start it now"). The one before is
 * terminated if it can be; if it can't (already ended, or gone) it would find, before its next
 * step, that the request is no longer its own and stop.
 */
async function beginRun({ freshStart, previousRunId }: FreshStartHandOver, runId: string) {
	try {
		await (await env.FRESH_START.get(previousRunId)).terminate();
	} catch {
		// Not running, or gone: nothing to stop.
	}
	await env.FRESH_START.create({
		id: runId,
		params: {
			id: freshStart.id,
			householdId: freshStart.householdId,
			level: freshStart.level,
			deleteBackups: freshStart.level === "delete" && freshStart.deleteBackups === true,
		},
	});
	await notifyHousehold(freshStart.householdId, ["fresh-start"]);
}

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
		const [counts, statementFiles, banks, active, parents] = await Promise.all([
			countHouseholdData(db, householdId),
			countFiles(householdId),
			linkedBankNames(db, householdId),
			loadActiveFreshStart(db, householdId),
			listParents(db, householdId),
		]);
		return {
			counts: { ...counts, statementFiles },
			banks,
			freshStart: await statusOf(active, context),
			// With another Parent in, it waits a day and they're told (freshStartRunAt): the sheet
			// says so before anything is confirmed.
			otherParents: parents
				.filter((parent) => parent.id !== context.parent.id)
				.map((parent) => parent.name),
		};
	});

/** Only a fresh start scheduled or running, for the banner both Parents see (cheap to read). */
export const getFreshStartStatus = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }) =>
		statusOf(await loadActiveFreshStart(getDb(), context.household.id), context),
	);

/**
 * Schedules a fresh start or Delete Household and starts its Workflow. With both Parents in, it
 * waits 24 hours, during which either can cancel, and the other Parent gets a Nudge; with one
 * Parent it runs at once (the typed confirmation was the check).
 */
export const startFreshStart = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({ level: z.enum(["fresh-start", "delete"]), deleteBackups: z.boolean().optional() }),
	)
	.handler(async ({ data, context }) => {
		const householdId = context.household.id;
		const now = Date.now();
		const parents = await listParents(getDb(), householdId);
		const others = parents.filter((parent) => parent.id !== context.parent.id);
		const { created, freshStart } = await scheduleFreshStart(getDb(), {
			id: ulid(),
			householdId,
			level: data.level,
			requestedBy: context.parent.id,
			runAt: freshStartRunAt(now, others.length),
			now,
			deleteBackups: data.level === "delete" && data.deleteBackups === true,
		});
		if (created) {
			await env.FRESH_START.create({
				id: freshStart.id,
				params: {
					id: freshStart.id,
					householdId,
					level: freshStart.level,
					// Delete Household keeps one last snapshot for 30 days unless the Parent said not to.
					deleteBackups: freshStart.level === "delete" && data.deleteBackups === true,
				},
			});
			const what = freshStart.level === "delete" ? "delete the Household" : "start fresh";
			for (const other of others) {
				await env.NUDGE_QUEUE.send({
					householdId,
					memberId: other.id,
					nudge: {
						kind: "test",
						title: `${context.parent.name} asked to ${what}`,
						body: "It happens in 24 hours. In Household settings you can start it now, or cancel it.",
						tag: `fresh-start-${freshStart.id}`,
						url: "/household#danger-zone",
					},
				} satisfies NudgeDelivery);
			}
			await notifyHousehold(householdId, ["fresh-start"]);
		}
		return statusOf(freshStart, context);
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
		await notifyHousehold(householdId, ["fresh-start"]);
		return { ok: true as const };
	});

/**
 * "Start it now": the Parent who did not ask agrees, having typed the Household's name, so the
 * day's wait is over. A new Workflow instance begins at once and the sleeping one is terminated.
 * The Parent who asked can't do this alone.
 */
export const startFreshStartNow = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ typedName: z.string() }))
	.handler(async ({ data, context }) => {
		const householdId = context.household.id;
		if (data.typedName.trim() !== context.household.name.trim()) return { ok: false as const };
		const runId = ulid();
		const handed = await agreeToFreshStart(getDb(), {
			householdId,
			memberId: context.parent.id,
			runId,
			now: Date.now(),
		});
		if (!handed) return { ok: false as const };
		await beginRun(handed, runId);
		return { ok: true as const, freshStart: await statusOf(handed.freshStart, context) };
	});

/** Try again, by either Parent: a failed or stuck clear goes to a new run, which carries on. */
export const retryFreshStart = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.handler(async ({ context }) => {
		const householdId = context.household.id;
		const runId = ulid();
		const handed = await retryStopped(getDb(), { householdId, runId, now: Date.now() });
		if (handed) await beginRun(handed, runId);
		// Not handed over: nothing was in trouble, or the other Parent just tried again.
		const now = handed?.freshStart ?? (await loadActiveFreshStart(getDb(), householdId));
		return statusOf(now, context);
	});
