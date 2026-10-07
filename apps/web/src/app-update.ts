/**
 * Noticing that the app was updated (issue 140): an open page, in a tab or installed on a phone,
 * keeps running the build it was loaded with long after a newer one is deployed. This is the
 * deciding, kept pure so it is tested; `app-update-watch.ts` does the looking and the refreshing.
 *
 * A build is named by its id (vite.config.ts, `__BUILD_ID__`). The page knows the one it was
 * loaded with, asks the server for its own, and when they differ refreshes at a safe moment. What
 * this device remembers about it is one small entry in `localStorage`.
 */
import type { Store } from "./outbox";

/** Where the server says which build it is. */
export const VERSION_PATH = "/api/version";

/** Said after the refresh, and beside **Refresh now** while a refresh has to wait. */
export const UPDATED = "Noodle was updated";

/** Sent on the window when the live connection to the Household Agent opens (live-updates.ts). */
export const LIVE_CONNECTED = "noodle:live-connected";

/** Where a device keeps what it knows. Not under the outbox's prefix, which clears its own. */
export const UPDATE_STATE_KEY = "noodle.app-update";

/** No notice for an update within this long of the last one this device was told about. */
export const QUIET_AFTER_TOLD_MS = 60 * 60 * 1000;

/** What a device remembers between pages. */
export type UpdateState = {
	/** The build this device last ran. */
	seen: string;
	/** When it was last told "Noodle was updated" (ms since 1970). */
	toldAt: number | null;
	/** The build it last refreshed for; it never refreshes for that one again. */
	triedFor: string | null;
};

/**
 * Whether the server runs another build than this page, and one worth refreshing for. Not the one
 * this device already refreshed for: after a refresh that still brought the old page (a cached
 * shell) or a server put back to an earlier build, asking again would refresh for ever.
 */
export function newerVersionThere({
	loaded,
	server,
	triedFor,
}: {
	loaded: string;
	server: string | null;
	triedFor: string | null;
}): boolean {
	return !!server && server !== loaded && server !== triedFor;
}

/**
 * What to do once a newer build is there. Refresh at once when no field is being typed in and no
 * change waits to be saved; otherwise say so, with **Refresh now**, and ask again later. A device
 * that can't write down that it refreshed (storage blocked) is never refreshed by itself, since
 * nothing would stop it doing so again.
 */
export function whatNow({
	typing,
	waiting,
	canRemember,
}: {
	typing: boolean;
	waiting: boolean;
	canRemember: boolean;
}): "refresh" | "notice" {
	return !typing && !waiting && canRemember ? "refresh" : "notice";
}

/**
 * A page opening: whether to say "Noodle was updated", and what to remember. Said once for each
 * build a device arrives on after another, however it got there (refreshed by itself, or opened
 * later); never the first time, and not within an hour of the last time it was said.
 */
export function onOpen({
	loaded,
	state,
	now,
}: {
	loaded: string;
	state: UpdateState | null;
	now: number;
}): { tell: boolean; state: UpdateState } {
	if (!state) return { tell: false, state: { seen: loaded, toldAt: null, triedFor: null } };
	if (state.seen === loaded) return { tell: false, state };
	const tell = state.toldAt === null || now - state.toldAt >= QUIET_AFTER_TOLD_MS;
	return {
		tell,
		state: {
			seen: loaded,
			toldAt: tell ? now : state.toldAt,
			// Arrived on the build it refreshed for: that try is over. Any other is kept.
			triedFor: state.triedFor === loaded ? null : state.triedFor,
		},
	};
}

const isUpdateState = (value: unknown): value is UpdateState =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as UpdateState).seen === "string" &&
	((value as UpdateState).toldAt === null || typeof (value as UpdateState).toldAt === "number") &&
	((value as UpdateState).triedFor === null || typeof (value as UpdateState).triedFor === "string");

/** What this device remembers; null when nothing, or nothing readable. */
export function readUpdateState(store: Store | null): UpdateState | null {
	if (!store) return null;
	try {
		const value: unknown = JSON.parse(store.getItem(UPDATE_STATE_KEY) ?? "null");
		return isUpdateState(value) ? value : null;
	} catch {
		return null;
	}
}

/** Writes it down; false when it couldn't be. */
export function writeUpdateState(store: Store | null, state: UpdateState): boolean {
	if (!store) return false;
	try {
		store.setItem(UPDATE_STATE_KEY, JSON.stringify(state));
		return true;
	} catch {
		return false;
	}
}

/**
 * Notes, just before refreshing, the build being refreshed for. It is all a refresh writes: what
 * waits in the outbox is left exactly as it is, for the next page to send (ADR-0056). False when
 * it couldn't be written, and then the page must not refresh by itself.
 */
export function rememberTried(store: Store | null, loaded: string, build: string): boolean {
	const state = readUpdateState(store) ?? { seen: loaded, toldAt: null, triedFor: null };
	return writeUpdateState(store, { ...state, triedFor: build });
}

/** The cookie an E2E test names another build in; read only in a build made with AI_MODEL=stub. */
const DEV_BUILD_COOKIE = "noodle-dev-build";

/** The build named in a Cookie header (or `document.cookie`), or null. */
export function devBuildIn(cookies: string | null | undefined): string | null {
	for (const part of (cookies ?? "").split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name !== DEV_BUILD_COOKIE) continue;
		try {
			return decodeURIComponent(rest.join("=")) || null;
		} catch {
			return null;
		}
	}
	return null;
}
