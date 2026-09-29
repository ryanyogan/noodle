import { type MonthKey, type MonthState, monthState } from "@noodle/domain";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getBucket } from "./server/buckets";
import { getCaptureToken } from "./server/capture-tokens";
import { getCheckIn } from "./server/check-in";
import { getCommitments } from "./server/commitments";
import { getGoals } from "./server/goals";
import { getAccountImports } from "./server/imports";
import { getInsights } from "./server/insights";
import { getHouseholdParents } from "./server/invites";
import { getForTotalsEarlierInYear, getMembers } from "./server/members";
import { getMonth, type MonthData } from "./server/month";
import { getNudgeSettings } from "./server/nudges";
import { getPlanHistory } from "./server/plan";
import { getReport, type ReportRequest } from "./server/reports";
import { getReview, getRules } from "./server/review";
import { getPlanAhead, getScenarios } from "./server/scenarios";
import { getViewer } from "./server/session";
import { getBucketUses } from "./server/transactions";
import { getPlanHealth, getYear } from "./server/year";

/** Who is signed in and their Household; read by the route guards. */
export const viewerQuery = () =>
	queryOptions({
		queryKey: ["viewer"],
		queryFn: () => getViewer(),
	});

/** Every month's data; a Plan change can affect later months too. */
export const monthsKey = ["month"] as const;

export const monthQuery = (month: MonthKey) =>
	queryOptions({
		queryKey: [...monthsKey, month],
		queryFn: () => getMonth({ data: { month } }),
	});

const toMonthState = (
	data: MonthData,
): MonthState & Pick<MonthData, "editable" | "moves" | "goalFunding" | "income" | "closed"> => ({
	...monthState(data),
	editable: data.editable,
	moves: data.moves,
	goalFunding: data.goalFunding,
	income: data.income,
	closed: data.closed,
});

/** A month's state, derived from its cached inputs, so optimistic edits show up everywhere. */
export const useMonthState = (month: MonthKey) =>
	useSuspenseQuery({ ...monthQuery(month), select: toMonthState }).data;

/** Recent spending's Buckets, for ordering Quick Add's Buckets by likelihood. */
export const bucketUsesQuery = () =>
	queryOptions({
		queryKey: ["bucket-uses"],
		queryFn: () => getBucketUses(),
	});

export const householdParentsQuery = () =>
	queryOptions({
		queryKey: ["household", "parents"],
		queryFn: () => getHouseholdParents(),
	});

/** Every Member, Parents and Children, for For pickers and labels. */
export const membersQuery = () =>
	queryOptions({
		queryKey: ["household", "members"],
		queryFn: () => getMembers(),
	});

/** What was spent For each Member in every month's year before it; only edits to past spending change it. */
export const forTotalsEarlierKey = ["for-earlier"] as const;

/** What was spent For each Member earlier in `month`'s year. */
export const forTotalsEarlierQuery = (month: MonthKey) =>
	queryOptions({
		queryKey: [...forTotalsEarlierKey, month],
		queryFn: () => getForTotalsEarlierInYear({ data: { month } }),
	});

/**
 * The Plan's records as far ahead as a Scenario projects. Under every month's key, since any
 * Plan change can change them.
 */
export const planAheadQuery = () =>
	queryOptions({
		queryKey: [...monthsKey, "ahead"],
		queryFn: () => getPlanAhead(),
	});

/**
 * The Plan changes that take effect in `month` or, with `targetId`, every one to that Bucket or
 * Commitment. Under the month's key, so whatever refetches the month refetches them too.
 */
export const planHistoryQuery = (month: MonthKey, targetId?: string) =>
	queryOptions({
		queryKey: [...monthsKey, month, "plan-history", targetId ?? null],
		queryFn: () => getPlanHistory({ data: targetId === undefined ? { month } : { targetId } }),
	});

/**
 * Every Commitment with its terms over time and the charges against them: Coming up, lumpy months,
 * and each Commitment's page. Under every month's key, as any Plan change or payment can change it.
 */
