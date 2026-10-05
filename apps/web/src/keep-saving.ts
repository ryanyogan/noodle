/**
 * Keeps a change that is on its way to the server going when the Parent leaves the page.
 *
 * A change shows on screen at once, before the server has it (ADR-0006). A browser drops a page's
 * unfinished requests when the page is reloaded, closed or left for another whole page, so a
 * Parent who changed something and left within the next moment lost it without a word: the figure
 * they saw was never saved. Marked `keepalive`, the request is finished by the browser anyway.
 *
 * Only what changes something (a POST) is kept, and only a small one: browsers allow 64 KB of
 * kept requests at a time and refuse the one that goes over, so an upload is sent the usual way.
 */

/**
 * The longest request text that is kept going. Eight at once still fit the browsers' limit (the
 * text is JSON, a byte a letter but for names and notes).
 */
export const KEPT_UP_TO = 8_000;

/** True for a request that should be finished even if the page that sent it is gone. */
export function outlivesPage(init: RequestInit | undefined): boolean {
	if (init?.method !== "POST") return false;
	if (init.body === undefined || init.body === null) return true;
	return typeof init.body === "string" && init.body.length <= KEPT_UP_TO;
}

/** `fetch` for server functions (see start.ts). */
export const savingFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
	fetch(input, outlivesPage(init) ? { ...init, keepalive: true } : init);
