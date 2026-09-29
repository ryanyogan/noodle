import { createFileRoute, redirect } from "@tanstack/react-router";

// The Plan has its own area now; old links to a month's Plan land there.
export const Route = createFileRoute("/_authed/_household/month/$month/plan")({
	beforeLoad: ({ context }) => {
		throw redirect({ to: "/plan/$month", params: { month: context.month } });
	},
});