export const commitmentsQuery = () =>
	queryOptions({
		queryKey: [...monthsKey, "commitments"],
		queryFn: () => getCommitments(),
	});

/**
 * Every Bucket's page data. Under every month's key, as any Plan change can change it; a change
 * to any one month's spending refetches it too (see household-changes).
 */
export const bucketPagesKey = [...monthsKey, "buckets"] as const;

/** A Bucket over the last year, month by month, for its page. */
export const bucketQuery = (bucketId: string) =>
	queryOptions({
		queryKey: [...bucketPagesKey, bucketId],
		queryFn: () => getBucket({ data: { bucketId } }),
	});

/**
 * What the year view and Plan health read: the Plan, every month's spending and income, and the
 * Goals. Under every month's key, as any Plan change can change them; a change to any one month's
 * spending, or to the Goals, refetches them too (see household-changes).
 */
export const planOutlookKey = [...monthsKey, "outlook"] as const;

/** A year of the Plan month by month, with what actually happened in months under way or over. */
export const yearQuery = (year: number) =>
	queryOptions({
		queryKey: [...planOutlookKey, "year", year],
		queryFn: () => getYear({ data: { year } }),
	});

/** Plan health: what in the Plan needs attention now. */
export const planHealthQuery = () =>
	queryOptions({
		queryKey: [...planOutlookKey, "health"],
		queryFn: () => getPlanHealth(),
	});

/**
 * What waits in Review. Under every month's key, since any change to spending (an Import, an
 * edit, the other Parent clearing a card) can change it.
 */
export const reviewQuery = () =>
	queryOptions({
		queryKey: [...monthsKey, "review"],
		queryFn: () => getReview(),
	});

/**
 * This week's Check-in: its cards and who has finished it. Under every month's key, since
 * spending, income and the Plan change what waits; always refetched on opening it, since
 * deciding an Insight elsewhere changes it too.
 */
export const checkInQuery = () =>
	queryOptions({
		queryKey: [...monthsKey, "check-in"],
		queryFn: () => getCheckIn(),
		staleTime: 0,
	});

/** The Insights the Parent may read that weren't dismissed, new ones first. */
export const insightsQuery = () =>
	queryOptions({
		queryKey: ["insights"],
		queryFn: () => getInsights(),
	});

/** The Rules this Parent may see. */
export const rulesQuery = () =>
	queryOptions({
		queryKey: ["rules"],
		queryFn: () => getRules(),
	});

/** The Household's Scenarios, most recently changed first. */
export const scenariosQuery = () =>
	queryOptions({
		queryKey: ["scenarios"],
		queryFn: () => getScenarios(),
	});

/** Every Account, Goal and Earmark change, with the Household's current month. */
export const goalsQuery = () =>
	queryOptions({
		queryKey: ["goals"],
		queryFn: () => getGoals(),
	});

/** An Account's Imports and the CSV mapping it remembers. */
export const accountImportsQuery = (accountId: string) =>
	queryOptions({
		queryKey: ["imports", accountId],
		queryFn: () => getAccountImports({ data: { accountId } }),
	});

/** The viewer's own Nudge preferences, and the key a device subscribes with. Never shared. */
export const nudgeSettingsQuery = () =>
	queryOptions({
		queryKey: ["nudges"],
		queryFn: () => getNudgeSettings(),
	});

/** Every Report, whichever view, period and drill-down. */
export const reportsKey = ["reports"] as const;

/** One Report: a view, its options and how far it's drilled into. */
export const reportQuery = (request: ReportRequest) =>
	queryOptions({
		queryKey: [...reportsKey, request],
		queryFn: () => getReport({ data: request }),
	});

/** When the viewer's own capture token for the iPhone Shortcut was made; null without one. */
export const captureTokenQuery = () =>
	queryOptions({
		queryKey: ["capture-token"],
		queryFn: () => getCaptureToken(),
	});
