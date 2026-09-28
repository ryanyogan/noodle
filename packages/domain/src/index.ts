// Pure money math for the Plan (no I/O). Scenario projection and Affordability entry points
// land here as their tickets arrive.
export { type BucketUse, likelyBucketOrder } from "./likely";
export { type Cents, MAX_CENTS, parseDollars } from "./money";
export {
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
	type MonthState,
	monthState,
	type Spend,
} from "./month-state";
export {
	type BucketRecord,
	freeToSpend,
	type Plan,
	type PlanBucket,
	type PlanRecords,
	planForMonth,
	totalAllowances,
} from "./plan";
