import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "../../components/app-shell";

// The authenticated app layout: requires the Parent to belong to a Household.
export const Route = createFileRoute("/_authed/_household")({
	beforeLoad: ({ context }) => {
		if (!context.household) throw redirect({ to: "/welcome" });
		return { household: context.household };
	},
	component: AppLayout,
});

function AppLayout() {
	const { household } = Route.useRouteContext();
	return (
		<AppShell householdName={household.name}>
			<Outlet />
		</AppShell>
	);
}
