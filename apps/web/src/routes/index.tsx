import { createFileRoute, redirect } from "@tanstack/react-router";
import { viewerQuery } from "../queries";

// `/` never renders a page. On the server, before anything is sent, it sends a Parent into the
// app, to create or join a Household, or to sign in. The installed app opens at /month (the
// manifest's start_url), which _authed checks the same way.
export const Route = createFileRoute("/")({
	beforeLoad: async ({ context }) => {
		const viewer = await context.queryClient.fetchQuery({ ...viewerQuery(), staleTime: 0 });
		if (!viewer.signedIn) throw redirect({ href: "/sign-in" });
		if (!viewer.household) throw redirect({ to: "/welcome" });
		throw redirect({ to: "/month" });
	},
});
