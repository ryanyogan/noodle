import { type CommitmentTerms, expectedIn } from "./commitments";
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
	commitments: CommitmentRecord[];
	/** A Commitment's terms set for a month hold for later months until set again. */
	commitmentTerms: ({ commitmentId: string; month: MonthKey } & CommitmentTerms)[];
	/**
	 * Whether a Bucket is Rolling (true) or Fresh-start (false) holds, once set for a month, for
	 * later months until set again. A Bucket with none set is Fresh-start.
	 */
	rolling: { bucketId: string; month: MonthKey; rolling: boolean }[];
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
	/** Set for a Personal Allowance: the Parent it belongs to. */
	owner?: string | null;
};

export type CommitmentRecord = {
	id: string;
	name: string;
	/** The first month the Commitment is part of the Plan. */
	fromMonth: MonthKey;
	/** The first month the Commitment is no longer part of the Plan, once ended. */
	endedFromMonth: MonthKey | null;
};

export type PlanBucket = {
	id: string;
	name: string;
	color: number;
	allowance: Cents;
	/** Rolling: what's left at the end of this month carries into the next. Else Fresh-start. */
	rolling: boolean;
	/**
	 * Set for a Personal Allowance: the Parent it belongs to. Only they see its Transactions and
	 * assign spending to it (see `canAssign`); it counts in the Plan like any Bucket.
	 */
	owner?: string;
};

export type PlanCommitment = { id: string; name: string } & CommitmentTerms;

/** One month's Plan. `baseline` is null until a Parent has set one. */
export type Plan = {
	month: MonthKey;
	baseline: Cents | null;
	commitments: PlanCommitment[];
	buckets: PlanBucket[];
};

/** The latest record at or before `month`. */
function effective<T extends { month: MonthKey }>(records: T[], month: MonthKey): T | undefined {
	let found: T | undefined;
	for (const record of records) {
		if (record.month <= month && (!found || record.month > found.month)) found = record;
	}
	return found;
}

const inPlan = (month: MonthKey, from: MonthKey, until: MonthKey | null) =>
	from <= month && (until === null || month < until);

/**
 * The Plan in force for `month`: its Baseline, its Commitments with their terms (in the order
 * they were added, as their IDs are ULIDs), and its Buckets in order with their allowances.
 */
export function planForMonth(records: PlanRecords, month: MonthKey): Plan {
	const commitments = records.commitments
		.filter((c) => inPlan(month, c.fromMonth, c.endedFromMonth))
		.sort((a, b) => (a.id < b.id ? -1 : 1))
		.flatMap(({ id, name }): PlanCommitment[] => {
			const terms = effective(
				records.commitmentTerms.filter((t) => t.commitmentId === id),
				month,
			);
			if (!terms) return [];
			const { amount, cadence, dueDate } = terms;
			return [{ id, name, amount, cadence, dueDate }];
		});
	const buckets = records.buckets
		.filter((b) => inPlan(month, b.fromMonth, b.archivedFromMonth))
		.sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))
		.map(({ id, name, color, owner }) => ({
			...(owner ? { owner } : {}),
			id,
			name,
			color,
			allowance:
				effective(
					records.allowances.filter((a) => a.bucketId === id),
					month,
				)?.amount ?? 0,
			rolling:
				effective(
					records.rolling.filter((r) => r.bucketId === id),
					month,
				)?.rolling ?? false,
		}));
	return {
		month,
		baseline: effective(records.baselines, month)?.amount ?? null,
		commitments,
		buckets,
	};
}

/**
 * Whether a Parent can assign spending to a Bucket: any Bucket but the other Parent's Personal
 * Allowance.
 */
export function canAssign(bucket: Pick<PlanBucket, "owner">, parentId: string): boolean {
	return bucket.owner === undefined || bucket.owner === parentId;
}

/** Everything the Plan assigns to Buckets this month. */
export function totalAllowances(plan: Pick<Plan, "buckets">): Cents {
	return plan.buckets.reduce((sum, b) => sum + b.allowance, 0);
}

/** Everything the Plan expects its Commitments to take this month. */
export function totalCommitments(plan: Pick<Plan, "month" | "commitments">): Cents {
	return plan.commitments.reduce((sum, c) => sum + expectedIn(c, plan.month), 0);
}

/**
 * Money in the Plan not yet assigned to anything: the Baseline less what the Commitments are
 * expected to take this month and every Bucket's allowance. Negative when the Plan assigns
 * more than the Baseline, which the app must always say out loud (never clamp to zero).
 */
export function freeToSpend(
	plan: Pick<Plan, "month" | "baseline" | "commitments" | "buckets">,
): Cents {
	return (plan.baseline ?? 0) - totalCommitments(plan) - totalAllowances(plan);
}
