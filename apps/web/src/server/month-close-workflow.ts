import { env, WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import {
	closeMonth as closeMonthInDb,
	createDb,
	type Db,
	listHouseholds,
	loadEmergencyGoalId,
} from "@noodle/db";
import { monthCloseProposal, monthState } from "@noodle/domain";
import { queueAi } from "./ai-queue";
import { getDb } from "./db";
import { loadMonth } from "./month";
import {
	type EndedMonth,
	type MonthCloseDeps,
	type MonthCloseParams,
	monthClosesToStart,
	runMonthClose,
} from "./month-close-run";
import { notifyHousehold } from "./notify";

// The Month-close Workflow's Worker side: the class the Worker exports, and the cron handler that
// starts its instances. The logic is runMonthClose.

/** The ended month as it stands now, as either Parent would see its Household Buckets. */
async function loadEndedMonth(db: Db, params: MonthCloseParams): Promise<EndedMonth> {
	const household = { id: params.householdId, timeZone: params.timeZone };
	const [data, emergencyGoalId] = await Promise.all([
		// No Parent: a Personal Allowance is never part of a month-close, so whose view is moot.
		loadMonth(db, household, "", params.month),
		loadEmergencyGoalId(db, params.householdId),
	]);
	return {
		proposal: monthCloseProposal(monthState(data)),
		closed: data.closed !== null,
		emergencyGoalId,
		rolledOver: data.rolledOver,
	};
}

export class MonthCloseWorkflow extends WorkflowEntrypoint<Env, MonthCloseParams> {
	override run(event: Readonly<WorkflowEvent<MonthCloseParams>>, step: WorkflowStep) {
		const db = createDb(this.env.DB);
		const deps: MonthCloseDeps = {
			loadEndedMonth: (params) => loadEndedMonth(db, params),
			closeMonth: (input) => closeMonthInDb(db, input),
			notify: notifyHousehold,
		};
		return runMonthClose(event.payload, step, deps);
	}
}

/** Starts the Month-close Workflows due now (the cron's handler). */
export async function startMonthCloses(now: Date): Promise<void> {
	const due = monthClosesToStart(await listHouseholds(getDb()), now);
	// createBatch takes up to 100 at a time, and skips instances that already exist.
	for (let i = 0; i < due.length; i += 100) {
		await env.MONTH_CLOSE.createBatch(due.slice(i, i + 100));
	}
	// A new month's Plan may fit what waits in Review; each Household's is taken once a month.
	for (const { params } of due) {
		await queueAi({ householdId: params.householdId, kind: "month-started", ids: [params.month] });
	}
}
