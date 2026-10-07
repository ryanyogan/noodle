/**
 * The app's side of noticing an update (issue 140; the deciding is in app-update.ts).
 *
 * When it looks: as the page opens, when it comes back into view or focus (an installed app on a
 * phone is resumed, not loaded, so this is where it goes stale), when it is back online, when the
 * live connection to the Household Agent opens (a deploy drops every connection, so open screens
 * hear of it within seconds), and every quarter of an hour besides.
 *
 * Nothing is cached by the service worker (public/sw.js shows Nudges and nothing else), so a
 * plain reload brings the new page.
 */
import { toast } from "@noodle/ui/components/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
	LIVE_CONNECTED,
	newerVersionThere,
	onOpen,
	readUpdateState,
	rememberTried,
	UPDATED,
	VERSION_PATH,
	whatNow,
	writeUpdateState,
} from "./app-update";
import { loadedBuild } from "./build-id";
import { outboxKey, type Store, type Who, waitingIn } from "./outbox";

/** The slow timer, for a screen left open and in view. */
const CHECK_EVERY_MS = 15 * 60 * 1000;
/** Coming into view, focus and reconnecting often arrive together: one question answers them. */
const CHECK_APART_MS = 5 * 1000;
/** While a refresh waits for typing or the outbox, how often it asks whether it may go. */
const RETRY_EVERY_MS = 2_000;

const NOTICE_ID = "app-update";

function deviceStore(): Store | null {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

const FIELDS = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const DIALOGS = "[role='dialog'], [role='alertdialog']";

const heldIn = (field: Element) =>
	field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")
		? String(field.checked)
		: field instanceof HTMLInputElement ||
				field instanceof HTMLTextAreaElement ||
				field instanceof HTMLSelectElement
			? field.value
			: (field.textContent ?? "");

/**
 * Watches which fields have been typed in. A field counts while it holds something other than it
 * did when focus came to it and either still has focus, or sits in an open sheet or dialog (whose
 * fields are only saved together, so each keeps the value it had when first touched).
 */
function watchTyping() {
	const before = new WeakMap<Element, string>();
	const inDialog = (field: Element) => field.closest(DIALOGS) !== null;
	const dirty = (field: Element) => before.has(field) && before.get(field) !== heldIn(field);
	const focused = (event: FocusEvent) => {
		const field = event.target instanceof Element ? event.target.closest(FIELDS) : null;
		if (!field) return;
		if (!before.has(field) || !inDialog(field)) before.set(field, heldIn(field));
	};
	document.addEventListener("focusin", focused, true);
	// Whatever has focus as the page opens was never seen arriving there.
	const first = document.activeElement?.closest(FIELDS);
	if (first) before.set(first, heldIn(first));
	return {
		typing() {
			const active = document.activeElement?.closest(FIELDS);
			if (active && dirty(active)) return true;
			for (const dialog of document.querySelectorAll(DIALOGS)) {
				for (const field of dialog.querySelectorAll(FIELDS)) if (dirty(field)) return true;
			}
			return false;
		},
		stop: () => document.removeEventListener("focusin", focused, true),
	};
}

/** The server's build, or null when it couldn't be asked (offline, mid-deploy). */
async function askServer(): Promise<string | null> {
	try {
		const response = await fetch(VERSION_PATH, { cache: "no-store", credentials: "same-origin" });
		if (!response.ok) return null;
		const { build } = (await response.json()) as { build?: unknown };
		return typeof build === "string" ? build : null;
	} catch {
		return null;
	}
}

/** How long after the layout appears the page says it was updated. */
const TELL_AFTER_MS = 400;

let tell: boolean | undefined;
let told = false;

/**
 * Whether this page is to say it was updated: decided once a page, as it opens, and written down
 * then, so asking again (React runs an effect twice in development) gets the same answer.
 */
function openOnce(store: Store | null, loaded: string): boolean {
	if (tell === undefined) {
		const opened = onOpen({ loaded, state: readUpdateState(store), now: Date.now() });
		writeUpdateState(store, opened.state);
		tell = opened.tell;
	}
	return tell;
}

/**
 * Says "Noodle was updated" once on a page of a newer build, and keeps an open page from going
 * stale: it refreshes when a newer build is deployed, at once if nothing is being typed and
 * nothing waits in the outbox, else as soon as that is so. Once, in the app's layout.
 */
export function useAppUpdate({ householdId, parentId }: Who) {
	const queryClient = useQueryClient();
	useEffect(() => {
		const store = deviceStore();
		const loaded = loadedBuild();
		// Shortly after, once the Toaster is listening; an effect run twice still says it once.
		const telling =
			openOnce(store, loaded) && !told
				? setTimeout(() => {
						told = true;
						toast(UPDATED, { tone: "success", id: NOTICE_ID, duration: 6_000 });
					}, TELL_AFTER_MS)
				: undefined;

		const fields = watchTyping();
		/** The newer build, once one is there. */
		let newer: string | null = null;
		let asking = false;
		let askedAt = 0;
		let noticed = false;
		let retry: ReturnType<typeof setInterval> | undefined;
		let gone = false;

		const waiting = () =>
			waitingIn(store, outboxKey({ householdId, parentId })).length > 0 ||
			queryClient.isMutating() > 0;

		function refresh(build: string, asked: boolean) {
			// Written down first: the page that follows never refreshes for this build again.
			const remembered = rememberTried(store, loaded, build);
			if (!remembered && !asked) return;
			gone = true;
			clearInterval(retry);
			window.location.reload();
		}

		function settle() {
			if (!newer || gone) return;
			const build = newer;
			const now = whatNow({
				typing: fields.typing(),
				waiting: waiting(),
				canRemember: store !== null,
			});
			if (now === "refresh") return refresh(build, false);
			if (!noticed) {
				noticed = true;
				toast(UPDATED, {
					tone: "success",
					id: NOTICE_ID,
					sticky: true,
					// Asked for, so it goes even where it can't be remembered; what waits in the outbox is
					// written down and sent by the page that follows (ADR-0056).
					action: { label: "Refresh now", onClick: () => refresh(build, true) },
				});
			}
			retry ??= setInterval(settle, RETRY_EVERY_MS);
		}

		async function check() {
			if (newer || asking || gone || document.visibilityState !== "visible") return;
			if (Date.now() - askedAt < CHECK_APART_MS) return;
			asking = true;
			askedAt = Date.now();
			const server = await askServer();
			asking = false;
			const triedFor = readUpdateState(store)?.triedFor ?? null;
			if (!newerVersionThere({ loaded, server, triedFor })) return;
			newer = server;
			settle();
		}
		const look = () => void check();

		look();
		const timer = setInterval(look, CHECK_EVERY_MS);
		document.addEventListener("visibilitychange", look);
		window.addEventListener("focus", look);
		window.addEventListener("pageshow", look);
		window.addEventListener("online", look);
		window.addEventListener(LIVE_CONNECTED, look);
		// A change answered or a field left may be the moment a waiting refresh can go.
		const stopWatchingMutations = queryClient.getMutationCache().subscribe(() => {
			if (newer) setTimeout(settle, 0);
		});
		return () => {
			gone = true;
			clearTimeout(telling);
			clearInterval(timer);
			clearInterval(retry);
			document.removeEventListener("visibilitychange", look);
			window.removeEventListener("focus", look);
			window.removeEventListener("pageshow", look);
			window.removeEventListener("online", look);
			window.removeEventListener(LIVE_CONNECTED, look);
			stopWatchingMutations();
			fields.stop();
		};
	}, [queryClient, householdId, parentId]);
}
