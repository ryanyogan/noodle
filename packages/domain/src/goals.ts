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

/**
 * A Goal saves (money Set aside on a checking or savings Account) or pays off a credit card or
 * loan (ADR-0019): its target is what was owed when it was added, its progress how far what's
 * owed has come down since, and its funding a plan for extra payments, set aside nowhere.
 */
export const GOAL_KINDS = ["save", "payoff"] as const;

export type GoalKind = (typeof GOAL_KINDS)[number];

/** Credit cards and loans are what a payoff Goal pays down. */
export const canPayOff = (kind: AccountKind) => !holdsMoney(kind);

/**
 * What a payoff Goal has paid down: its target (what was owed when it was added) less what's
 * owed now, never below 0 (new charges took it back up) or above the target (owed nothing, or a
 * credit). Nothing until the card or loan has a balance.
 */
export function paidDownOf(target: Cents, owed: Cents | null): Cents {
	if (owed === null) return 0;
	return Math.min(target, Math.max(0, target - owed));
}

/**
 * What's owed now on a payoff Goal's card or loan: the Account's `owed` (owedOn). Null for a
 * savings Goal, or until the Account has a balance.
 */
export function owedFor(
	goal: { kind: GoalKind; accountId: string },
	accounts: readonly { id: string; owed: Cents | null }[],
): Cents | null {
	if (goal.kind !== "payoff") return null;
	return accounts.find((a) => a.id === goal.accountId)?.owed ?? null;
}

/**
 * A balance a Parent entered for an Account, and when it was recorded (ms). `day` is the day it
 * was true: a statement's closing date or the day it was typed, else the day it was recorded in
 * the Household's time zone.
 */
export type BalanceUpdate = { amount: Cents; at: number; day?: DayKey };

/** A payment filed in a Commitment that pays down a card or loan, and the day it was made. */
export type OwedPayment = { amount: Cents; date: DayKey };

/**
 * What's owed on a credit card or loan (ADR-0050, amending ADR-0019). Kept by hand: its latest
 * balance less the payments filed in Commitments that pay it down and dated after the balance's
 * day. A payment on that very day is taken as already in the balance, and a later statement or
 * typed balance supersedes every payment before it. Connected: the bank's balance, and nothing
 * comes off it. Null until the Account has a balance; below 0 when it was overpaid.
 */
export function owedOn(
	latest: { amount: Cents; day: DayKey } | null,
	payments: readonly OwedPayment[],
	connected: boolean,
	/**
	 * On a card whose purchases are kept by hand (issue 136): every line recorded on it, money out
	 * above 0 and money back below. Those after the balance's day go on what's owed.
	 */
	bought: readonly OwedPayment[] = [],
): Cents | null {
	if (latest === null) return null;
	if (connected) return latest.amount;
	const paid = payments.reduce(
		(owed, payment) => (payment.date > latest.day ? owed - payment.amount : owed),
		latest.amount,
	);
	return bought.reduce((owed, line) => (line.date > latest.day ? owed + line.amount : owed), paid);
}

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
	/** Funding that came from Extra income, or was Swept from a Bucket, rather than Free to Spend. */
	from?: "windfall" | "sweep";
};

