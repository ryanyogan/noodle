import type { MoneyInKind } from "./money-in";
import { type MonthKey, partsAt } from "./month";
import type { PlanChange } from "./plan-history";

/** The kinds of item the Log can be narrowed to. */
export const LOG_ITEM_KINDS = [
	"take-home-pay",
	"bucket",
	"commitment",
	"goal",
	"rule",
	"snapshot",
	"fresh-start",
	"bank-connection",
	"account",
] as const;

export type LogItemKind = (typeof LOG_ITEM_KINDS)[number];

/**
 * The Log's order: by when a change was made, or by who made it (by name, and each Member's
 * changes newest first). Newest first unless asked otherwise.
 */
export type LogSort = { by: "when" | "who"; desc: boolean };

/**
 * Where the Log's next page starts: after the row made at `at`, of source `rank`, with `id`;
 * and, in the order by who, by the Member named `who` ("" when nobody is on record).
 */
export type LogCursor = { at: number; rank: number; id: string; who?: string };

/** Why a Household snapshot the Log shows was taken (the nightly ones are left out). */
export type LogSnapshotKind =
	| "manual"
	| "before-restore"
	| "before-fresh-start"
	| "before-delete"
	| "before-rule-apply"
	| "before-transactions-delete";

export type LogFreshStartStatus = "scheduled" | "running" | "failed" | "done" | "cancelled";

/**
 * One row of the Log: a change made to the Household, as a Viewer may see it. A Plan change to
 * the other Parent's Personal Allowance carries kind "personal-allowance" and no values or name,
 * and a Rule that files into it is not there at all (ADR-0003).
 */
export type LogRow = {
	/** Unique in the Log: the source and its row's ID. */
	key: string;
	/** When it was made, in ms since the epoch. */
	at: number;
	/** Who made it; null when nobody is on record. */
	memberId: string | null;
	memberName: string | null;
	item: LogItemKind;
	/** The first month it takes effect; null for what holds from the moment it is made. */
	month: MonthKey | null;
} & (
	| { source: "plan"; change: PlanChange }
	| { source: "rule"; pattern: string; targetName: string | null }
	| { source: "snapshot"; kind: LogSnapshotKind; note: string | null }
	| { source: "fresh-start"; status: LogFreshStartStatus }
	| { source: "bank-connection"; institution: string | null; disconnected: boolean }
	/** A Rule for money in that still stands; `pair` when it remembers a pair of Accounts. */
	| { source: "money-in-rule"; pattern: string; kind: MoneyInKind; pair: boolean }
	/** A wording remembered as a card payment; `cardName` is null for a card that isn't in Noodle. */
	| { source: "card-payment-rule"; pattern: string; cardName: string | null }
	/** Something removed, from the Log's own record: the item's name as it was, and a detail. */
	| { source: "event"; event: LogEventKind; name: string | null; detail: string | null }
);

/**
 * What the Log keeps a record of itself (issue 141), because no other row survives it: a Rule
 * removed (with the Rule as it was made, written at the same moment), a Bank Connection
 * disconnected by a Parent ("removed") or at the bank ("disconnected"), an Account archived.
 */
export const LOG_EVENT_KINDS = [
	"rule-made",
	"rule-removed",
	"money-in-rule-made",
	"money-in-rule-removed",
	"card-payment-rule-made",
	"card-payment-rule-removed",
	"bank-connection-removed",
	"bank-connection-disconnected",
	"account-archived",
] as const;

export type LogEventKind = (typeof LOG_EVENT_KINDS)[number];

/** A money-in Rule's detail in the Log's record when it remembered a pair of Accounts. */
export const LOG_PAIR_DETAIL = "pair";

/** The kind of item one of the Log's own records is about. */
export const logItemOfEvent = (kind: LogEventKind): LogItemKind => {
	if (kind === "account-archived") return "account";
	return kind.startsWith("bank-connection") ? "bank-connection" : "rule";
};

/**
 * Names in the Log's order by who: by code point, which is how SQLite compares text (the bytes
 * of UTF-8 sort as code points do). JavaScript's own `<` compares UTF-16 units, which puts an
 * emoji before "ﬁ"; the Log's selects and its merge must agree, so the merge uses this.
 */
export function compareLogNames(a: string, b: string): number {
	const [x, y] = [Array.from(a), Array.from(b)];
	const shared = Math.min(x.length, y.length);
	for (let i = 0; i < shared; i++) {
		const d = (x[i]?.codePointAt(0) ?? 0) - (y[i]?.codePointAt(0) ?? 0);
		if (d !== 0) return d < 0 ? -1 : 1;
	}
	return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

const MONTHS_SHORT = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/**
 * When a change was made, as the Log says it: the day and the time of day in the Household's
 * time zone ("Oct 6, 3:42 PM"), with the year when it isn't this one ("Oct 6, 2025, 3:42 PM").
 */
export function logWhen(at: number, timeZone: string, now: number): string {
	const instant = new Date(at);
	const { year, month, day } = partsAt(instant, timeZone);
	const time = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	}).formatToParts(instant);
	const part = (type: string) => time.find((p) => p.type === type)?.value ?? "";
	const thisYear = partsAt(new Date(now), timeZone).year;
	const date = `${MONTHS_SHORT[Number(month) - 1]} ${Number(day)}${year === thisYear ? "" : `, ${year}`}`;
	return `${date}, ${part("hour")}:${part("minute")} ${part("dayPeriod").toUpperCase()}`;
}

/** The kind of item a Plan change is about. */
export const logItemOfPlanChange = (kind: PlanChange["kind"]): LogItemKind => {
	if (kind === "baseline") return "take-home-pay";
	if (kind.startsWith("goal")) return "goal";
	return kind.startsWith("commitment") ? "commitment" : "bucket";
};
