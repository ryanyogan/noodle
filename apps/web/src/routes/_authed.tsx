import { createFileRoute, redirect } from "@tanstack/react-router";
import { getViewer } from "../server/session";

// Everything under here requires a signed-in Parent.
export const Route = createFileRoute("/_authed")({
	beforeLoad: async ({ location }) => {
		const viewer = await getViewer();
		// Clerk's <SignIn> returns to redirect_url once the Parent signs in.
		if (!viewer.signedIn)
			throw redirect({ href: `/sign-in?redirect_url=${encodeURIComponent(location.href)}` });
		return { household: viewer.household, invite: viewer.invite };
	},
});
