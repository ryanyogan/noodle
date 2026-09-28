import { queryOptions } from "@tanstack/react-query";
import { getThisMonth } from "./server/month";

export const thisMonthQuery = (month: string) =>
	queryOptions({
		queryKey: ["month", month],
		queryFn: () => getThisMonth({ data: { month } }),
	});
