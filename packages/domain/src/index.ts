// Pure money math for the Plan (no I/O). Affordability entry points land here as their ticket
// arrives.
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
export {
	ACCOUNT_KINDS,
	type AccountKind,
	type AccountWithdrawal,
	accountBalance,
	attributeWithdrawal,
	type BalanceUpdate,
	type EarmarkChange,
	earmarkOf,
	type GoalProgress,
	type GoalStatus,
	goalProgress,
	holdsMoney,
	splitAccount,
	type WithdrawalAttribution,
} from "./goals";
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
	monthsBetween,
} from "./month";
export {
	defaultDecision,
	fitsProposal,
	type Leftover,
	type MonthCloseDecision,
	type MonthCloseProposal,
	monthCloseProposal,
	nothingToClose,
} from "./month-close";
export {
	type BucketState,
	type BucketStatus,
	type Charge,
	type CommitmentState,
	type CommitmentStatus,
	type GoalFunding,
	type MonthState,
	type Move,
	monthState,
	type Spend,
	type Sweep,
} from "./month-state";
export {
	bucketsPassingPace,
	defaultNudgePreferences,
	isQuietAt,
	minuteOfDayAt,
	type NudgeKind,
	type NudgePreferences,
	nextLocalMinute,
	nudgeDeliveryTime,
	PACE_NUDGE_MIN_DAYS_LEFT,
	type QuietHours,
	wantsNudge,
} from "./nudges";
export {
	type BucketRecord,
	type CommitmentRecord,
	canAssign,
	freeToSpend,
	type Plan,
	type PlanBucket,
	type PlanCommitment,
	type PlanRecords,
	planForMonth,
	totalAllowances,
	totalCommitments,
} from "./plan";
export { type MonthlySpend, rolledOver, rolloverSince } from "./rollover";
export {
	type Lever,
	MAX_PROJECTION_MONTHS,
	moneyFreed,
	type PlanAhead,
	type ProjectedGoal,
	type ProjectedMonth,
	type Projection,
	type ProjectionGoal,
	planAhead,
	project,
} from "./scenario";
export {
	type AssignedTransaction,
	type Assignment,
	assignedParts,
	type GoalSpend,
	type Split,
	type SplitAssignment,
	splitRemainder,
	splitsBalance,
} from "./splits";
export {
	INCOME_WARNING_FROM_DAY,
	type Income,
	type IncomeCheck,
	incomeCheck,
	receivedIn,
	type WindfallDestination,
	type WindfallSuggestion,
	windfallOf,
	windfallSuggestions,
} from "./windfall";
