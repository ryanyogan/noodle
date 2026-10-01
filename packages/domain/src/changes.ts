import type { Cadence, CommitmentTerms } from "./commitments";
import type { Cents } from "./money";
import { addMonths, type DayKey, daysInMonth, lastDayOf, type MonthKey } from "./month";

// Levers: the changes a Scenario makes to the Plan (see scenario.ts for how they're projected).
//
// Every Lever holds for a range of months: from `fromMonth` up to, but not including,
// `untilMonth` ("Groceries +$100 for 3 months" from March is from March until June), or for good
// when it has none. A Lever that changes something the Plan already stores effective-dated (the
// Baseline, an allowance, a Commitment's terms) changes it as applying the Scenario would write
// it: the value from `fromMonth` holds until a later month the Plan set on its own (ADR-0009),
// and at `untilMonth` the Plan's own value comes back.

/** The months a Lever holds for: from `fromMonth` until, not including, `untilMonth`. */
export type ChangeRange = {
	fromMonth: MonthKey;
	/** Exclusive: the first month the Lever no longer holds. None: for good. */
	untilMonth?: MonthKey;
};

/**
 * A Lever muted in the sandbox: kept in the Scenario (and saved with it) but left out of its
 * projection and never applied, to see the outcome without it. Unset: it counts.
 */
export type ChangeMute = { muted?: boolean };

/** Whether a one-off takes money out (a roof repair) or brings it in (a bonus). */
export type OneOffFlow = "expense" | "income";

/** A single adjustable quantity in a Scenario (v2: every Lever has a range). */
export type Change = ChangeRange &
	ChangeMute &
	(
		| {
				/** Income from `fromMonth`: a raise, a job change, parental leave. */
				kind: "baseline";
				amount: Cents;
		  }
		| { kind: "allowance"; bucketId: string; amount: Cents }
		| {
				/** An existing Commitment's amount, cadence and/or due day (whichever are set). */
				kind: "commitment-terms";
				commitmentId: string;
				amount?: Cents;
				cadence?: Cadence;
				/** 1–31; a shorter month takes its last day. */
				dueDay?: number;
		  }
		| {
				/** Takes a Commitment (the Plan's or an added one) out of the Plan for the range. */
				kind: "end-commitment";
				commitmentId: string;
		  }
		| {
				kind: "add-commitment";
				/** The new Commitment's ID once applied, so applying again adds it only once. */
				commitmentId: string;
				name: string;
				/** Taken each time it's due. */
				amount: Cents;
				cadence: Cadence;
				/** 1–31; a shorter month takes its last day. An annual one is due in `fromMonth`'s month. */
				dueDay: number;
				/**
				 * Its term in months from `fromMonth` (a loan's or lease's), null for good. It ends at
				 * the earlier of the end of its term and `untilMonth`.
				 */
				months: number | null;
		  }
		| {
				/** A single expense or income in `fromMonth` (`untilMonth` means nothing to it). */
				kind: "one-off";
				oneOffId: string;
				name: string;
				amount: Cents;
				flow: OneOffFlow;
		  }
		| {
				kind: "add-bucket";
				/** The new Bucket's ID once applied (a client ULID). */
				bucketId: string;
				name: string;
				/** Its allowance each month. */
				amount: Cents;
				rolling?: boolean;
				/** 1–8, its identity colour once applied; the next free one when unset. */
				color?: number;
		  }
		| {
				/** Takes a Bucket (the Plan's or an added one) out of the Plan for the range. */
				kind: "archive-bucket";
				bucketId: string;
		  }
		| {
				/** An existing Goal's target and date, from `fromMonth`. */
				kind: "goal";
				goalId: string;
				target: Cents;
				targetDate: DayKey | null;
		  }
		| {
				/** A new Goal, funded from `fromMonth` (from nothing saved). */
				kind: "add-goal";
				/** The new Goal's ID once applied (a client ULID). */
				goalId: string;
				name: string;
				target: Cents;
				targetDate: DayKey | null;
				/** The Account it's kept in once applied; applying needs one. */
				accountId?: string;
		  }
		| {
				/**
				 * Yearly growth, in percent: income grows the Baseline, costs grow Commitments and
				 * allowances. It compounds yearly, in steps: amounts hold for the 12 months from
				 * `fromMonth`, then grow by the percentage, and again every 12 months after.
				 */
				kind: "growth";
				incomePct: number;
				costsPct: number;
		  }
	);

