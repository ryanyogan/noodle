import { createFileRoute, redirect } from "@tanstack/react-router";
import { viewerQuery } from "../queries";

// Everything under here requires a signed-in Parent.
export const Route = createFileRoute("/_authed")({
	beforeLoad: async ({ location, cause, context }) => {
		// Asked afresh on entering the authed app. While it stays open (moving between its pages,
		// or opening a sheet, which only changes the search) the cached answer is reused, so
		// those don't wait on a round trip. Server functions check the session on every call anyway.
		// Preloading a link (hover, focus, touch) reuses it too: asking again there made the click
		// that follows wait for the answer before any of the page's loaders started (#55).
		const viewer = await context.queryClient.fetchQuery({
			...viewerQuery(),
			staleTime: cause === "enter" ? 0 : Number.POSITIVE_INFINITY,
		});
		// Clerk's <SignIn> returns to redirect_url once the Parent signs in.
		if (!viewer.signedIn)
			throw redirect({ href: `/sign-in?redirect_url=${encodeURIComponent(location.href)}` });
		return {
			household: viewer.household,
			invite: viewer.invite,
			parentId: viewer.household ? viewer.parentId : null,
		};
	},
});
