import type { MonthKey } from "@noodle/domain";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { monthQuery } from "../../../queries";
import { monthKeySchema } from "../../../server/month";

// A month's Plan: its overview and the pages for each part of it, all reading the month's one
// cached query (shared with This Month), so a change shows everywhere at once.
export const Route = createFileRoute("/_authed/_household/plan/$month")({
	beforeLoad: ({ params }) => {
		if (!monthKeySchema.safeParse(params.month).success) throw notFound();
		return { month: params.month as MonthKey };
	},
	loader: ({ context }) => context.queryClient.ensureQueryData(monthQuery(context.month)),
});
