import type { Cadence } from "./commitments";
import type { Cents } from "./money";
import type { DayKey, MonthKey } from "./month";
import type { PlanScope } from "./plan-scope";

/** What a Plan change changed. Every Plan write appends one (ADR-0014). */
export const PLAN_CHANGE_KINDS = [
	"baseline",
	"allowance",
	"rolling",
	"bucket-add",
	"bucket-rename",
	"bucket-archive",
	"bucket-restore",
	"commitment-add",
	"commitment-terms",
	"commitment-rename",
	"commitment-end",
	"commitment-account",
	"goal-add",
	"goal",
] as const;

export type PlanChangeKind = (typeof PLAN_CHANGE_KINDS)[number];

/**
 * The values a Plan change moved from or to; only the ones its kind has. `until` is the month a
 * Scenario's change over a range stops (the month after it goes back).
 */
export type PlanChangeValue = {
	amount?: Cents | null;
	rolling?: boolean;
	name?: string;
	cadence?: Cadence;
	dueDate?: DayKey;
	target?: Cents;
	targetDate?: DayKey | null;
	until?: MonthKey | null;
	/** The name of the card or loan a Commitment pays down; null for none (issue 93). */
	paysDown?: string | null;
	/** A Commitment's amount is "about" (it varies) or the same each time (issue 135). */
	about?: boolean;
};

/** Where a Plan change was made: the Plan itself, or a Scenario applied to it. */
export type PlanChangeSource = "plan" | "scenario";

/**
 * One appended Plan change, as a Viewer may see it. The other Parent's Personal Allowance reads
 * as kind "personal-allowance", with no values and no name (ADR-0003).
 */
export type PlanChange = {
	id: number;
	/** When it was made, in ms since the epoch. */
	at: number;
	memberId: string;
	memberName: string;
	kind: PlanChangeKind | "personal-allowance";
	/** The Bucket, Commitment or Goal; null for take-home pay. */
	targetId: string | null;
	/** Its name now; null for take-home pay and for the other Parent's Personal Allowance. */
	targetName: string | null;
	/** The first month it takes effect. */
	month: MonthKey;
	scope: PlanScope;
	source: PlanChangeSource;
	scenarioId: string | null;
	/** The Scenario's name now; null if it wasn't from one, or the Scenario was deleted. */
	scenarioName: string | null;
	before: PlanChangeValue | null;
	after: PlanChangeValue | null;
};
