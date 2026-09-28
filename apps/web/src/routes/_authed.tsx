import { createFileRoute, redirect } from "@tanstack/react-router";
import { viewerQuery } from "../queries";

// Everything under here requires a signed-in Parent.
export const Route = createFileRoute("/_authed")({
	beforeLoad: async ({ location, cause, context }) => {
		// Asked afresh on entering the authed app. While it stays open (moving between its pages,
		// or opening a sheet, which only changes the search) the cached answer is reused, so
		// those don't wait on a round trip. Server functions check the session on every call anyway.
		const viewer = await context.queryClient.fetchQuery({
			...viewerQuery(),
			staleTime: cause === "stay" ? Number.POSITIVE_INFINITY : 0,
		});
		// Clerk's <SignIn> returns to redirect_url once the Parent signs in.
		if (!viewer.signedIn)
			throw redirect({ href: `/sign-in?redirect_url=${encodeURIComponent(location.href)}` });
		return { household: viewer.household, invite: viewer.invite };
	},
});
