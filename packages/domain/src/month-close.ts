import type { Cents } from "./money";
import type { MonthKey } from "./month";
import type { GoalFunding, MonthState, Sweep } from "./month-state";

// Closing a month, on the 1st of the next: what rolls over is already derived (see rolledOver),
// so what's left to decide is where Buckets that reset monthly' leftovers are Swept and where the
// month's pending Extra income goes, and whether the Free to Spend it ended with stays in Free to
// Spend (it is carried over as it is; ADR-0054) or is sent to a Goal (issue 113).

/** A Bucket that resets monthly's leftover at the end of the month, to Sweep or leave. */
export type Leftover = { bucketId: string; name: string; amount: Cents };

export type MonthCloseProposal = {
	month: MonthKey;
	leftovers: Leftover[];
	/** The month's Extra income still awaiting a decision. */
	windfall: Cents;
	/**
	 * The Free to Spend the month ended with, above zero, that can be sent to a Goal instead of
	 * staying carried over. Absent or zero when it ended short, or had no income recorded (such a
	 * month hands on only what it was carried, so sending from it would not lower the carry).
	 */
	freeToSpend?: Cents;
};

/** Where the Parents (or the defaults) send the month's leftovers and Extra income. */
export type MonthCloseDecision = {
	sweeps: { bucketId: string; goalId: string; amount: Cents }[];
	windfall: { goalId: string; amount: Cents }[];
	/**
	 * Free to Spend sent to Goals: ordinary Goal funding dated in the ended month. Left out, it
	 * all stays in Free to Spend, carried over.
	 */
	freeToSpend?: { goalId: string; amount: Cents }[];
};

/**
 * What there is to decide as `state`'s month closes: each Bucket that resets monthly with money left
 * (Buckets that carry over carry theirs over; a Personal Allowance's leftover is its Parent's own), and
 * the pending Extra income. `state` is the month as of its last day. `freeLeft` is the Free to Spend
 * the month ended with that can be sent to a Goal (see FreeCarryMonth: what an ended month with
 * income recorded hands on); below zero counts as none.
 */
export function monthCloseProposal(state: MonthState, freeLeft: Cents = 0): MonthCloseProposal {
	return {
		...(freeLeft > 0 ? { freeToSpend: freeLeft } : {}),
		month: state.month,
		leftovers: state.buckets
			.filter((b) => !b.rolling && b.owner === undefined && b.left > 0)
			.map((b) => ({ bucketId: b.id, name: b.name, amount: b.left })),
		windfall: state.windfallLeft,
	};
}

/**
 * Nothing the Month-close Workflow waits for: no leftovers and no pending Extra income. Free to
 * Spend left is not waited for, since leaving it alone is already the default.
 */
export const nothingToClose = (proposal: MonthCloseProposal) =>
	proposal.leftovers.length === 0 && proposal.windfall <= 0;

/**
 * Nothing for a Parent to decide: the above, and no Free to Spend left that could go to a Goal
 * (`hasGoal`: the Household has an active Goal).
 */
export const nothingToDecide = (proposal: MonthCloseProposal, hasGoal: boolean) =>
	nothingToClose(proposal) && !(hasGoal && (proposal.freeToSpend ?? 0) > 0);

/**
 * The ID of the Move that sends an ended month's Free to Spend to a Goal as it is closed. It is
 * ordinary Goal funding; the ID is what lets "How the month ended" tell it from the month's other
 * funding.
 */
export const closeFreeMoveId = (closeId: string, index: number) => `${closeId}:free:${index}`;
const isCloseFreeMove = (id: string | undefined) => id !== undefined && /:free:\d+$/.test(id);

/**
 * What happens when nobody decides in time: every leftover is Swept to the emergency Goal, or
 * left alone when there isn't one. Extra income is always left for the Parents (ADR-0001: it is
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
 * it (and each Bucket Swept once), and the Extra income sent no more than is pending.
 */
export function fitsProposal(proposal: MonthCloseProposal, decision: MonthCloseDecision): boolean {
	const swept = new Set<string>();
	for (const sweep of decision.sweeps) {
		const leftover = proposal.leftovers.find((l) => l.bucketId === sweep.bucketId);
		if (!leftover || swept.has(sweep.bucketId) || sweep.amount <= 0) return false;
		if (sweep.amount > leftover.amount) return false;
		swept.add(sweep.bucketId);
	}
	const free = decision.freeToSpend ?? [];
	const freeSent = free.reduce((sum, f) => sum + f.amount, 0);
	if (free.some((f) => f.amount <= 0) || freeSent > (proposal.freeToSpend ?? 0)) return false;
	const sent = decision.windfall.reduce((sum, w) => sum + w.amount, 0);
	return decision.windfall.every((w) => w.amount > 0) && sent <= proposal.windfall;
}

/** What became of a month's money as it ended, shown on that month once it has. */
export type MonthEnd = {
	/** Buckets that reset monthly' leftovers Swept into Goals. */
	sweeps: { bucketId: string; name: string; goalId: string; amount: Cents }[];
	/** The month's Extra income sent to Goals, per Goal. */
	windfall: { goalId: string; amount: Cents }[];
	/** What each Bucket that carries over carries into the next month; negative when it was overspent. */
	rolledOver: { bucketId: string; name: string; amount: Cents }[];
	/** Free to Spend sent to Goals as the month was closed (Goal funding), per Goal. */
	freeToSpend: { goalId: string; amount: Cents }[];
};

/**
 * How `state`'s month ended: its Sweeps, the Extra income it sent to Goals, and what its carries over
 * Buckets carry into the next month (as rolledOver works it out). `state` is the month as of its
 * last day. Sweeps and funding from other months, or Sweeps from Buckets not in the Plan, are
 * left out.
 */
export function monthEnd(
	state: MonthState,
	{ sweeps, goalFunding }: { sweeps: Sweep[]; goalFunding: (GoalFunding & { id?: string })[] },
): MonthEnd {
	const extraIncome = new Map<string, Cents>();
	const free = new Map<string, Cents>();
	for (const funding of goalFunding) {
		if (funding.month !== state.month) continue;
		const to = funding.windfall ? extraIncome : isCloseFreeMove(funding.id) ? free : null;
		to?.set(funding.goalId, (to.get(funding.goalId) ?? 0) + funding.amount);
	}
	return {
		freeToSpend: [...free].map(([goalId, amount]) => ({ goalId, amount })),
		sweeps: sweeps.flatMap((sweep) => {
			const bucket = state.buckets.find((b) => b.id === sweep.bucketId);
			return bucket && sweep.month === state.month
				? [{ bucketId: bucket.id, name: bucket.name, goalId: sweep.goalId, amount: sweep.amount }]
				: [];
		}),
		windfall: [...extraIncome].map(([goalId, amount]) => ({ goalId, amount })),
		rolledOver: state.buckets
			.filter((b) => b.rolling && b.left !== 0)
			.map((b) => ({ bucketId: b.id, name: b.name, amount: b.left })),
	};
}

/**
 * Nothing became of the month's money: no Sweeps, no Extra income or Free to Spend to Goals,
 * nothing rolled over.
 */
export const quietEnd = (end: MonthEnd) =>
	end.sweeps.length === 0 &&
	end.windfall.length === 0 &&
	end.rolledOver.length === 0 &&
	end.freeToSpend.length === 0;
