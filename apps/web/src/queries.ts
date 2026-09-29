import { type MonthKey, type MonthState, monthState } from "@noodle/domain";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getGoals } from "./server/goals";
import { getHouseholdParents } from "./server/invites";
import { getForTotalsEarlierInYear, getMembers } from "./server/members";
import { getMonth, type MonthData } from "./server/month";
import { getNudgeSettings } from "./server/nudges";
import { getPlanAhead, getScenarios } from "./server/scenarios";
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

/** The viewer's own Nudge preferences, and the key a device subscribes with. Never shared. */
export const nudgeSettingsQuery = () =>
	queryOptions({
		queryKey: ["nudges"],
		queryFn: () => getNudgeSettings(),
	});
