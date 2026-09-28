import { monthKeyAt } from "@noodle/domain";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_household/month/")({
	// Runs on the Worker during SSR, so "today" must come from the Household's zone, not the clock's.
	beforeLoad: ({ context }) => {
		const month = monthKeyAt(new Date(), context.household.timeZone);
		throw redirect({ to: "/month/$month", params: { month } });
	},
});
