import { env } from "cloudflare:workers";
import { rangedResponse } from "./byte-range";

// The intro video's files (#54) are static, in public/intro/. Workers static assets answer every
// request with the whole file and no Accept-Ranges, even one that asks for a few bytes, and
// Safari on iPhone and Mac won't play a <video> served that way. So wrangler.jsonc sends /intro/*
// to the Worker first (assets.run_worker_first), and the Worker answers the films' byte ranges
// itself from the same static file. Signed in or not: this runs before the app and its sign-in.

/** Everything under here comes to the Worker before static assets (wrangler.jsonc). */
export const INTRO_PATH = "/intro/";

/** Addresses carry `?v=<render>` (intro-video-files.ts), so a browser may keep a film a year. */
const KEEP_A_YEAR = "public, max-age=31536000, immutable";

/**
 * Answers a request under /intro/. The films (.mp4) get byte ranges; the posters and captions go
 * straight to static assets, untouched. Anything that isn't a file there goes on to the app
 * (`otherwise`), as it did before.
 */
export async function handleIntroFile(
	request: Request,
	otherwise: () => Response | Promise<Response>,
): Promise<Response> {
	const url = new URL(request.url);
	const film =
		url.pathname.endsWith(".mp4") && (request.method === "GET" || request.method === "HEAD");
	if (!film) {
		const response = await env.ASSETS.fetch(request);
		return response.status === 404 ? otherwise() : response;
	}

	// Always the whole file, by GET: static assets ignore Range, and a HEAD has no length to read.
	// If-None-Match stays, so a browser that already has the film still gets its 304.
	const headers = new Headers(request.headers);
	headers.delete("Range");
	headers.delete("If-Range");
	const file = await env.ASSETS.fetch(new Request(request.url, { method: "GET", headers }));
	if (file.status === 404) return otherwise();
	// A 304, or anything else that isn't the plain file, is static assets' own answer.
	if (file.status !== 200 || file.headers.has("Content-Encoding")) return file;

	const fileHeaders = new Headers(file.headers);
	fileHeaders.set("Content-Type", "video/mp4");
	if (url.searchParams.has("v")) fileHeaders.set("Cache-Control", KEEP_A_YEAR);

	// A plain GET streams through; only its headers change.
	if (request.method === "GET" && !request.headers.has("Range")) {
		fileHeaders.set("Accept-Ranges", "bytes");
		return new Response(file.body, { status: 200, headers: fileHeaders });
	}
	// A range (or HEAD) needs the file's size, which static assets don't promise in a header, so
	// the film (about 11 MB) is read whole and cut here.
	return rangedResponse(request, await file.arrayBuffer(), fileHeaders);
}
