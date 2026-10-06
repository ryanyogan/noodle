import { type FreshStart, freshStartTrouble } from "@noodle/db";
import { CLEAR_STEPS } from "./fresh-start-clear";

// What both Parents are told when a fresh start has failed or stopped moving (issue 118,
// ADR-0029's addendum): where it stopped, since when, and only what really has been done.

/** The step before the clear's own: Start fresh takes a snapshot first (ADR-0035). */
export const SNAPSHOT_STEP = "snapshot";

/** Each clear step once it has finished, as the Parent reads it. */
const DONE: Record<(typeof CLEAR_STEPS)[number]["key"], string> = {
	banks: "banks disconnected",
	background: "background work stopped",
	merchants: "merchants forgotten",
	files: "statements and receipts cleared",
	rows: "Transactions and the Plan cleared",
};

export type FreshStartTrouble = {
	/** `failed`: a step used up its retries. `stuck`: nothing has moved for 20 minutes. */
	kind: "failed" | "stuck";
	/** The step it stopped at ("Forgetting merchants"); null when it never began one. */
	stoppedAt: string | null;
	/** When it failed, or last moved. */
	since: number;
	/** True when it was due and has not begun at all. */
	notBegun: boolean;
	/** What has finished, in order ("a snapshot taken", "banks disconnected"); never more. */
	done: string[];
};

type Row = Pick<
	FreshStart,
	"level" | "status" | "runAt" | "progressAt" | "step" | "label" | "failedStep" | "failedAt"
>;

export function troubleOf(row: Row, now: number): FreshStartTrouble | null {
	const kind = freshStartTrouble(row, now);
	if (!kind) return null;
	const notBegun = row.status === "scheduled";
	// `step` is the clear step it last began (1 for the first, 0 before any): those before it
	// finished. A step that failed is not done, whatever was reached before (a later run goes
	// over the earlier steps again).
	const failedIndex = CLEAR_STEPS.findIndex((step) => step.key === row.failedStep);
	const snapshotFailed = row.failedStep === SNAPSHOT_STEP;
	let finished = Math.max(0, Math.min(row.step, CLEAR_STEPS.length + 1) - 1);
	if (snapshotFailed) finished = 0;
	else if (failedIndex >= 0) finished = Math.min(finished, failedIndex);
	const done: string[] = [];
	if (row.level === "fresh-start" && row.step >= 1 && !snapshotFailed)
		done.push("a snapshot taken");
	for (const step of CLEAR_STEPS.slice(0, finished)) done.push(DONE[step.key]);
	return {
		kind,
		stoppedAt: snapshotFailed
			? "Taking a snapshot"
			: failedIndex >= 0
				? (CLEAR_STEPS[failedIndex]?.label ?? null)
				: notBegun
					? null
					: row.label,
		since:
			(kind === "failed" ? row.failedAt : notBegun ? row.runAt : row.progressAt)?.getTime() ??
			row.runAt.getTime(),
		notBegun,
		done,
	};
}
