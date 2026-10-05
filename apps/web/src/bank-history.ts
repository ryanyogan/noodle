import { addDays, type DayKey } from "@noodle/domain";
import { z } from "zod";

// How far back a new Bank Connection brings Transactions in (#89). A Parent chooses once, before
// Plaid Link opens: Plaid gathers an Item's history when the Item is made and the span can't be
// changed afterwards, so the choice goes on the link token (`transactions.days_requested`). The
// start day is kept on the Bank Connection, and no Import from it keeps a line dated earlier,
// whatever Plaid sends.

/** The choices, in the order they're offered: this month only, or the last so many days. */
export const BANK_HISTORY_CHOICES = ["month", "30", "60", "90", "120", "365"] as const;

export type BankHistoryChoice = (typeof BANK_HISTORY_CHOICES)[number];

/** A fresh start: the Plan counts from the 1st of this month. Also what's used when none is said. */
export const DEFAULT_BANK_HISTORY: BankHistoryChoice = "month";

/**
 * The choice as the server takes it: one of those offered, anything else refused, and this month
 * only when none is said.
 */
export const bankHistorySchema = z.enum(BANK_HISTORY_CHOICES).default(DEFAULT_BANK_HISTORY);

export const BANK_HISTORY_OPTIONS: readonly {
	value: BankHistoryChoice;
	label: string;
	description?: string;
}[] = [
	{
		value: "month",
		label: "This month only",
		description: "Recommended. A fresh start: your Plan starts counting from the 1st.",
	},
	{ value: "30", label: "Last 30 days" },
	{ value: "60", label: "Last 60 days" },
	{ value: "90", label: "Last 90 days" },
	{ value: "120", label: "Last 120 days" },
	{ value: "365", label: "Last 365 days (a year)" },
];

export type BankHistorySpan = {
	/** What Plaid is asked for (`days_requested`): at least 1. */
	days: number;
	/** The first day kept: nothing dated before it is brought in. */
	start: DayKey;
};

/**
 * The span a choice means on `today`, the Household's own calendar day. "This month only" runs
 * from the 1st through today, so its days are the day of the month (1 on the 1st); the others
 * start that many days before today. All of it is calendar-day arithmetic on day keys, so neither
 * a clock change nor a leap day moves it.
 */
export function bankHistorySpan(choice: BankHistoryChoice, today: DayKey): BankHistorySpan {
	if (choice === "month") {
		return {
			days: Math.max(1, Number(today.slice(8, 10))),
			start: `${today.slice(0, 8)}01` as DayKey,
		};
	}
	const days = Number(choice);
	return { days, start: addDays(today, -days) };
}

/** Whether a line dated `date` is kept by a Bank Connection that starts at `start` (null: all are). */
export const withinBankHistory = (date: DayKey, start: string | null): boolean =>
	start === null || date >= start;
