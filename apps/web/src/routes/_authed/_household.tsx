import { UserButton } from "@clerk/tanstack-react-start";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

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
		<div>
			<header>
				<span>{household.name}</span>
				<UserButton />
			</header>
			<Outlet />
		</div>
	);
}
