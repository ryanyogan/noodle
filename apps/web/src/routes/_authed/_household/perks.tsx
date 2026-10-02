import { createFileRoute, redirect } from "@tanstack/react-router";

// Perks moved under Insights, as its second tab (#55, ADR-0023). Old links keep working.
export const Route = createFileRoute("/_authed/_household/perks")({
	beforeLoad: () => {
		throw redirect({ to: "/insights/perks", replace: true });
	},
});