export type ChangeKind = Change["kind"];

/** A Lever of one kind. */
export type ChangeOf<K extends ChangeKind> = Extract<Change, { kind: K }>;

/** A Lever as v1 Scenarios saved it, before Levers had ranges. */
export type ChangeV1 =
	/** From the first month projected (the Household's current month). */
	| { kind: "allowance"; bucketId: string; amount: Cents }
	| { kind: "end-commitment"; commitmentId: string; fromMonth: MonthKey }
	| { kind: "goal"; goalId: string; target: Cents; targetDate: DayKey | null }
	/** Due monthly on the 1st. */
	| {
			kind: "add-commitment";
			commitmentId: string;
			name: string;
			amount: Cents;
			fromMonth: MonthKey;
			months: number | null;
	  };

/** A saved Scenario's Levers. v1 Scenarios saved the bare array. */
export type ScenarioJson = { version: 2; levers: Change[] };

export const SCENARIO_VERSION = 2;

/**
 * v1 Levers as v2 ones, with the same meaning: an allowance or Goal Lever holds from `start` (the
 * first month projected, which v1 meant), and a new Commitment is due monthly on the 1st. v2
 * Levers pass through, so a mix is fine.
 */
export function upgradeChanges(changes: readonly (Change | ChangeV1)[], start: MonthKey): Change[] {
	return changes.map((change): Change => {
		switch (change.kind) {
			case "allowance":
			case "goal":
				return "fromMonth" in change ? change : { ...change, fromMonth: start };
			case "add-commitment":
				return "cadence" in change ? change : { ...change, cadence: "monthly", dueDay: 1 };
			default:
				return change;
		}
	});
}

/** A saved Scenario's Levers, whichever version saved them (see upgradeLevers for `start`). */
export function readScenarioChanges(
	stored: ScenarioJson | readonly ChangeV1[],
	start: MonthKey,
): Change[] {
	return upgradeChanges(Array.isArray(stored) ? stored : (stored as ScenarioJson).levers, start);
}

/** The Levers that count: every one not muted. Projecting and applying see only these. */
export const activeChanges = (changes: readonly Change[]): Change[] =>
	changes.filter((l) => !l.muted);

/** Whether a Lever holds in `month`. */
export const holdsIn = (change: ChangeRange, month: MonthKey) =>
	month >= change.fromMonth && (change.untilMonth === undefined || month < change.untilMonth);

/**
 * The months a Lever holds from `start` (the Household's current month) on: a range that began
 * earlier holds from `start`, as applying it can't change past months. Null when it's over.
 */
export function rangeFrom(
	change: ChangeRange,
	start: MonthKey,
): { from: MonthKey; until: MonthKey | null } | null {
	const from = change.fromMonth < start ? start : change.fromMonth;
	const until = change.untilMonth ?? null;
	return until !== null && until <= from ? null : { from, until };
}

/**
 * A Commitment's schedule for a due day (1–31) from `from`: its first due date on or after `from`
 * (in a month that has that day, for a monthly one, so the day isn't lost). An annual one is due
 * in `monthOfYear` ("01"–"12"), or `from`'s month.
 */
export function dueDateFrom(
	cadence: Cadence,
	from: MonthKey,
	day: number,
	monthOfYear?: string,
): DayKey {
	const on = (month: MonthKey) =>
		`${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, "0")}` as DayKey;
	if (cadence === "biweekly") return on(from);
	if (cadence === "monthly") {
		let month = from;
		while (daysInMonth(month) < day) month = addMonths(month, 1);
		return on(month);
	}
	const mm = monthOfYear ?? from.slice(5, 7);
	const thisYear = `${from.slice(0, 4)}-${mm}` as MonthKey;
	return on(thisYear < from ? addMonths(thisYear, 12) : thisYear);
}

