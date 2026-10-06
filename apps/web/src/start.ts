import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";
import { isDocsPath } from "./docs-path";
import { savingFetch } from "./keep-saving";

// Server functions ride on the Clerk session cookie, so reject cross-site calls to them.
const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === "serverFn",
});

const clerk = clerkMiddleware();

// The Docs' own pages (issue 126) are public and built ahead of time, the same HTML for everyone,
// with no Clerk keys at hand: a request for exactly one of them (docs-path.ts decides, and says no
// to everything it doesn't recognise) goes on without Clerk. Every other request, and so every
// page and server function of the app, goes through Clerk as before.
const clerkExceptDocs = createMiddleware().server((ctx) =>
	isDocsPath(new URL(ctx.request.url).pathname)
		? ctx.next()
		: (clerk.options.server as unknown as (c: typeof ctx) => ReturnType<typeof ctx.next>)(ctx),
) as unknown as typeof clerk;

export const startInstance = createStart(() => ({
	requestMiddleware: [csrfMiddleware, clerkExceptDocs],
	// A change on its way to the server is not dropped when the page is left (see keep-saving.ts).
	serverFns: { fetch: savingFetch },
}));
