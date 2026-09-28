import { type MonthKey, type MonthState, monthState } from "@noodle/domain";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getHouseholdParents } from "./server/invites";
import { getForTotalsEarlierInYear, getMembers } from "./server/members";
import { getMonth, type MonthData } from "./server/month";
import { getViewer } from "./server/session";
import { getBucketUses } from "./server/transactions";

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

const toMonthState = (data: MonthData): MonthState & { editable: boolean } => ({
	...monthState(data),
	editable: data.editable,
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