/**
 * A Commitment's terms as a `commitment-terms` Lever changes them from `from`. The schedule stays
 * as it was unless the Lever changes the cadence or due day; an annual one staying annual keeps
 * its month.
 */
export function changedTerms(
	terms: CommitmentTerms,
	change: Pick<ChangeOf<"commitment-terms">, "amount" | "cadence" | "dueDay">,
	from: MonthKey,
): CommitmentTerms {
	const amount = change.amount ?? terms.amount;
	const cadence = change.cadence ?? terms.cadence;
	if (cadence === terms.cadence && change.dueDay === undefined) {
		return { amount, cadence, dueDate: terms.dueDate };
	}
	const day = change.dueDay ?? Number(terms.dueDate.slice(8, 10));
	const keepMonth = cadence === "annual" && terms.cadence === "annual";
	return {
		amount,
		cadence,
		dueDate: dueDateFrom(cadence, from, day, keepMonth ? terms.dueDate.slice(5, 7) : undefined),
	};
}

/** A new Commitment's terms from an `add-commitment` Lever. */
export const addedTerms = (change: ChangeOf<"add-commitment">): CommitmentTerms => ({
	amount: change.amount,
	cadence: change.cadence,
	dueDate: dueDateFrom(change.cadence, change.fromMonth, change.dueDay),
});

/** The first month an `add-commitment` Lever no longer holds: its term's end or `untilMonth`. */
export function addedUntil(change: ChangeOf<"add-commitment">): MonthKey | undefined {
	const termEnd = change.months === null ? undefined : addMonths(change.fromMonth, change.months);
	if (termEnd === undefined) return change.untilMonth;
	if (change.untilMonth === undefined) return termEnd;
	return termEnd < change.untilMonth ? termEnd : change.untilMonth;
}

/**
 * Why applying a Lever from `month` (the Household's current month) can't make it the real Plan,
 * or null when it can. Only what the Plan stores can be applied: a one-off or growth is an
 * assumption, and a Plan change that ends and comes back (ending a Commitment, archiving a
 * Bucket, a Goal's target) has nowhere to be stored for a while only.
 */
export function whyNotApplicable(change: Change, month: MonthKey): string | null {
	switch (change.kind) {
		case "one-off":
			return "A one-off isn’t part of the Plan. Make it a Goal to save for it.";
		case "growth":
			return "Growth is an assumption about the future, not part of the Plan.";
		case "end-commitment":
			return change.untilMonth === undefined
				? null
				: "Ending a Commitment for a while can’t be applied. End it for good instead.";
		case "archive-bucket":
			return change.untilMonth === undefined
				? null
				: "Archiving a Bucket for a while can’t be applied. Archive it for good instead.";
		case "goal":
		case "add-goal":
			if (change.untilMonth !== undefined || change.fromMonth > month) {
				return "A Goal’s change applies from this month, for good.";
			}
			if (change.kind === "add-goal" && change.accountId === undefined) {
				return "Choose the Account the Goal is kept in.";
			}
			return null;
		default:
			return null;
	}
}

/**
 * Whether a Lever is an assumption about the future rather than a change to the Plan: a one-off
 * or growth. Applying a Scenario leaves these out; the Plan has nowhere to store them.
 */
export const isAssumption = (change: Change): change is ChangeOf<"one-off" | "growth"> =>
	change.kind === "one-off" || change.kind === "growth";

/**
 * A one-off expense as a Goal to save for it instead ("Make it a Goal"), which applying can make
 * part of the Plan: a new Goal of its amount, funded from `month` (the Household's current
 * month) and due on the first of the one-off's month, or at the end of this one if that's now.
 */
export function oneOffAsGoal(
	change: ChangeOf<"one-off">,
	input: { goalId: string; month: MonthKey; accountId?: string },
): ChangeOf<"add-goal"> {
	return {
		kind: "add-goal",
		goalId: input.goalId,
		name: change.name,
		target: change.amount,
		targetDate: change.fromMonth > input.month ? `${change.fromMonth}-01` : lastDayOf(input.month),
		fromMonth: input.month,
		...(input.accountId === undefined ? {} : { accountId: input.accountId }),
		...(change.muted ? { muted: true } : {}),
	};
}
