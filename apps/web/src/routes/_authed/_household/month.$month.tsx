import { addMonths, type MonthKey } from "@noodle/domain";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { closingWeek } from "../../../month-close";
import { goalsQuery, monthQuery, reviewQuery } from "../../../queries";
import { monthKeySchema } from "../../../server/month";

// A month of the Plan. Its pages (This Month, the Plan editor) share one cached query; This
// Month's Windfall suggestions read the Goals too, and in its first week it asks to close the
// month before.
export const Route = createFileRoute("/_authed/_household/month/$month")({
	beforeLoad: ({ params }) => {
		if (!monthKeySchema.safeParse(params.month).success) throw notFound();
		return { month: params.month as MonthKey };
	},
	loader: async ({ context }) => {
		const [data] = await Promise.all([
			context.queryClient.ensureQueryData(monthQuery(context.month)),
			context.queryClient.ensureQueryData(goalsQuery()),
			// This Month says how many wait in Review.
			context.queryClient.ensureQueryData(reviewQuery()),
		]);
		if (closingWeek(context.month, data.asOf)) {
			await context.queryClient.ensureQueryData(monthQuery(addMonths(context.month, -1)));
		}
	},
});
