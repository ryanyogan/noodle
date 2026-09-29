import type { MonthKey } from "@noodle/domain";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { goalsQuery, monthQuery } from "../../../queries";
import { monthKeySchema } from "../../../server/month";

// A month of the Plan. Its pages (This Month, the Plan editor) share one cached query; This
// Month's Windfall suggestions read the Goals too.
export const Route = createFileRoute("/_authed/_household/month/$month")({
	beforeLoad: ({ params }) => {
		if (!monthKeySchema.safeParse(params.month).success) throw notFound();
		return { month: params.month as MonthKey };
	},
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(monthQuery(context.month)),
			context.queryClient.ensureQueryData(goalsQuery()),
		]),
});
