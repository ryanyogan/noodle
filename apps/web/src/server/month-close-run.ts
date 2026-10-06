import type { WorkflowStep } from "cloudflare:workers";
import type { CloseMonthInput, MonthCloseResult } from "@noodle/db";
import {
	addMonths,
	type Cents,
	closeFreeMoveId,
	dayKeyAt,
	defaultDecision,
	type MonthCloseDecision,
	type MonthCloseProposal,
	type MonthKey,
	monthKeyAt,
	nothingToClose,
} from "@noodle/domain";
import type { HouseholdChange } from "../household-changes";

// The Month-close Workflow, one instance per Household and ended month. It starts on the
// Household's 1st (see monthClosesToStart), proposes what there is to decide, and waits up to a
// week for the Parents' decision (closeMonth sends it as an event once it has landed). When none
// comes, it applies the defaults: leftovers Swept into the emergency Goal, the Extra income left for
// the Parents (ADR-0001), and the Free to Spend the month ended with kept, carried over (issue 113). The database guard lets only one of the two close the month.

export type MonthCloseParams = { householdId: string; timeZone: string; month: MonthKey };

/** The event closeMonth sends once the Parents' decision has landed. */
export const MONTH_CLOSE_DECIDED = "month-close-decided";

/** How long the Parents have to decide before the defaults apply. */
export const DECISION_TIMEOUT = "7 days";

/** One instance per Household and month, so a second start of the same one is skipped. */
export const monthCloseInstanceId = (householdId: string, month: MonthKey) =>
	`month-close-${householdId}-${month}`;

/** The ended month as it stands now. */
export type EndedMonth = {
	proposal: MonthCloseProposal;
	closed: boolean;
	emergencyGoalId: string | null;
	/** Per Bucket ID, what rolled into it from the month before. */
	rolledOver: Record<string, Cents>;
};

export type MonthCloseDeps = {
	loadEndedMonth: (params: MonthCloseParams) => Promise<EndedMonth>;
	closeMonth: (input: CloseMonthInput) => Promise<MonthCloseResult>;
	notify: (householdId: string, changes: HouseholdChange[]) => Promise<void>;
};

export type MonthCloseOutcome = "already-closed" | "nothing-to-close" | "decided" | "defaults";

/** The steps the Workflow uses, so tests can run it with fakes. */
export type MonthCloseStep = Pick<WorkflowStep, "do" | "waitForEvent">;

export async function runMonthClose(
	params: MonthCloseParams,
	step: MonthCloseStep,
	deps: MonthCloseDeps,
): Promise<MonthCloseOutcome> {
	const start = await step.do("propose", async () => {
		const ended = await deps.loadEndedMonth(params);
		return { closed: ended.closed, nothing: nothingToClose(ended.proposal) };
	});
	if (start.closed) return "already-closed";
	if (start.nothing) return "nothing-to-close";
	try {
		await step.waitForEvent("parents decide", {
			type: MONTH_CLOSE_DECIDED,
			timeout: DECISION_TIMEOUT,
		});
		return "decided";
	} catch {
		// Nobody decided in time (waitForEvent throws on timeout).
	}
	return step.do("apply defaults", async (): Promise<MonthCloseOutcome> => {
		// Recomputed now: spending recorded late, or a Parent's decision racing this, changes it.
		const ended = await deps.loadEndedMonth(params);
		if (ended.closed) return "decided";
		const closeId = `${params.householdId}:${params.month}:defaults`;
		const result = await deps.closeMonth(
			closeMonthInput({
				householdId: params.householdId,
				month: params.month,
				closeId,
				decidedByMemberId: null,
				decision: defaultDecision(ended.proposal, ended.emergencyGoalId),
				rolledOver: ended.rolledOver,
				moveId: (bucketId) => `${closeId}:${bucketId}`,
			}),
		);
		if (!result.ok) return "decided";
		await deps.notify(params.householdId, ["goals", `month:${params.month}`]);
		return "defaults";
	});
}

/** The database write for a decision; `moveId` names each Sweep's Move by its Bucket. */
export function closeMonthInput({
	decision,
	rolledOver,
	moveId,
	windfallMoveIds = [],
	...close
}: Pick<CloseMonthInput, "householdId" | "month" | "closeId" | "decidedByMemberId"> & {
	decision: MonthCloseDecision;
	rolledOver: Record<string, Cents>;
	moveId: (bucketId: string) => string;
	windfallMoveIds?: string[];
}): CloseMonthInput {
	return {
		...close,
		sweeps: decision.sweeps.map((s) => ({
			moveId: moveId(s.bucketId),
			bucketId: s.bucketId,
			goalId: s.goalId,
			amountCents: s.amount,
			rolledOverCents: rolledOver[s.bucketId] ?? 0,
		})),
		windfall: decision.windfall.map((w, i) => ({
			moveId: windfallMoveIds[i] ?? `${close.closeId}:windfall:${i}`,
			goalId: w.goalId,
			amountCents: w.amount,
		})),
		freeToSpend: (decision.freeToSpend ?? []).map((sent, i) => ({
			moveId: closeFreeMoveId(close.closeId, i),
			goalId: sent.goalId,
			amountCents: sent.amount,
		})),
	};
}

/**
 * The Month-close Workflows to start at `now`: for each Household where it's the 1st to 3rd, the
 * month that just ended there. The cron runs hourly on those days (in UTC), so every Household
 * gets its own after its local midnight, whatever its time zone; later runs skip ones started.
 */
export function monthClosesToStart(
	households: { id: string; timeZone: string }[],
	now: Date,
): { id: string; params: MonthCloseParams }[] {
	return households.flatMap((household) => {
		const day = Number(dayKeyAt(now, household.timeZone).slice(8));
		if (day > 3) return [];
		const month = addMonths(monthKeyAt(now, household.timeZone), -1);
		return [
			{
				id: monthCloseInstanceId(household.id, month),
				params: { householdId: household.id, timeZone: household.timeZone, month },
			},
		];
	});
}
