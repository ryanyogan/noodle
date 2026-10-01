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
	"commitment-add",
	"commitment-terms",
	"commitment-rename",
	"commitment-end",
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

/** One item's Plan changes in a month, netted: what it was before the first and after the last. */
export type PlanChangeGroup<C extends PlanChange = PlanChange> = {
	/** "baseline", or the Bucket, Commitment or Goal ID. */
	key: string;
	kind: "baseline" | "bucket" | "commitment" | "goal" | "personal-allowance";
	targetId: string | null;
	targetName: string | null;
	/** Added this month (so nothing was before) or taken out of the Plan from it. */
	added: boolean;
	removed: boolean;
	/** Only the values that differ between the two, keyed alike. */
	before: PlanChangeValue;
	after: PlanChangeValue;
	/** Newest first. */
	changes: C[];
};

const groupKind = (kind: PlanChange["kind"]): PlanChangeGroup["kind"] => {
	if (kind === "baseline" || kind === "personal-allowance") return kind;
	if (kind.startsWith("goal")) return "goal";
	return kind.startsWith("commitment") ? "commitment" : "bucket";
};

/**
 * What changed in `month`'s Plan since the month before, per item: the Plan changes that take
 * effect in `month`, grouped by what they changed, newest group first. An item changed and
 * changed back nets to nothing and is left out.
 */
export function whatChanged<C extends PlanChange>(
	changes: readonly C[],
	month: MonthKey,
): PlanChangeGroup<C>[] {
	const groups = new Map<string, PlanChangeGroup<C>>();
	const inOrder = changes.filter((c) => c.month === month).sort((a, b) => a.id - b.id);
	for (const change of inOrder) {
		const key = change.targetId ?? "baseline";
		const group: PlanChangeGroup<C> = groups.get(key) ?? {
			key,
			kind: groupKind(change.kind),
			targetId: change.targetId,
			targetName: change.targetName,
			added: false,
			removed: false,
			before: {},
			after: {},
			changes: [],
		};
		// The other Parent's Personal Allowance stays one opaque group.
		if (change.kind === "personal-allowance") group.kind = "personal-allowance";
		if (change.kind.endsWith("-add")) group.added = true;
		if (change.kind === "bucket-archive" || change.kind === "commitment-end") group.removed = true;
		for (const [field, value] of Object.entries(change.before ?? {})) {
			if (!(field in group.after) && !(field in group.before)) {
				(group.before as Record<string, unknown>)[field] = value;
			}
		}
		Object.assign(group.after, change.after ?? {});
		group.changes.unshift(change);
		groups.set(key, group);
	}
	const result: PlanChangeGroup<C>[] = [];
	for (const group of groups.values()) {
		const before: Record<string, unknown> = {};
		const after: Record<string, unknown> = {};
		for (const [field, value] of Object.entries(group.after)) {
			const was = (group.before as Record<string, unknown>)[field];
			if (group.added || was !== value) {
				if (!group.added) before[field] = was;
				after[field] = value;
			}
		}
		const netted = { ...group, before, after };
		const changed =
			group.added ||
			group.removed ||
			group.kind === "personal-allowance" ||
			Object.keys(after).length > 0;
		if (changed) result.push(netted);
	}
	return result.sort((a, b) => (b.changes[0]?.id ?? 0) - (a.changes[0]?.id ?? 0));
}
