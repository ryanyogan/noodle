import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { savingFetch } from "./keep-saving";

// Server functions ride on the Clerk session cookie, so reject cross-site calls to them.
const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
	requestMiddleware: [csrfMiddleware, clerkMiddleware()],
	// A change on its way to the server is not dropped when the page is left (see keep-saving.ts).
	serverFns: { fetch: savingFetch },
}));
