// Pure money math for the Plan (no I/O). Scenario projection and Affordability entry points
// land here as their tickets arrive.
export {
	CADENCES,
	type Cadence,
	type CommitmentTerms,
	dueDatesIn,
	expectedIn,
} from "./commitments";
export { type CoverSource, coverSources, leftToMove } from "./cover";
export {
	type AttributedSpend,
	type For,
	type ForTotals,
	forTotals,
	noForTotals,
	type SpendTotal,
	shares,
} from "./for";
export { type BucketUse, likelyBucketOrder } from "./likely";
export { type Cents, MAX_CENTS, parseDollars } from "./money";
export {
	addMonths,
	type DayKey,
	dayKeyAt,
	daysBetween,
	daysInMonth,
	lastDayOf,
	type MonthKey,
	monthKeyAt,
	monthOfDay,
} from "./month";
export {
	type BucketState,
	type BucketStatus,
	type Charge,
	type CommitmentState,
	type CommitmentStatus,
	type MonthState,
	type Move,
	monthState,
	type Spend,
} from "./month-state";
export {
	type BucketRecord,
	type CommitmentRecord,
	freeToSpend,
	type Plan,
	type PlanBucket,
	type PlanCommitment,
	type PlanRecords,
	planForMonth,
	totalAllowances,
	totalCommitments,
} from "./plan";
