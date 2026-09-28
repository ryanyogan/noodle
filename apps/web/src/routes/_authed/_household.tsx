import { UserButton } from "@clerk/tanstack-react-start";
import { createFileRoute, Link, Outlet, redirect } from "@tanstack/react-router";

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
				<nav>
					<Link to="/month">This Month</Link> <Link to="/household">Household</Link>
				</nav>
				<UserButton />
			</header>
			<Outlet />
		</div>
	);
}
