import type { Cents } from "./money";
import { type DayKey, type MonthKey, monthOfDay, monthsBetween } from "./month";

export const ACCOUNT_KINDS = ["checking", "savings", "credit-card", "loan"] as const;

/**
 * Checking and savings Accounts hold money; for credit cards and loans the balance is what's
 * owed.
 */
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** Only Accounts that hold money can back what a Goal has set aside. */
export const holdsMoney = (kind: AccountKind) => kind === "checking" || kind === "savings";

/** A balance a Parent entered for an Account, and when it was recorded (ms). */
export type BalanceUpdate = { amount: Cents; at: number };

/** Money out recorded against an Account (Goal spending), and when it was recorded (ms). */
export type AccountWithdrawal = { amount: Cents; at: number };

/**
 * An Account's balance: the latest balance a Parent entered, less the withdrawals recorded
 * after it (those before it are already in it; one recorded the same millisecond is taken as
 * after). Null until a balance is entered.
 */
export function accountBalance(
	latest: BalanceUpdate | null,
	withdrawals: AccountWithdrawal[],
): Cents | null {
	if (latest === null) return null;
	return withdrawals.reduce(
		(balance, w) => (w.at >= latest.at ? balance - w.amount : balance),
		latest.amount,
	);
}

/**
 * One change to what a Goal has set aside, signed. `claim`: not set aside money set aside for the Goal (or
 * released back, negative); `funding`: Goal funding, a Move from Free to Spend in `month`'s
 * Plan; `spending`: a Transaction assigned to the Goal (negative).
 */
export type SetAsideChange = {
	goalId: string;
	kind: "claim" | "funding" | "spending";
	amount: Cents;
	month: MonthKey;
};

/** A Goal's set-aside money: every change to it, summed. */
export function setAsideOf(goalId: string, changes: SetAsideChange[]): Cents {
	return changes.reduce((sum, c) => (c.goalId === goalId ? sum + c.amount : sum), 0);
}

/**
 * How an Account's balance splits between its what Goals have set aside and not set aside money. Archived
 * Goals claim nothing. not set aside is null until the Account has a balance, and negative when
 * what Goals have set aside add up to more than the balance, by `overClaimedBy`.
 */
export function splitAccount({
	balance,
	goals,
	changes,
}: {
	balance: Cents | null;
	/** This Account's Goals. */
	goals: { id: string; archived: boolean }[];
	changes: SetAsideChange[];
}): {
	earmarks: { goalId: string; amount: Cents }[];
	earmarked: Cents;
	unclaimed: Cents | null;
	overClaimedBy: Cents;
} {
	const setAsides = goals
		.filter((g) => !g.archived)
		.map((g) => ({ goalId: g.id, amount: setAsideOf(g.id, changes) }));
	const setAside = setAsides.reduce((sum, e) => sum + e.amount, 0);
	const notSetAside = balance === null ? null : balance - setAside;
	return {
		earmarks: setAsides,
		earmarked: setAside,
		unclaimed: notSetAside,
		overClaimedBy: Math.max(0, -(notSetAside ?? 0)),
	};
}

/**
 * `reached`: saved the target.
 * `saving`: no target date, so no schedule to keep.
 * `past-due`: the target date's month has passed without reaching it.
 * `behind`: saved less than an even schedule from the Goal's first month expects by now.
 * `on-track`: otherwise.
 */
export type GoalStatus = "reached" | "on-track" | "behind" | "past-due" | "saving";

export type GoalProgress = {
	/** The Goal's set-aside money. */
	saved: Cents;
	/** Still to save to reach the target. */
	remaining: Cents;
	/** Saved as a share of the target, 0–1. */
	share: number;
	/** Moved into it in this month's Plan: Goal funding, and any Extra income or Sweep sent to it. */
	fundedThisMonth: Cents;
	/** Months to the target date, counting this one and the target's. Null when undated. */
	monthsLeft: number | null;
	/**
	 * What to fund each month from this one on to reach the target in time. Set from what
	 * is saved apart from this month's Goal funding, so it holds steady as the month is
	 * funded (money set aside from not set aside this month counts as saved). Null when undated
	 * or past due.
	 */
	monthly: Cents | null;
	/** What's still to fund this month. Null when undated or past due. */
	leftThisMonth: Cents | null;
	status: GoalStatus;
};

