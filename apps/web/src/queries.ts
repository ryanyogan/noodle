import { type MonthKey, type MonthState, monthState } from "@noodle/domain";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getHouseholdParents } from "./server/invites";
import { getMonth, type MonthData } from "./server/month";

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

export const householdParentsQuery = () =>
	queryOptions({
		queryKey: ["household", "parents"],
		queryFn: () => getHouseholdParents(),
	});
