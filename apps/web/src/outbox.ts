/**
 * Keeps a change that has not been answered yet on the device, so it is sent again if the page
 * goes before the server has it (ADR-0056).
 *
 * Changes to Transactions go to the server one at a time (`reviewWrites`, ADR-0041). One already
 * sent outlives the page (keep-saving.ts); one still waiting its turn had not been sent, and a page
 * that is gone sends nothing, so a Parent who decided three cards on a slow connection and closed
 * the tab lost the second and third without a word (issue 128).
 *
 * So every such change is written down when it is made and crossed off when the server answers.
 * What is still written down when the app next opens, for the same Parent in the same Household,
 * is sent again in the order it was made, through the same queue. The server tells a repeat of a
 * change that did land from a change made on something that has since moved on, so sending again
 * is safe and nothing is forced.
 *
 * What is written down does not wait for ever: after a week it is dropped unsent and said
 * (`MAX_AGE_MS`), and no more than `MAX_WAITING` are kept at once.
 *
 * No React and no `window` here: the storage and the "page is going" signal are handed in, so the
 * bookkeeping is tested on its own (outbox.test.ts). With no storage it does nothing at all.
 */
import type { MutationOptions, QueryClient } from "@tanstack/react-query";

/** A change written down until the server answers it. */
export type Waiting = {
	id: string;
	/** Which kind of write it is: names how it is sent again. */
	kind: string;
	/** What the write was asked with, as JSON. */
	variables: unknown;
	/** How many times sending it again got no answer. */
	tries: number;
	/** When it was made (ms since 1970): one too old is dropped, not sent. */
	at: number;
};

/** Whose changes they are. Never sent for anyone else. */
export type Who = { householdId: string; parentId: string };

/** The part of `localStorage` used. */
export type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** How a change left waiting is sent again: an ordinary mutation's options. */
export type Resend = MutationOptions<unknown, Error, unknown, unknown>;

/** Sending again that gets no answer this many times is given up. */
export const MAX_TRIES = 3;

/**
 * One made longer ago than this is dropped unsent. A week-old decision is no longer what the
 * Parent would do on what the Household's figures are now, and a month may have been closed on
 * them since.
 */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** No more than this many are written down at once; one made past it is sent as ever, only not kept. */
export const MAX_WAITING = 100;

const PREFIX = "noodle.outbox.";

/** Where one Parent's waiting changes in one Household are kept. */
export const outboxKey = (who: Who) => `${PREFIX}${who.householdId}.${who.parentId}`;

const isWaiting = (entry: unknown): entry is Waiting =>
	typeof entry === "object" &&
	entry !== null &&
	typeof (entry as Waiting).id === "string" &&
	typeof (entry as Waiting).kind === "string" &&
	typeof (entry as Waiting).tries === "number" &&
	typeof (entry as Waiting).at === "number" &&
	"variables" in entry;

/** What is written down, oldest first. Anything unreadable counts as nothing. */
export function waitingIn(store: Store | null, key: string): Waiting[] {
	if (!store) return [];
	try {
		const list: unknown = JSON.parse(store.getItem(key) ?? "[]");
		return Array.isArray(list) ? list.filter(isWaiting) : [];
	} catch {
		return [];
	}
}

function keep(store: Store | null, key: string, list: Waiting[]) {
	if (!store) return;
	try {
		if (list.length === 0) store.removeItem(key);
		else store.setItem(key, JSON.stringify(list));
	} catch {
		// Full, blocked, or something that isn't JSON: the change is still sent as ever.
	}
}

/** Takes away what was written down for anyone else on this device. */
function dropOthers(store: Store | null, key: string) {
	if (!store) return;
	try {
		const others: string[] = [];
		for (let i = 0; i < store.length; i++) {
			const name = store.key(i);
			if (name?.startsWith(PREFIX) && name !== key) others.push(name);
		}
		for (const name of others) store.removeItem(name);
	} catch {
		// Blocked storage: nothing was written there either.
	}
}

