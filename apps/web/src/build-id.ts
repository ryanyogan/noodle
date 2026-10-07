import { devBuildIn } from "./app-update";

// Which build this is, on each side (issue 140). `__BUILD_ID__` is set once a build by
// vite.config.ts and is the same in the Worker and in the page's own script, so a page whose id
// differs from the server's was loaded before the last deploy.
//
// E2E can't deploy, so a build made with AI_MODEL=stub (never production's: dev-routes.test.ts)
// also takes the id from a cookie, `noodle-dev-build`, which only that test's browser carries:
// the server answers with it at once, and a page reads it when it loads, as if the shell it was
// served came from that build. Set HttpOnly, the page can't read it, and a refresh brings the
// same old page: the case of a cached shell.

/** The build the Worker answering this request is. */
export function serverBuild(request: Request): string {
	return (__AI_STUB__ && devBuildIn(request.headers.get("Cookie"))) || __BUILD_ID__;
}

/** GET /api/version: the Worker's build, never from a cache. */
export function handleVersion(request: Request): Response {
	return Response.json(
		{ build: serverBuild(request) },
		{ headers: { "Cache-Control": "no-store" } },
	);
}

let loaded: string | undefined;

/** The build this page was loaded with. Browser only; the same answer for as long as it lives. */
export function loadedBuild(): string {
	loaded ??= (__AI_STUB__ && devBuildIn(document.cookie)) || __BUILD_ID__;
	return loaded;
}
