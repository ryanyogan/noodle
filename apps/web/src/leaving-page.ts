/**
 * Keeps a tap on a link from being answered with a reload of the page it was tapped on.
 *
 * Safari fails a page's unfinished script imports the moment the page is left for another whole
 * page: a link tapped before the page's scripts have taken over, an address typed, a bank's site.
 * The router takes any failed import for a file an older deploy no longer has and reloads the page
 * (once per tab, which it notes in sessionStorage under the error's message). In Safari that reload
 * wins over the navigation it interrupted: the Parent taps Transactions as This Month appears and
 * gets This Month again. Chromium lets the navigation win, so only an iPhone showed it.
 *
 * So while the page is being left, the router's note is written for it: it sees a reload already
 * spent and doesn't start one. The page it would have repaired is going away anyway; its failed
 * part draws nothing meanwhile (`leftMidLoad`), and if Safari later brings that very page back
 * from its back/forward cache, it is reloaded then.
 */

/** The router's note for Safari's failed import, whose message is the same for every file. */
const RELOADED = "tanstack_router_reload:Importing a module script failed.";
/** Our own value in it, so the router's real note (a reload it did make) is never taken away. */
const LEAVING = "leaving";
/** A navigation that never happened (a download, a cancelled load) is forgotten after this long. */
const FORGET_MS = 10_000;

let leaving = false;
let broken = false;

function note(): Storage | null {
	try {
		return window.sessionStorage;
	} catch {
		// Private browsing with storage blocked: the router doesn't reload without it either.
		return null;
	}
}

/**
 * True for an import that failed because the page was being left. The page's error screen asks
 * before drawing itself, so "Something went wrong" doesn't flash on the way out.
 */
export function leftMidLoad(error: unknown): boolean {
	if (!leaving) return false;
	const message = error instanceof Error ? error.message : "";
	if (!message.startsWith("Importing a module script failed")) return false;
	broken = true;
	return true;
}

/** Starts watching for the page being left. Call once, in the browser, before any route loads. */
export function watchLeavingPage() {
	if (typeof window === "undefined") return;
	// The page before this one left its mark: it has done its job.
	if (note()?.getItem(RELOADED) === LEAVING) note()?.removeItem(RELOADED);

	let timer: ReturnType<typeof setTimeout> | undefined;
	const stay = () => {
		leaving = false;
		if (note()?.getItem(RELOADED) === LEAVING) note()?.removeItem(RELOADED);
	};
	const leave = () => {
		const storage = note();
		if (!storage) return;
		const noted = storage.getItem(RELOADED);
		if (noted && noted !== LEAVING) return;
		storage.setItem(RELOADED, LEAVING);
		leaving = true;
		clearTimeout(timer);
		timer = setTimeout(stay, FORGET_MS);
	};

	window.addEventListener("beforeunload", leave);
	window.addEventListener("pagehide", leave);
	// Mobile Safari doesn't promise beforeunload, so a link that is about to load a whole page counts
	// too. On window, after the router's own handler: a link it handles has had its default prevented.
	window.addEventListener("click", (event) => {
		if (event.defaultPrevented || event.button !== 0) return;
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
		if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("download")) return;
		if (link.target && link.target !== "_self") return;
		if (!/^https?:$/.test(link.protocol)) return;
		const here = window.location;
		const samePage =
			link.origin === here.origin && link.pathname === here.pathname && link.search === here.search;
		if (samePage) return;
		leave();
	});
	window.addEventListener("pageshow", (event) => {
		if (!event.persisted) return;
		// Back to a page that was left mid-load, as it was: a part of it failed for good.
		if (broken) window.location.reload();
		else stay();
	});
}
