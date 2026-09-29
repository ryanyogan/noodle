import type { Cents } from "./money";
import type { MonthKey } from "./month";
import type { GoalFunding, MonthState, Sweep } from "./month-state";

// Closing a month, on the 1st of the next: what rolls over is already derived (see rolledOver),
// so what's left to decide is where Fresh-start Buckets' leftovers are Swept and where the
// month's pending Windfall goes.

/** A Fresh-start Bucket's leftover at the end of the month, to Sweep or leave. */
export type Leftover = { bucketId: string; name: string; amount: Cents };

export type MonthCloseProposal = {
	month: MonthKey;
	leftovers: Leftover[];
	/** The month's Windfall still awaiting a decision. */
	windfall: Cents;
};

/** Where the Parents (or the defaults) send the month's leftovers and Windfall. */
export type MonthCloseDecision = {
	sweeps: { bucketId: string; goalId: string; amount: Cents }[];
	windfall: { goalId: string; amount: Cents }[];
};

/**
 * What there is to decide as `state`'s month closes: each Fresh-start Bucket with money left
 * (Rolling Buckets carry theirs over; a Personal Allowance's leftover is its Parent's own), and
 * the pending Windfall. `state` is the month as of its last day.
 */
export function monthCloseProposal(state: MonthState): MonthCloseProposal {
	return {
		month: state.month,
		leftovers: state.buckets
			.filter((b) => !b.rolling && b.owner === undefined && b.left > 0)
			.map((b) => ({ bucketId: b.id, name: b.name, amount: b.left })),
		windfall: state.windfallLeft,
	};
}

/** Nothing to decide: no leftovers and no pending Windfall. */
export const nothingToClose = (proposal: MonthCloseProposal) =>
	proposal.leftovers.length === 0 && proposal.windfall <= 0;

/**
 * What happens when nobody decides in time: every leftover is Swept to the emergency Goal, or
 * left alone when there isn't one. A Windfall is always left for the Parents (ADR-0001: it is
 * allocated deliberately), still shown on its month.
 */
export function defaultDecision(
	proposal: MonthCloseProposal,
	emergencyGoalId: string | null,
): MonthCloseDecision {
	return {
		sweeps:
			emergencyGoalId === null
				? []
				: proposal.leftovers.map((l) => ({
						bucketId: l.bucketId,
						goalId: emergencyGoalId,
						amount: l.amount,
					})),
		windfall: [],
	};
}

/**
 * Whether a decision fits the proposal: each Sweep from a Bucket with a leftover, no more than
 * it (and each Bucket Swept once), and the Windfall sent no more than is pending.
 */
export function fitsProposal(proposal: MonthCloseProposal, decision: MonthCloseDecision): boolean {
	const swept = new Set<string>();
	for (const sweep of decision.sweeps) {
		const leftover = proposal.leftovers.find((l) => l.bucketId === sweep.bucketId);
		if (!leftover || swept.has(sweep.bucketId) || sweep.amount <= 0) return false;
		if (sweep.amount > leftover.amount) return false;
		swept.add(sweep.bucketId);
	}
	const sent = decision.windfall.reduce((sum, w) => sum + w.amount, 0);
	return decision.windfall.every((w) => w.amount > 0) && sent <= proposal.windfall;
}

/** What became of a month's money as it ended, shown on that month once it has. */
export type MonthEnd = {
	/** Fresh-start Buckets' leftovers Swept into Goals. */
	sweeps: { bucketId: string; name: string; goalId: string; amount: Cents }[];
	/** The month's Windfall sent to Goals, per Goal. */
	windfall: { goalId: string; amount: Cents }[];
	/** What each Rolling Bucket carries into the next month; negative when it was overspent. */
	rolledOver: { bucketId: string; name: string; amount: Cents }[];
};

/**
 * How `state`'s month ended: its Sweeps, the Windfall it sent to Goals, and what its Rolling
 * Buckets carry into the next month (as rolledOver works it out). `state` is the month as of its
 * last day. Sweeps and funding from other months, or Sweeps from Buckets not in the Plan, are
 * left out.
 */
export function monthEnd(
	state: MonthState,
	{ sweeps, goalFunding }: { sweeps: Sweep[]; goalFunding: GoalFunding[] },
): MonthEnd {
	const windfall = new Map<string, Cents>();
	for (const funding of goalFunding) {
		if (!funding.windfall || funding.month !== state.month) continue;
		windfall.set(funding.goalId, (windfall.get(funding.goalId) ?? 0) + funding.amount);
	}
	return {
		sweeps: sweeps.flatMap((sweep) => {
			const bucket = state.buckets.find((b) => b.id === sweep.bucketId);
			return bucket && sweep.month === state.month
				? [{ bucketId: bucket.id, name: bucket.name, goalId: sweep.goalId, amount: sweep.amount }]
				: [];
		}),
		windfall: [...windfall].map(([goalId, amount]) => ({ goalId, amount })),
		rolledOver: state.buckets
			.filter((b) => b.rolling && b.left !== 0)
			.map((b) => ({ bucketId: b.id, name: b.name, amount: b.left })),
	};
}

/** Nothing became of the month's money: no Sweeps, no Windfall to Goals, nothing rolled over. */
export const quietEnd = (end: MonthEnd) =>
	end.sweeps.length === 0 && end.windfall.length === 0 && end.rolledOver.length === 0;
