import { queryOptions } from "@tanstack/react-query";
import { getHouseholdParents } from "./server/invites";
import { getThisMonth } from "./server/month";

export const thisMonthQuery = (month: string) =>
	queryOptions({
		queryKey: ["month", month],
		queryFn: () => getThisMonth({ data: { month } }),
	});

export const householdParentsQuery = () =>
	queryOptions({
		queryKey: ["household", "parents"],
		queryFn: () => getHouseholdParents(),
	});
