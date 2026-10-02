import { type MonthKey, monthKeyAt } from "@noodle/domain";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { monthKeySchema } from "../../../server/month";

// Where a Commitment's page used to live. It is now beside its list in a month's Plan (#67): this
// month's, or the month the old address named with ?month=.
export const Route = createFileRoute("/_authed/_household/plan/commitments/$id")({
	beforeLoad: ({ context, params, location }) => {
		const asked = monthKeySchema.safeParse((location.search as { month?: unknown }).month);
		const month = asked.success
			? (asked.data as MonthKey)
			: monthKeyAt(new Date(), context.household.timeZone);
		throw redirect({
			to: "/plan/$month/commitments/$id",
			params: { month, id: params.id },
			replace: true,
		});
	},
});
