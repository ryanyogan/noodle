import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { PageError, PageNotFound, PagePending } from "./components/route-states";
import { routeTree } from "./routeTree.gen";

// A new QueryClient per request (ADR-0006): loaders prefetch into it, components read from it.
export function getRouter() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { staleTime: 30_000 } },
	});
	const router = createRouter({
		routeTree,
		context: { queryClient },
		defaultPreload: "intent",
		// Query owns freshness; the router always asks it.
		defaultPreloadStaleTime: 0,
		scrollRestoration: true,
		// A skeleton appears only if loading takes longer than this, then stays long enough not to flash.
		defaultPendingComponent: PagePending,
		defaultPendingMs: 400,
		defaultPendingMinMs: 300,
		defaultErrorComponent: PageError,
		defaultNotFoundComponent: PageNotFound,
	});
	setupRouterSsrQueryIntegration({ router, queryClient });
	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
