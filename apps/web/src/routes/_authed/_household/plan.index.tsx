import { monthKeyAt } from "@noodle/domain";
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/_household/plan/")({
	// Runs on the Worker during SSR, so "today" must come from the Household's zone, not the clock's.
	beforeLoad: ({ context }) => {
		const month = monthKeyAt(new Date(), context.household.timeZone);
		// Keeps the search, so a link to /plan?sheet=quick-add still opens Quick Add.
		throw redirect({ to: "/plan/$month", params: { month }, search: true });
	},
});
