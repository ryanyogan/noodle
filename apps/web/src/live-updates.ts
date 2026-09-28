import { type Query, type QueryClient, type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
	everyHouseholdChange,
	HOUSEHOLD_AGENT_PATH,
	type HouseholdChange,
	parseHouseholdChanges,
	queryKeysFor,
} from "./household-changes";
import { monthChangeKey } from "./plan-changes";

/** How often an open connection is checked; phones drop sockets without closing them. */
const PING_EVERY_MS = 25_000;
/** How long a check waits for the Household Agent's answer before reconnecting. */
const PONG_WITHIN_MS = 5_000;
/** The longest wait between attempts to reconnect. */
const MAX_RETRY_MS = 30_000;

/**
 * Keeps this screen connected to the Household Agent while the authenticated app is open, and
 * refetches whatever it says another write changed (ADR-0007), so both Parents' screens show the
 * same truth without a reload. Reconnects on its own, catching up on anything it missed.
 */
export function useLiveUpdates() {
	const queryClient = useQueryClient();
	useEffect(() => {
		const refetcher = createRefetcher(queryClient);
		const connection = connect({
			onChanges: refetcher.refetch,
			onReconnect: () => refetcher.refetch(everyHouseholdChange),
		});
		return () => {
			connection.close();
			refetcher.stop();
		};
	}, [queryClient]);
}

/**
 * Invalidates the queries matching some changes, but never while a change to a month is in
 * flight, since refetching then would briefly undo it on screen (ADR-0006); those wait until it
 * settles. A query already read from the server since the change arrived is left alone, so the
 * writer's own screen, which refetches once its change settles, doesn't fetch it twice.
 */
function createRefetcher(queryClient: QueryClient) {
	// When the fetch behind each query's data started, and when its current fetch did.
	const readAt = new WeakMap<Query, number>();
	const fetchStartedAt = new WeakMap<Query, number>();
	const stopWatchingQueries = queryClient.getQueryCache().subscribe((event) => {
		if (event.type !== "updated") return;
		if (event.action.type === "fetch") fetchStartedAt.set(event.query, Date.now());
		// `manual` is setQueryData: an optimistic edit, not a read.
		if (event.action.type === "success" && !event.action.manual) {
			readAt.set(event.query, fetchStartedAt.get(event.query) ?? 0);
		}
	});
	const readSince = (query: Query, since: number) =>
		((query.state.fetchStatus === "fetching" ? fetchStartedAt : readAt).get(query) ?? 0) > since;

	const waiting = new Map<string, { queryKey: QueryKey; since: number }>();
	function flush() {
		if (waiting.size === 0 || queryClient.isMutating({ mutationKey: monthChangeKey }) > 0) return;
		for (const { queryKey, since } of waiting.values()) {
			void queryClient.invalidateQueries({
				queryKey,
				predicate: (query) => !readSince(query, since),
			});
		}
		waiting.clear();
	}
	const stopWatchingMutations = queryClient.getMutationCache().subscribe(flush);

	return {
		refetch(changes: readonly HouseholdChange[]) {
			const since = Date.now();
			for (const queryKey of queryKeysFor(changes)) {
				waiting.set(JSON.stringify(queryKey), { queryKey, since });
			}
			flush();
		},
		stop() {
			stopWatchingQueries();
			stopWatchingMutations();
		},
	};
}

/** A WebSocket to this Parent's Household Agent that reconnects, with backoff, until closed. */
function connect({
	onChanges,
	onReconnect,
}: {
	onChanges: (changes: HouseholdChange[]) => void;
	onReconnect: () => void;
}) {
	let socket: WebSocket | null = null;
	let closed = false;
	let connectedBefore = false;
	let attempts = 0;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let pingTimer: ReturnType<typeof setInterval> | undefined;
	let pongTimer: ReturnType<typeof setTimeout> | undefined;

	function disconnect() {
		clearTimeout(retryTimer);
		clearInterval(pingTimer);
		clearTimeout(pongTimer);
		pongTimer = undefined;
		if (!socket) return;
		const old = socket;
		socket = null;
		old.onmessage = old.onclose = null;
		// Closing before it opens makes the browser log an error, so let it open first.
		if (old.readyState === WebSocket.CONNECTING) old.onopen = () => old.close();
		else old.close();
	}

	function retry() {
		disconnect();
		if (closed) return;
		const backoff = Math.min(MAX_RETRY_MS, 1000 * 2 ** attempts++);
		retryTimer = setTimeout(open, backoff * (0.5 + Math.random() / 2));
	}

	function ping() {
		if (socket?.readyState !== WebSocket.OPEN || pongTimer) return;
		socket.send("ping");
		pongTimer = setTimeout(retry, PONG_WITHIN_MS);
	}

	function open() {
		disconnect();
		const url = new URL(HOUSEHOLD_AGENT_PATH, window.location.href);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		const ws = new WebSocket(url);
		socket = ws;
		ws.onopen = () => {
			attempts = 0;
			// Changes made while disconnected were never heard, so catch up on everything.
			if (connectedBefore) onReconnect();
			connectedBefore = true;
			pingTimer = setInterval(ping, PING_EVERY_MS);
		};
		ws.onmessage = (event) => {
			if (event.data === "pong") {
				clearTimeout(pongTimer);
				pongTimer = undefined;
			} else {
				onChanges(parseHouseholdChanges(event.data));
			}
		};
		// Also follows a refused connection, e.g. while Clerk refreshes an expired session.
		ws.onclose = retry;
	}

	// Coming back to the screen or online: check the connection now instead of waiting.
	function wake() {
		if (document.visibilityState !== "visible") return;
		if (socket) return ping();
		attempts = 0;
		open();
	}

	open();
	document.addEventListener("visibilitychange", wake);
	window.addEventListener("online", wake);
	return {
		close() {
			closed = true;
			document.removeEventListener("visibilitychange", wake);
			window.removeEventListener("online", wake);
			disconnect();
		},
	};
}