/** A Goal's set-aside money: every change to it, summed. */
export function setAsideOf(goalId: string, changes: readonly SetAsideChange[]): Cents {
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
	/** The Goal's set-aside money; for a payoff Goal, what it has paid down (paidDownOf). */
	saved: Cents;
	/** Still to save to reach the target; for a payoff Goal, what's still owed. */
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

/** Goals with what's owed now on each payoff Goal's card or loan (owedFor), for goalProgress. */
export const withOwed = <G extends { kind: GoalKind; accountId: string }>(
	goals: readonly G[],
	accounts: readonly { id: string; owed: Cents | null }[],
): (G & { owed: Cents | null })[] => goals.map((g) => ({ ...g, owed: owedFor(g, accounts) }));

/**
 * A Goal as its progress needs it. A payoff Goal (`kind: "payoff"`) also needs what's owed now
 * (`owed`, owedFor); one without a `kind` saves.
 */
export type ProgressGoal = {
	id: string;
	target: Cents;
	targetDate: DayKey | null;
	fromMonth: MonthKey;
	kind?: GoalKind;
	owed?: Cents | null;
};

/** How a Goal is doing in `month` (the Household's current month). */
export function goalProgress(
	goal: ProgressGoal,
	changes: readonly SetAsideChange[],
	month: MonthKey,
): GoalProgress {
	if (goal.kind === "payoff") return payoffProgress(goal, goal.owed ?? null, changes, month);
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
 * How far a dated Goal is behind its even schedule from its first month, as goalProgress judges
 * "behind" (for a payoff Goal, in what it has paid down): 0 when it isn't.
 */
export function goalBehindBy(
	goal: Pick<ProgressGoal, "target" | "targetDate" | "fromMonth">,
	saved: Cents,
	month: MonthKey,
): Cents {
	if (goal.targetDate === null) return 0;
	const targetMonth = monthOfDay(goal.targetDate);
	const total = Math.max(1, monthsBetween(goal.fromMonth, targetMonth) + 1);
	const elapsed = Math.min(total, Math.max(0, monthsBetween(goal.fromMonth, month)));
	return Math.max(0, Math.floor((goal.target * elapsed) / total) - saved);
}

/**
 * How a payoff Goal is doing in `month` (ADR-0019). Saved is what it has paid down, remaining
 * what's still owed. It's reached ("Paid off") once nothing is owed. A month is what's still owed
 * spread over the months to its target date, this one included, so a payment made this month
 * lowers it at once; behind is paid down short of an even schedule from the month it was added.
 * Its funding is planned extra payments: it counts this month, never as progress.
 */
export function payoffProgress(
	goal: Omit<ProgressGoal, "kind" | "owed">,
	owed: Cents | null,
	changes: readonly SetAsideChange[],
	month: MonthKey,
): GoalProgress {
	const fundedThisMonth = setAsideOf(
		goal.id,
		changes.filter((c) => c.goalId === goal.id && c.kind === "funding" && c.month === month),
	);
	const saved = paidDownOf(goal.target, owed);
	const remaining = owed === null ? goal.target : Math.max(0, owed);
	const share = goal.target > 0 ? saved / goal.target : 1;
	const paidOff = owed !== null && owed <= 0;
	const base = { saved, remaining, share, fundedThisMonth };
	if (goal.targetDate === null) {
		const status = paidOff ? "reached" : "saving";
		return { ...base, monthsLeft: null, monthly: null, leftThisMonth: null, status };
	}
	const targetMonth = monthOfDay(goal.targetDate);
	const monthsLeft = Math.max(0, monthsBetween(month, targetMonth) + 1);
	if (paidOff) return { ...base, monthsLeft, monthly: 0, leftThisMonth: 0, status: "reached" };
	if (monthsLeft === 0) {
		return { ...base, monthsLeft, monthly: null, leftThisMonth: null, status: "past-due" };
	}
	const monthly = Math.ceil(remaining / monthsLeft);
	const leftThisMonth = Math.max(0, monthly - fundedThisMonth);
	const total = Math.max(1, monthsBetween(goal.fromMonth, targetMonth) + 1);
	const elapsed = Math.min(total, Math.max(0, monthsBetween(goal.fromMonth, month)));
	const expectedByStart = Math.floor((goal.target * elapsed) / total);
	const status = saved < expectedByStart ? "behind" : "on-track";
	return { ...base, monthsLeft, monthly, leftThisMonth, status };
}

/**
 * A Goal for projecting the Plan ahead (ProjectionGoal in scenario.ts): what it has saved, with
 * this month's funding part of it. A payoff Goal is projected as if its funding is paid to the
 * card, so what it has paid down plus this month's funding stands in for saved, and its monthly
 * amount is what's still owed over the months left, as payoffProgress has it.
 */
export function projectionGoalOf(
	goal: ProgressGoal,
	changes: readonly SetAsideChange[],
	month: MonthKey,
): {
	id: string;
	target: Cents;
	targetDate: DayKey | null;
	saved: Cents;
	fundedThisMonth: Cents;
	fundedElsewhereThisMonth: Cents;
} {
	const thisMonth = changes.filter(
		(c) => c.goalId === goal.id && c.kind === "funding" && c.month === month,
	);
	const fundedThisMonth = setAsideOf(goal.id, thisMonth);
	const fundedElsewhereThisMonth = setAsideOf(
		goal.id,
		thisMonth.filter((c) => c.from !== undefined),
	);
	const saved =
		goal.kind === "payoff"
			? paidDownOf(goal.target, goal.owed ?? null) + fundedThisMonth
			: setAsideOf(goal.id, changes as SetAsideChange[]);
	return {
		id: goal.id,
		target: goal.target,
		targetDate: goal.targetDate,
		saved,
		fundedThisMonth,
		fundedElsewhereThisMonth,
	};
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

/**
 * What was owed on a card or loan over time (ADR-0050), oldest first: each balance on its day
 * (`balances`, in the order they were recorded) and, for an Account kept by hand, what was left
 * after each payment filed in a Commitment that pays it down, until the next balance supersedes
 * it. A payment on a balance's own day is taken as already in it. Its last point is `owedOn`.
 */
export function owedOverTime(
	balances: readonly { amount: Cents; day: DayKey }[],
	payments: readonly OwedPayment[],
	connected: boolean,
): { amount: Cents; day: DayKey }[] {
	const byDay = [...payments].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	return balances.flatMap((balance, i) => {
		const next = balances[i + 1];
		let owed = balance.amount;
		const after = connected
			? []
			: byDay
					.filter((p) => p.date > balance.day && (next === undefined || p.date < next.day))
					.map((p) => {
						owed -= p.amount;
						return { amount: owed, day: p.date };
					});
		return [{ amount: balance.amount, day: balance.day }, ...after];
	});
}
