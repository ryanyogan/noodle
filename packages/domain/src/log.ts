import type { MonthKey } from "./month";
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
);

/** The kind of item a Plan change is about. */
export const logItemOfPlanChange = (kind: PlanChange["kind"]): LogItemKind => {
	if (kind === "baseline") return "take-home-pay";
	if (kind.startsWith("goal")) return "goal";
	return kind.startsWith("commitment") ? "commitment" : "bucket";
};
