import type { Cents } from "./money";
import type { MonthKey } from "./month";

/**
 * The Plan is stored as effective-dated records: a Baseline or allowance set for a month
 * holds for every later month until it is set again, so each month's Plan starts as a copy
 * of the previous one without copying rows.
 */
export type PlanRecords = {
	baselines: { month: MonthKey; amount: Cents }[];
	buckets: BucketRecord[];
	allowances: { bucketId: string; month: MonthKey; amount: Cents }[];
};

export type BucketRecord = {
	id: string;
	name: string;
	/** 1–8, the Bucket's identity colour. */
	color: number;
	/** Display order within the Plan, ascending. */
	position: number;
	/** The first month the Bucket is part of the Plan. */
	fromMonth: MonthKey;
	/** The first month the Bucket is no longer part of the Plan, once archived. */
	archivedFromMonth: MonthKey | null;
};

export type PlanBucket = { id: string; name: string; color: number; allowance: Cents };

/** One month's Plan. `baseline` is null until a Parent has set one. */
export type Plan = { month: MonthKey; baseline: Cents | null; buckets: PlanBucket[] };

/** The latest record at or before `month`. */
function effective<T extends { month: MonthKey }>(records: T[], month: MonthKey): T | undefined {
	let found: T | undefined;
	for (const record of records) {
		if (record.month <= month && (!found || record.month > found.month)) found = record;
	}
	return found;
}

/** The Plan in force for `month`: its Baseline, and its Buckets in order with their allowances. */
export function planForMonth(records: PlanRecords, month: MonthKey): Plan {
	const buckets = records.buckets
		.filter(
			(b) => b.fromMonth <= month && (b.archivedFromMonth === null || month < b.archivedFromMonth),
		)
		.sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))
		.map(({ id, name, color }) => ({
			id,
			name,
			color,
			allowance:
				effective(
					records.allowances.filter((a) => a.bucketId === id),
					month,
				)?.amount ?? 0,
		}));
	return { month, baseline: effective(records.baselines, month)?.amount ?? null, buckets };
}

/** Everything the Plan assigns to Buckets this month. */
export function totalAllowances(plan: Pick<Plan, "buckets">): Cents {
	return plan.buckets.reduce((sum, b) => sum + b.allowance, 0);
}

/**
 * Money in the Plan not yet assigned to anything. Negative when the Plan assigns more than
 * the Baseline, which the app must always say out loud (never clamp to zero).
 */
export function freeToSpend(plan: Pick<Plan, "baseline" | "buckets">): Cents {
	return (plan.baseline ?? 0) - totalAllowances(plan);
}
