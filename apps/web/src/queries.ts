import { type MonthKey, type MonthState, monthState } from "@noodle/domain";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getBankConnections } from "./server/bank-connections";
import { getBucket } from "./server/buckets";
import { getCaptureToken } from "./server/capture-tokens";
import { getCheckIn, getCheckInStatus } from "./server/check-in";
import { getCommitments, getFollowedCards, getPaymentSuggestion } from "./server/commitments";
import { getExportStatus } from "./server/export";
import { getFreshStartCounts, getFreshStartStatus } from "./server/fresh-start";
import { getGoals } from "./server/goals";
import { getAccountImports } from "./server/imports";
import { getInsights } from "./server/insights";
import { getHouseholdParents } from "./server/invites";
import { getForTotalsEarlierInYear, getMembers } from "./server/members";
import { getMonth, type MonthData } from "./server/month";
import { getNudgeSettings } from "./server/nudges";
import { getPerkSources } from "./server/perks";
import {
	getAllowanceOwners,
	getBucketDeleteBlockers,
	getEditedAllowances,
	getPlanHistory,
} from "./server/plan";
import { getPlanDraft } from "./server/plan-draft";
import { getReceiptAddress } from "./server/receipts";
import { getReport, type ReportRequest } from "./server/reports";
import { getReview, getRules } from "./server/review";
import { getPlanAhead, getScenarios } from "./server/scenarios";
import { getViewer } from "./server/session";
import { getSetup } from "./server/setup";
import { getSuggestions } from "./server/suggestions";
import { getBucketUses, getQuickAddRules } from "./server/transactions";
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
): MonthState &
	Pick<
		MonthData,
		"editable" | "moves" | "goalFunding" | "sweeps" | "income" | "closed" | "firstMonth"
	> => ({
	...monthState(data),
	editable: data.editable,
	firstMonth: data.firstMonth,
	moves: data.moves,
	goalFunding: data.goalFunding,
	sweeps: data.sweeps,
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

/** The Rules into Buckets this Parent may see, so Quick Add's note can steer its Buckets. */
export const quickAddRulesQuery = () =>
	queryOptions({
		queryKey: ["rules", "quick-add"],
		queryFn: () => getQuickAddRules(),
	});

export const householdParentsQuery = () =>
	queryOptions({
		queryKey: ["household", "parents"],
		queryFn: () => getHouseholdParents(),
	});

/** The Parents who have a Personal Allowance; whether one exists is all that's shared (ADR-0003). */
export const allowanceOwnersQuery = () =>
	queryOptions({
		queryKey: [...monthsKey, "allowance-owners"],
		queryFn: () => getAllowanceOwners(),
	});

/** The Buckets whose allowance a Parent has changed by hand (#72); a Plan change refreshes it. */
export const editedAllowancesQuery = () =>
	queryOptions({
		queryKey: [...monthsKey, "edited-allowances"],
		queryFn: () => getEditedAllowances(),
	});

/**
 * First names of the other Parents with no Personal Allowance yet, for Left to plan's
 * "still to set" note. There's no placeholder: each Parent sets their own (#72).
 */
export function useAllowancesStillToSet(parentId: string): string[] {
	const owners = useQuery(allowanceOwnersQuery()).data;
	const parents = useQuery(householdParentsQuery()).data?.parents;
	if (!owners || !parents) return [];
	return parents
		.filter((parent) => parent.id !== parentId && !owners.includes(parent.id))
		.map((parent) => parent.name.split(/\s+/)[0] ?? parent.name);
}

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
 * What stops a Bucket being deleted (issue 98). Under every month's key: filing a Transaction or
 * a Cover changes the answer.
 */
export const bucketDeleteBlockersQuery = (bucketId: string) =>
	queryOptions({
		queryKey: [...monthsKey, "bucket-delete-blockers", bucketId],
		queryFn: () => getBucketDeleteBlockers({ data: { bucketId } }),
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

/**
 * Whether this Parent has done this week's Check-in (the sidebar's badge, This Month's card).
 * Under the Check-in's key, so whatever refetches the Check-in refetches this too.
 */
export const checkInStatusQuery = () =>
	queryOptions({
		queryKey: [...monthsKey, "check-in", "status"],
		queryFn: () => getCheckInStatus(),
	});

/**
 * What's left of the first Plan's draft, or null. Under every month's key: adding to the Plan by
 * hand also takes a suggestion out of it.
 */
export const planDraftQuery = () =>
	queryOptions({
		queryKey: [...monthsKey, "plan-draft"],
		queryFn: () => getPlanDraft(),
	});

/** The Insights the Parent may read that weren't dismissed, new ones first. */
export const insightsQuery = () =>
	queryOptions({
		queryKey: ["insights"],
		queryFn: () => getInsights(),
	});

/** The Household's Bank Connections with their Accounts, and whether one can be connected. */
export const bankConnectionsQuery = () =>
	queryOptions({
		queryKey: ["bank-connections"],
		queryFn: () => getBankConnections(),
	});

/** The Perk Sources the Parent may read that weren't dismissed, suggestions first, with their Perks. */
export const perkSourcesQuery = () =>
	queryOptions({
		queryKey: ["perks"],
		queryFn: () => getPerkSources(),
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

/** Every Account, Goal and set-aside money change, with the Household's current month. */
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

/** The Household's Receipt address, for forwarding Receipts; null until a Parent makes one. */
export const receiptAddressQuery = () =>
	queryOptions({
		queryKey: ["receipt-address"],
		queryFn: () => getReceiptAddress(),
	});

/** The Parent's "Download your data" ZIP: none, preparing, or ready until it expires. */
/** A fresh start or Delete Household scheduled or running (#63). */
export const freshStartQuery = () =>
	queryOptions({
		queryKey: ["fresh-start"],
		queryFn: () => getFreshStartStatus(),
	});

/** What a fresh start would clear, with counts, for the Danger zone's first sheet. */
export const freshStartCountsQuery = () =>
	queryOptions({
		queryKey: ["fresh-start", "counts"],
		queryFn: () => getFreshStartCounts(),
		staleTime: 0,
	});

export const exportStatusQuery = () =>
	queryOptions({
		queryKey: ["export"],
		queryFn: () => getExportStatus(),
	});

/** Where the Household is in the get-started wizard, and its background jobs. */
export const setupQuery = () =>
	queryOptions({
		queryKey: ["setup"],
		queryFn: () => getSetup(),
	});

/** The open Suggestions this Parent may read (ADR-0027). */
export const suggestionsQuery = () =>
	queryOptions({
		queryKey: ["suggestions"],
		queryFn: () => getSuggestions(),
	});

/**
 * The credit cards Noodle follows, for the "Pays down" choice on a Commitment. Under the Goals
 * key: a statement or a Bank Connection that changes an Account changes this too.
 */
/**
 * What a Commitment paying down this card or loan might be set at, from its last three months of
 * payments. Under the Goals key, like the cards Noodle follows.
 */
export const paymentSuggestionQuery = (accountId: string) =>
	queryOptions({
		queryKey: ["goals", "payment-suggestion", accountId],
		queryFn: () => getPaymentSuggestion({ data: { accountId } }),
	});

export const followedCardsQuery = () =>
	queryOptions({
		queryKey: ["goals", "followed-cards"],
		queryFn: () => getFollowedCards(),
	});
