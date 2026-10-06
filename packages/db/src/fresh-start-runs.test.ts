import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	agreeToFreshStart,
	cancelFreshStart,
	clearedSince,
	type FreshStart,
	failFreshStart,
	finishFreshStart,
	freshStartCarriesOn,
	freshStartRunId,
	freshStartRunPlan,
	freshStartTrouble,
	loadActiveFreshStart,
	loadFreshStart,
	retryFreshStart,
	STUCK_AFTER_MS,
	scheduleFreshStart,
	setFreshStartProgress,
	startFreshStartRun,
} from "./fresh-start";
import type { Db } from "./index";
import * as s from "./schema";
import { testDb } from "./test-db";

// A fresh start's request and the Workflow runs that carry it (issue 118, ADR-0029's addendum):
// a run that finds it running carries on, a failed or stuck one can be tried again, and the
// Parent who did not ask can start it now.

const HOUSEHOLD = "household-1";
const ID = "fresh-1";
const NOW = Date.parse("2026-10-05T21:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let db: Db;

const schedule = (runAt = NOW + DAY) =>
	scheduleFreshStart(db, {
		id: ID,
		householdId: HOUSEHOLD,
		level: "fresh-start",
		requestedBy: "ryan",
		runAt,
		now: NOW,
	});

const setStatus = (status: FreshStart["status"]) =>
	db.update(s.freshStarts).set({ status }).where(eq(s.freshStarts.id, ID));

const row = async () => (await loadFreshStart(db, ID)) as FreshStart;

beforeEach(() => {
	db = testDb();
});

describe("a run that begins", () => {
	it("waits when the request is scheduled", async () => {
		await schedule();
		expect(freshStartRunPlan(await row(), ID)).toBe("wait");
		expect(await startFreshStartRun(db, ID, { runId: ID, now: NOW })).toBe(true);
		expect((await row()).status).toBe("running");
	});

	it("carries on with the clear when the request is already running", async () => {
		await schedule(NOW);
		await startFreshStartRun(db, ID, { runId: ID, now: NOW });
		// The instance was restarted, or a second one began: it finds `running`.
		expect(freshStartRunPlan(await row(), ID)).toBe("clear");
		expect(await startFreshStartRun(db, ID, { runId: ID, now: NOW + 5 })).toBe(true);
		expect(await startFreshStartRun(db, ID)).toBe(true);
		expect((await row()).status).toBe("running");
	});

	it("carries on from failed, and the failure is forgotten", async () => {
		await schedule(NOW);
		await startFreshStartRun(db, ID, { runId: ID, now: NOW });
		await failFreshStart(db, ID, { step: "merchants", now: NOW + 1, runId: ID });
		expect(freshStartRunPlan(await row(), ID)).toBe("clear");
		expect(await startFreshStartRun(db, ID, { runId: ID, now: NOW + 2 })).toBe(true);
		expect(await row()).toMatchObject({ status: "running", failedStep: null, failedAt: null });
	});

	it("exits when the request was cancelled", async () => {
		await schedule();
		await cancelFreshStart(db, HOUSEHOLD, "sam");
		expect(freshStartRunPlan(await row(), ID)).toBe("exit");
		expect(await startFreshStartRun(db, ID, { runId: ID, now: NOW })).toBe(false);
		expect((await row()).status).toBe("cancelled");
	});

	it("exits when the request is done: a second run finds the work finished", async () => {
		await schedule(NOW);
		await startFreshStartRun(db, ID, { runId: ID, now: NOW });
		await finishFreshStart(db, ID, NOW + 10);
		expect(freshStartRunPlan(await row(), ID)).toBe("exit");
		expect(freshStartRunPlan(await row(), "another-run")).toBe("exit");
		expect(await startFreshStartRun(db, ID, { runId: ID, now: NOW + 20 })).toBe(false);
		expect(freshStartCarriesOn(await row(), ID)).toBe(false);
		expect((await row()).status).toBe("done");
	});

	it("exits when the request is gone", () => {
		expect(freshStartRunPlan(null, ID)).toBe("exit");
	});

	it("exits when the request belongs to another run now", async () => {
		await schedule(NOW);
		await startFreshStartRun(db, ID, { runId: ID, now: NOW });
		await db.update(s.freshStarts).set({ runId: "run-2" }).where(eq(s.freshStarts.id, ID));
		expect(freshStartRunPlan(await row(), ID)).toBe("exit");
		expect(freshStartRunPlan(await row(), "run-2")).toBe("clear");
		expect(await startFreshStartRun(db, ID, { runId: ID, now: NOW })).toBe(false);
		expect(await startFreshStartRun(db, ID, { runId: "run-2", now: NOW })).toBe(true);
	});
});

describe("before every step", () => {
	it("only the request's own run carries on, and only while it is running", async () => {
		await schedule(NOW);
		await startFreshStartRun(db, ID, { runId: ID, now: NOW });
		expect(freshStartCarriesOn(await row(), ID)).toBe(true);
		expect(freshStartCarriesOn(await row(), "run-2")).toBe(false);
		for (const status of ["scheduled", "failed", "done", "cancelled"] as const) {
			await setStatus(status);
			expect(freshStartCarriesOn(await row(), ID), status).toBe(false);
		}
	});

	it("carries on when the request is gone: Delete Household removed it in its last step", () => {
		expect(freshStartCarriesOn(null, ID)).toBe(true);
	});
});

describe("a step that used up its retries", () => {
	beforeEach(async () => {
		await schedule(NOW);
		await startFreshStartRun(db, ID, { runId: ID, now: NOW });
		await setFreshStartProgress(
			db,
			ID,
			{ step: 3, steps: 6, label: "Forgetting merchants" },
			NOW + 1000,
		);
	});

	it("is recorded on the request, which stays the Household's one request", async () => {
		expect(await failFreshStart(db, ID, { step: "merchants", now: NOW + 2000, runId: ID })).toBe(
			true,
		);
		expect(await row()).toMatchObject({ status: "failed", failedStep: "merchants", step: 3 });
		expect((await row()).failedAt?.getTime()).toBe(NOW + 2000);
		expect((await loadActiveFreshStart(db, HOUSEHOLD))?.id).toBe(ID);
		expect(freshStartTrouble(await row(), NOW + 3000)).toBe("failed");
		// No second request beside it.
		const again = await scheduleFreshStart(db, {
			id: "fresh-2",
			householdId: HOUSEHOLD,
			level: "fresh-start",
			requestedBy: "sam",
			runAt: NOW,
			now: NOW,
		});
		expect(again).toMatchObject({ created: false, freshStart: { id: ID } });
		// Nor can it be cancelled: part of the Household is already cleared.
		expect(await cancelFreshStart(db, HOUSEHOLD, "sam")).toBeNull();
	});

	it("still stops work that began before it: the Household is part-cleared", async () => {
		await failFreshStart(db, ID, { step: "merchants", now: NOW + 2000, runId: ID });
		expect(await clearedSince(db, HOUSEHOLD, NOW - 1000)).toBe(true);
	});

	it("is not recorded by a run the request no longer belongs to, or once it is done", async () => {
		expect(await failFreshStart(db, ID, { step: "merchants", now: NOW, runId: "old-run" })).toBe(
			false,
		);
		await finishFreshStart(db, ID, NOW + 5000);
		expect(await failFreshStart(db, ID, { step: "merchants", now: NOW, runId: ID })).toBe(false);
		expect((await row()).status).toBe("done");
	});

	it("can be tried again: a new run takes it back to running, at the step it reached", async () => {
		await failFreshStart(db, ID, { step: "merchants", now: NOW + 2000, runId: ID });
		const handed = await retryFreshStart(db, {
			householdId: HOUSEHOLD,
			runId: "run-2",
			now: NOW + 60_000,
		});
		expect(handed?.previousRunId).toBe(ID);
		expect(handed?.freshStart).toMatchObject({
			status: "running",
			runId: "run-2",
			failedStep: null,
			failedAt: null,
			step: 3,
		});
		expect(freshStartRunId(await row())).toBe("run-2");
		// The old run stops before its next step; the new one clears.
		expect(freshStartCarriesOn(await row(), ID)).toBe(false);
		expect(freshStartCarriesOn(await row(), "run-2")).toBe(true);
		// Pressed twice (or by both Parents): the second finds it moving and starts nothing.
		expect(
			await retryFreshStart(db, { householdId: HOUSEHOLD, runId: "run-3", now: NOW + 61_000 }),
		).toBeNull();
		expect((await row()).runId).toBe("run-2");
	});
});

describe("a clear that has stopped moving", () => {
	it("is stuck after 20 minutes without a step beginning, not before", async () => {
		await schedule(NOW);
		await startFreshStartRun(db, ID, { runId: ID, now: NOW });
		await setFreshStartProgress(db, ID, { step: 2, steps: 6, label: "Stopping" }, NOW + 1000);
		expect(STUCK_AFTER_MS).toBe(20 * 60 * 1000);
		expect(freshStartTrouble(await row(), NOW + 1000 + STUCK_AFTER_MS)).toBeNull();
		expect(freshStartTrouble(await row(), NOW + 1001 + STUCK_AFTER_MS)).toBe("stuck");
	});

	it("is stuck when it was running before runs were stamped (the night of issue 118)", async () => {
		await schedule(NOW);
		await setStatus("running");
		expect((await row()).progressAt).toBeNull();
		expect(freshStartTrouble(await row(), NOW + STUCK_AFTER_MS + 1)).toBe("stuck");
	});

	it("is stuck when it was due and never began, but not while it waits", async () => {
		await schedule();
		expect(freshStartTrouble(await row(), NOW + DAY - 1)).toBeNull();
		expect(freshStartTrouble(await row(), NOW + DAY + STUCK_AFTER_MS)).toBeNull();
		expect(freshStartTrouble(await row(), NOW + DAY + STUCK_AFTER_MS + 1)).toBe("stuck");
	});

	it("is never trouble once done or cancelled", async () => {
		await schedule(NOW);
		for (const status of ["done", "cancelled"] as const) {
			await setStatus(status);
			expect(freshStartTrouble(await row(), NOW + 10 * DAY)).toBeNull();
		}
	});

	it("can be tried again, and is then given time to move", async () => {
		await schedule(NOW);
		await startFreshStartRun(db, ID, { runId: ID, now: NOW });
		const later = NOW + STUCK_AFTER_MS + 1;
		expect(await retryFreshStart(db, { householdId: HOUSEHOLD, runId: "r2", now: NOW + 5 })).toBe(
			null,
		);
		const handed = await retryFreshStart(db, { householdId: HOUSEHOLD, runId: "r2", now: later });
		expect(handed?.freshStart).toMatchObject({ status: "running", runId: "r2" });
		expect(freshStartTrouble(await row(), later + 1000)).toBeNull();
	});
});

describe("the other Parent agrees", () => {
	it("so it runs now, under a new run", async () => {
		await schedule();
		const handed = await agreeToFreshStart(db, {
			householdId: HOUSEHOLD,
			memberId: "sam",
			runId: "run-now",
			now: NOW + 3000,
		});
		expect(handed?.previousRunId).toBe(ID);
		expect(handed?.freshStart).toMatchObject({
			status: "scheduled",
			runId: "run-now",
			agreedBy: "sam",
		});
		expect(handed?.freshStart.runAt.getTime()).toBe(NOW + 3000);
		// The sleeping run, should it wake, finds the request is not its own.
		expect(freshStartRunPlan(await row(), ID)).toBe("exit");
		expect(freshStartRunPlan(await row(), "run-now")).toBe("wait");
		expect(await startFreshStartRun(db, ID, { runId: ID, now: NOW + DAY })).toBe(false);
	});

	it("but the Parent who asked cannot skip their own wait", async () => {
		await schedule();
		expect(
			await agreeToFreshStart(db, {
				householdId: HOUSEHOLD,
				memberId: "ryan",
				runId: "run-now",
				now: NOW + 3000,
			}),
		).toBeNull();
		expect(await row()).toMatchObject({ status: "scheduled", runId: null, agreedBy: null });
		expect((await row()).runAt.getTime()).toBe(NOW + DAY);
	});

	it("and Cancel still works until it begins, after which there is nothing to agree to", async () => {
		await schedule();
		await agreeToFreshStart(db, {
			householdId: HOUSEHOLD,
			memberId: "sam",
			runId: "run-now",
			now: NOW,
		});
		expect((await cancelFreshStart(db, HOUSEHOLD, "ryan"))?.status).toBe("cancelled");
		expect(freshStartRunPlan(await row(), "run-now")).toBe("exit");
		expect(
			await agreeToFreshStart(db, {
				householdId: HOUSEHOLD,
				memberId: "sam",
				runId: "r",
				now: NOW,
			}),
		).toBeNull();
	});

	it("keeps Delete Household's choice about the last snapshot for the new run", async () => {
		await scheduleFreshStart(db, {
			id: ID,
			householdId: HOUSEHOLD,
			level: "delete",
			requestedBy: "ryan",
			runAt: NOW + DAY,
			now: NOW,
			deleteBackups: true,
		});
		const handed = await agreeToFreshStart(db, {
			householdId: HOUSEHOLD,
			memberId: "sam",
			runId: "run-now",
			now: NOW,
		});
		expect(handed?.freshStart.deleteBackups).toBe(true);
	});
});