let made = 0;
const newId = () =>
	`${Date.now().toString(36)}-${(made++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const opened = new WeakMap<QueryClient, { key: string; close: () => void }>();

/**
 * Starts writing down the changes of `queryClient` that say `meta: { outbox: kind }`, and sends
 * again what an earlier page of `who` left. Opening it twice for the same Parent does nothing
 * more. Answers with what stops it.
 */
export function openOutbox({
	queryClient,
	who,
	store,
	resend,
	refused = () => false,
	leaving = () => false,
	carry,
	expired = () => {},
	now = Date.now,
}: {
	queryClient: QueryClient;
	who: Who;
	/** `localStorage`, or null where there is none. */
	store: Store | null;
	/** The options to send one again with; null for a kind this build doesn't know (it is dropped). */
	resend: (waiting: Waiting) => Resend | null;
	/** True for an error that is the server's answer "left alone": nothing to try again. */
	refused?: (error: unknown) => boolean;
	/** True while the page is going: a request that fails then was cut off, not answered. */
	leaving?: () => boolean;
	/**
	 * What to write down for a change of this page, given what it was asked with: the same, with
	 * what this page's answered writes have since learned (a Transaction's version). Asked when it
	 * is made and again each time another of this page's changes is answered, so one left waiting
	 * behind a change that WAS answered is sent again on what that answer left, not on the row as
	 * it was before. Never asked for a change another page wrote down.
	 */
	carry?: (kind: string, variables: unknown) => unknown;
	/** Told how many were dropped unsent for being older than `MAX_AGE_MS`. */
	expired?: (count: number) => void;
	now?: () => number;
}): () => void {
	const key = outboxKey(who);
	const already = opened.get(queryClient);
	if (already?.key === key) return already.close;
	already?.close();

	const cache = queryClient.getMutationCache();
	/** The changes of this page that are written down: mutation → its entry. */
	const live = new Map<number, string>();
	const change = (edit: (list: Waiting[]) => Waiting[]) =>
		keep(store, key, edit(waitingIn(store, key)));
	const crossOff = (id: string) => change((list) => list.filter((entry) => entry.id !== id));
	const carried = (kind: string, variables: unknown) => {
		try {
			return carry ? carry(kind, variables) : variables;
		} catch {
			return variables;
		}
	};

	const unsubscribe = cache.subscribe((event) => {
		if (event.type !== "updated") return;
		const { mutation, action } = event;
		const meta = mutation.options.meta as { outbox?: unknown; waiting?: unknown } | undefined;
		if (typeof meta?.outbox !== "string") return;
		const kind = meta.outbox;

		if (action.type === "pending") {
			// Said twice for one change: when it is made, and again once its `onMutate` has answered.
			if (live.has(mutation.mutationId)) return;
			// One being sent again is written down already, in its place.
			if (typeof meta.waiting === "string") return void live.set(mutation.mutationId, meta.waiting);
			const id = newId();
			live.set(mutation.mutationId, id);
			change((list) =>
				list.length >= MAX_WAITING
					? list
					: [
							...list,
							{ id, kind, variables: carried(kind, action.variables), tries: 0, at: now() },
						],
			);
			return;
		}
		if (action.type !== "success" && action.type !== "error") return;
		const id = live.get(mutation.mutationId);
		if (id === undefined) return;
		live.delete(mutation.mutationId);
		if (action.type === "success") {
			// Answered: crossed off, and this page's others still waiting carry what it learned.
			const mine = new Set(live.values());
			return change((list) =>
				list
					.filter((entry) => entry.id !== id)
					.map((entry) =>
						carry && mine.has(entry.id)
							? { ...entry, variables: carried(entry.kind, entry.variables) }
							: entry,
					),
			);
		}
		// Cut off by the page going: it stays written down for the next page.
		if (leaving()) return;
		// Made on this page: the Parent has been told and the screen put back. Sent again and
		// refused: the server's answer. Neither is tried again.
		if (typeof meta.waiting !== "string" || refused(action.error)) return crossOff(id);
		// Sent again and no answer (no connection, say): the next page tries, a few times.
		change((list) =>
			list
				.map((entry) => (entry.id === id ? { ...entry, tries: entry.tries + 1 } : entry))
				.filter((entry) => entry.tries < MAX_TRIES),
		);
	});
	const close = () => {
		unsubscribe();
		opened.delete(queryClient);
	};
	opened.set(queryClient, { key, close });

	dropOthers(store, key);
	// Too old to send (or dated in the future by more than that: a clock that was wrong).
	const all = waitingIn(store, key);
	const fresh = all.filter((entry) => Math.abs(now() - entry.at) <= MAX_AGE_MS);
	if (fresh.length < all.length) {
		keep(store, key, fresh);
		expired(all.length - fresh.length);
	}
	for (const waiting of fresh) {
		const options = resend(waiting);
		if (!options) {
			crossOff(waiting.id);
			continue;
		}
		void cache
			.build(queryClient, {
				...options,
				meta: { ...options.meta, outbox: waiting.kind, waiting: waiting.id },
			})
			.execute(waiting.variables)
			// Its own options say how it went.
			.catch(() => {});
	}
	return close;
}