/** How a Goal is doing in `month` (the Household's current month). */
export function goalProgress(
	goal: { id: string; target: Cents; targetDate: DayKey | null; fromMonth: MonthKey },
	changes: SetAsideChange[],
	month: MonthKey,
): GoalProgress {
	const own = changes.filter((c) => c.goalId === goal.id);
	const saved = setAsideOf(goal.id, own);
	const fundedThisMonth = setAsideOf(
		goal.id,
		own.filter((c) => c.kind === "funding" && c.month === month),
	);
	const savedApartFromFunding = saved - fundedThisMonth;
	const remaining = Math.max(0, goal.target - saved);
	const share = goal.target > 0 ? Math.min(1, Math.max(0, saved / goal.target)) : 1;
	const base = { saved, remaining, share, fundedThisMonth };
	if (goal.targetDate === null) {
		const status = saved >= goal.target ? "reached" : "saving";
		return { ...base, monthsLeft: null, monthly: null, leftThisMonth: null, status };
	}
	const targetMonth = monthOfDay(goal.targetDate);
	// The target's month counts: a Goal due this month has one month left.
	const monthsLeft = Math.max(0, monthsBetween(month, targetMonth) + 1);
	if (saved >= goal.target) {
		return { ...base, monthsLeft, monthly: 0, leftThisMonth: 0, status: "reached" };
	}
	if (monthsLeft === 0) {
		return { ...base, monthsLeft, monthly: null, leftThisMonth: null, status: "past-due" };
	}
	const monthly = Math.ceil(Math.max(0, goal.target - savedApartFromFunding) / monthsLeft);
	const leftThisMonth = Math.max(0, monthly - fundedThisMonth);
	// An even schedule from the Goal's first month: behind once earlier months' shares were
	// missed and haven't been made up yet.
	const total = Math.max(1, monthsBetween(goal.fromMonth, targetMonth) + 1);
	const elapsed = Math.min(total, Math.max(0, monthsBetween(goal.fromMonth, month)));
	const expectedByStart = Math.floor((goal.target * elapsed) / total);
	const status = saved < expectedByStart ? "behind" : "on-track";
	return { ...base, monthsLeft, monthly, leftThisMonth, status };
}

/**
 * What Goals still need funded this month, together: each dated Goal's `leftThisMonth`. Undated,
 * past-due and reached Goals need nothing. With the month's Goal funding (MonthState.fundedGoals,
 * as Free to Spend counts it), it's the Goals' summary on This Month.
 */
export function stillToFund(progress: readonly Pick<GoalProgress, "leftThisMonth">[]): Cents {
	return progress.reduce((sum, p) => sum + (p.leftThisMonth ?? 0), 0);
}

/**
 * A Goal's history, newest first, in months: each month's changes latest first by their date
 * (spending has one; claims and funding belong to the whole month, so they sit at its start),
 * then by when they were made (`id`, a ULID), with the month's net. Not the order the changes
 * were recorded: spending entered late, a statement brought in, or a month's Sweeps closed after
 * the fact belong where they happened.
 */
export function goalHistory<C extends SetAsideChange & { id: string; date?: DayKey }>(
	changes: readonly C[],
): { month: MonthKey; net: Cents; changes: C[] }[] {
	const day = (c: C) => c.date ?? `${c.month}-01`;
	const sorted = [...changes].sort(
		(a, b) =>
			(a.month < b.month ? 1 : a.month > b.month ? -1 : 0) ||
			(day(a) < day(b) ? 1 : day(a) > day(b) ? -1 : 0) ||
			(a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
	);
	const months: { month: MonthKey; net: Cents; changes: C[] }[] = [];
	for (const change of sorted) {
		const last = months.at(-1);
		if (last?.month === change.month) {
			last.changes.push(change);
			last.net += change.amount;
		} else months.push({ month: change.month, net: change.amount, changes: [change] });
	}
	return months;
}

/**
 * Where a withdrawal from an Account comes from (ADR-0002): the Goal it's assigned to;
 * not set aside money when that covers it (or nothing is earmarked); otherwise it dips into
 * what Goals have set aside by `fromEarmarks`, and a Parent decides which Goals in Review.
 */
export type WithdrawalAttribution =
	| { kind: "goal"; goalId: string }
	| { kind: "unclaimed" }
	| { kind: "review"; fromEarmarks: Cents };

export function attributeWithdrawal(
	withdrawal: { amount: Cents; goalId: string | null },
	account: { balanceBefore: Cents; earmarked: Cents },
): WithdrawalAttribution {
	if (withdrawal.goalId !== null) return { kind: "goal", goalId: withdrawal.goalId };
	const notSetAside = Math.max(0, account.balanceBefore - account.earmarked);
	if (account.earmarked <= 0 || withdrawal.amount <= notSetAside) return { kind: "unclaimed" };
	return { kind: "review", fromEarmarks: withdrawal.amount - notSetAside };
}
