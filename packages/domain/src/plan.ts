import { byNextDue, type CommitmentTerms, expectedIn } from "./commitments";
import type { Cents } from "./money";
import type { MonthKey } from "./month";

/**
 * The Plan is stored as effective-dated records: take-home pay or allowance set for a month
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
	 * Whether a Bucket carries over (true) or resets monthly (false) holds, once set for a month, for
	 * later months until set again. A Bucket with none set is resets monthly.
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
	/** The group a Parent put it in (issue 98); null or absent for none. */
	group?: string | null;
};

export type CommitmentRecord = {
	id: string;
	name: string;
	/** The first month the Commitment is part of the Plan. */
	fromMonth: MonthKey;
	/** The first month the Commitment is no longer part of the Plan, once ended. */
	endedFromMonth: MonthKey | null;
	/** The credit card or loan its payments pay down (ADR-0050); null or absent for none. */
	accountId?: string | null;
	/** A Parent said it's a set payment on a balance they're carrying. */
	carriedBalance?: boolean;
};

export type PlanBucket = {
	id: string;
	name: string;
	color: number;
	allowance: Cents;
	/** carries over: what's left at the end of this month carries into the next. Else resets monthly. */
	rolling: boolean;
	/**
	 * Set for a Personal Allowance: the Parent it belongs to. Only they see its Transactions and
	 * assign spending to it (see `canAssign`); it counts in the Plan like any Bucket.
	 */
	owner?: string;
	/** The group it is listed under in the Plan (issue 98); absent for none. Changes no figure. */
	group?: string;
};

export type PlanCommitment = {
	id: string;
	name: string;
	/** The credit card or loan it pays down (ADR-0050); absent when it pays down none. */
	accountId?: string;
	/** Set with `accountId`: a set payment on a balance the Household is carrying. */
	carriedBalance?: boolean;
} & CommitmentTerms;

/** One month's Plan. `baseline` is null until a Parent has set one. */
export type Plan = {
	month: MonthKey;
	baseline: Cents | null;
	commitments: PlanCommitment[];
	buckets: PlanBucket[];
};

/** The latest record at or before `month`. */
export function effective<T extends { month: MonthKey }>(
	records: T[],
	month: MonthKey,
): T | undefined {
	let found: T | undefined;
	for (const record of records) {
		if (record.month <= month && (!found || record.month > found.month)) found = record;
	}
	return found;
}

const inPlan = (month: MonthKey, from: MonthKey, until: MonthKey | null) =>
	from <= month && (until === null || month < until);

/**
 * The Commitments in the Plan for `month`, with the terms in force then, in the order they're
 * next due from the month's first day (see byNextDue).
 */
export function commitmentsIn(
	records: Pick<PlanRecords, "commitments" | "commitmentTerms">,
	month: MonthKey,
): PlanCommitment[] {
	const commitments = records.commitments
		.filter((c) => inPlan(month, c.fromMonth, c.endedFromMonth))
		.flatMap(({ id, name, accountId, carriedBalance }): PlanCommitment[] => {
			const terms = effective(
				records.commitmentTerms.filter((t) => t.commitmentId === id),
				month,
			);
			if (!terms) return [];
			const { amount, cadence, dueDate } = terms;
			const paysDown = accountId ? { accountId, carriedBalance: carriedBalance ?? false } : {};
			return [{ id, name, amount, cadence, dueDate, ...paysDown }];
		});
	return byNextDue(commitments, `${month}-01`);
}

/**
 * The first month the Household had a Plan, or `current` if it's earlier (or nothing is planned
 * yet): earlier months are before the Household planned anything, so there's nothing to go back
 * to. `records` need only reach `current`.
 */
export function firstPlanMonth(records: PlanRecords, current: MonthKey): MonthKey {
	const months = [
		...records.baselines.map((b) => b.month),
		...records.buckets.map((b) => b.fromMonth),
		...records.commitments.map((c) => c.fromMonth),
	];
	return months.reduce((first, month) => (month < first ? month : first), current);
}

/**
 * The Plan in force for `month`: its take-home pay, its Commitments with their terms (in the order
 * they're next due), and its Buckets in order with their allowances.
 */
export function planForMonth(records: PlanRecords, month: MonthKey): Plan {
	const commitments = commitmentsIn(records, month);
	const buckets = records.buckets
		.filter((b) => inPlan(month, b.fromMonth, b.archivedFromMonth))
		.sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))
		.map(({ id, name, color, owner, group }) => ({
			...(owner ? { owner } : {}),
			...(group && !owner ? { group } : {}),
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
 * Money in the Plan not yet assigned to anything: take-home pay less what the Commitments are
 * expected to take this month and every Bucket's allowance. Negative when the Plan assigns
 * more than take-home pay, which the app must always say out loud (never clamp to zero).
 */
export function freeToSpend(
	plan: Pick<Plan, "month" | "baseline" | "commitments" | "buckets">,
): Cents {
	return (plan.baseline ?? 0) - totalCommitments(plan) - totalAllowances(plan);
}
