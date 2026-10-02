import { monthKeyAt } from "@noodle/domain";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

// The year used to be a page of its own; it's now a tab of a month's Plan (/plan/$month/year).
// Old links land on the year's tab: this month for this year, January for any other.
export const Route = createFileRoute("/_authed/_household/plan/year/$year")({
	beforeLoad: ({ params, context }) => {
		if (!/^\d{4}$/.test(params.year)) throw notFound();
		// Runs on the Worker during SSR, so "today" comes from the Household's zone.
		const current = monthKeyAt(new Date(), context.household.timeZone);
		const month = params.year === current.slice(0, 4) ? current : `${params.year}-01`;
		throw redirect({ to: "/plan/$month/year", params: { month }, search: true, replace: true });
	},
});
