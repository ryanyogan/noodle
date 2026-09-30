import { createFileRoute, redirect } from "@tanstack/react-router";

// Account pages lived under Goals until Accounts got their own area; old links and Nudges still work.
export const Route = createFileRoute("/_authed/_household/goals/accounts/$accountId")({
	beforeLoad: ({ params }) => {
		throw redirect({ to: "/accounts/$accountId", params, replace: true });
	},
});
