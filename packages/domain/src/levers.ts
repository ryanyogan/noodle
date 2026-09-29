import type { Cadence, CommitmentTerms } from "./commitments";
import type { Cents } from "./money";
import { addMonths, type DayKey, daysInMonth, type MonthKey } from "./month";

// Levers: the changes a Scenario makes to the Plan (see scenario.ts for how they're projected).
//
// Every Lever holds for a range of months: from `fromMonth` up to, but not including,
// `untilMonth` ("Groceries +$100 for 3 months" from March is from March until June), or for good
// when it has none. A Lever that changes something the Plan already stores effective-dated (the
// Baseline, an allowance, a Commitment's terms) changes it as applying the Scenario would write
// it: the value from `fromMonth` holds until a later month the Plan set on its own (ADR-0009),
// and at `untilMonth` the Plan's own value comes back.

/** The months a Lever holds for: from `fromMonth` until, not including, `untilMonth`. */
export type LeverRange = {
	fromMonth: MonthKey;
	/** Exclusive: the first month the Lever no longer holds. None: for good. */
	untilMonth?: MonthKey;
};

/** Whether a one-off takes money out (a roof repair) or brings it in (a bonus). */
export type OneOffFlow = "expense" | "income";

/** A single adjustable quantity in a Scenario (v2: every Lever has a range). */
export type Lever = LeverRange &
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

export type LeverKind = Lever["kind"];

/** A Lever of one kind. */
export type LeverOf<K extends LeverKind> = Extract<Lever, { kind: K }>;

/** A Lever as v1 Scenarios saved it, before Levers had ranges. */
export type LeverV1 =
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
export type ScenarioJson = { version: 2; levers: Lever[] };

export const SCENARIO_VERSION = 2;

/**
 * v1 Levers as v2 ones, with the same meaning: an allowance or Goal Lever holds from `start` (the
 * first month projected, which v1 meant), and a new Commitment is due monthly on the 1st. v2
 * Levers pass through, so a mix is fine.
 */
export function upgradeLevers(levers: readonly (Lever | LeverV1)[], start: MonthKey): Lever[] {
	return levers.map((lever): Lever => {
		switch (lever.kind) {
			case "allowance":
			case "goal":
				return "fromMonth" in lever ? lever : { ...lever, fromMonth: start };
			case "add-commitment":
				return "cadence" in lever ? lever : { ...lever, cadence: "monthly", dueDay: 1 };
			default:
				return lever;
		}
	});
}

/** A saved Scenario's Levers, whichever version saved them (see upgradeLevers for `start`). */
export function readScenarioLevers(
	stored: ScenarioJson | readonly LeverV1[],
	start: MonthKey,
): Lever[] {
	return upgradeLevers(Array.isArray(stored) ? stored : (stored as ScenarioJson).levers, start);
}

/** Whether a Lever holds in `month`. */
export const holdsIn = (lever: LeverRange, month: MonthKey) =>
	month >= lever.fromMonth && (lever.untilMonth === undefined || month < lever.untilMonth);

/**
 * The months a Lever holds from `start` (the Household's current month) on: a range that began
 * earlier holds from `start`, as applying it can't change past months. Null when it's over.
 */
export function rangeFrom(
	lever: LeverRange,
	start: MonthKey,
): { from: MonthKey; until: MonthKey | null } | null {
	const from = lever.fromMonth < start ? start : lever.fromMonth;
	const until = lever.untilMonth ?? null;
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
	lever: Pick<LeverOf<"commitment-terms">, "amount" | "cadence" | "dueDay">,
	from: MonthKey,
): CommitmentTerms {
	const amount = lever.amount ?? terms.amount;
	const cadence = lever.cadence ?? terms.cadence;
	if (cadence === terms.cadence && lever.dueDay === undefined) {
		return { amount, cadence, dueDate: terms.dueDate };
	}
	const day = lever.dueDay ?? Number(terms.dueDate.slice(8, 10));
	const keepMonth = cadence === "annual" && terms.cadence === "annual";
	return {
		amount,
		cadence,
		dueDate: dueDateFrom(cadence, from, day, keepMonth ? terms.dueDate.slice(5, 7) : undefined),
	};
}

/** A new Commitment's terms from an `add-commitment` Lever. */
export const addedTerms = (lever: LeverOf<"add-commitment">): CommitmentTerms => ({
	amount: lever.amount,
	cadence: lever.cadence,
	dueDate: dueDateFrom(lever.cadence, lever.fromMonth, lever.dueDay),
});

/** The first month an `add-commitment` Lever no longer holds: its term's end or `untilMonth`. */
export function addedUntil(lever: LeverOf<"add-commitment">): MonthKey | undefined {
	const termEnd = lever.months === null ? undefined : addMonths(lever.fromMonth, lever.months);
	if (termEnd === undefined) return lever.untilMonth;
	if (lever.untilMonth === undefined) return termEnd;
	return termEnd < lever.untilMonth ? termEnd : lever.untilMonth;
}

/**
 * Why applying a Lever from `month` (the Household's current month) can't make it the real Plan,
 * or null when it can. Only what the Plan stores can be applied: a one-off or growth is an
 * assumption, and a Plan change that ends and comes back (ending a Commitment, archiving a
 * Bucket, a Goal's target) has nowhere to be stored for a while only.
 */
export function whyNotApplicable(lever: Lever, month: MonthKey): string | null {
	switch (lever.kind) {
		case "one-off":
			return "A one-off isn’t part of the Plan. Make it a Goal to save for it.";
		case "growth":
			return "Growth is an assumption about the future, not part of the Plan.";
		case "end-commitment":
			return lever.untilMonth === undefined
				? null
				: "Ending a Commitment for a while can’t be applied. End it for good instead.";
		case "archive-bucket":
			return lever.untilMonth === undefined
				? null
				: "Archiving a Bucket for a while can’t be applied. Archive it for good instead.";
		case "goal":
		case "add-goal":
			if (lever.untilMonth !== undefined || lever.fromMonth > month) {
				return "A Goal’s change applies from this month, for good.";
			}
			if (lever.kind === "add-goal" && lever.accountId === undefined) {
				return "Choose the Account the Goal is kept in.";
			}
			return null;
		default:
			return null;
	}
}
