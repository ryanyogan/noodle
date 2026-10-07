import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	devBuildIn,
	newerVersionThere,
	onOpen,
	QUIET_AFTER_TOLD_MS,
	readUpdateState,
	rememberTried,
	UPDATE_STATE_KEY,
	whatNow,
} from "./app-update";
import { openOutbox, outboxKey, type Store, type Waiting } from "./outbox";

/** `localStorage` as a Map. */
function memory(initial: Record<string, string> = {}): Store & { data: Map<string, string> } {
	const data = new Map(Object.entries(initial));
	return {
		data,
		get length() {
			return data.size;
		},
		key: (i) => [...data.keys()][i] ?? null,
		getItem: (name) => data.get(name) ?? null,
		setItem: (name, value) => void data.set(name, value),
		removeItem: (name) => void data.delete(name),
	};
}

const HOUR = 60 * 60 * 1000;

describe("newerVersionThere", () => {
	it("is when the server's build is another one than the page was loaded with", () => {
		expect(newerVersionThere({ loaded: "a", server: "b", triedFor: null })).toBe(true);
		expect(newerVersionThere({ loaded: "a", server: "a", triedFor: null })).toBe(false);
	});

	it("is not when the server said nothing readable", () => {
		expect(newerVersionThere({ loaded: "a", server: null, triedFor: null })).toBe(false);
		expect(newerVersionThere({ loaded: "a", server: "", triedFor: null })).toBe(false);
	});

	it("is not for a build this device already refreshed for: no loop on a cached shell or a rollback", () => {
		expect(newerVersionThere({ loaded: "a", server: "b", triedFor: "b" })).toBe(false);
		// The one after that is news again.
		expect(newerVersionThere({ loaded: "a", server: "c", triedFor: "b" })).toBe(true);
	});
});

describe("whatNow", () => {
	const idle = { typing: false, waiting: false, canRemember: true };

	it("refreshes at once when nothing is being typed and nothing waits", () => {
		expect(whatNow(idle)).toBe("refresh");
	});

	it("says so and waits while a field is being typed in", () => {
		expect(whatNow({ ...idle, typing: true })).toBe("notice");
	});

	it("says so and waits while a change is waiting in the outbox", () => {
		expect(whatNow({ ...idle, waiting: true })).toBe("notice");
	});

	it("never refreshes by itself where it couldn't remember having done so", () => {
		expect(whatNow({ ...idle, canRemember: false })).toBe("notice");
	});
});

describe("onOpen", () => {
	it("says nothing the first time a device opens the app", () => {
		const { tell, state } = onOpen({ loaded: "a", state: null, now: 1000 });
		expect(tell).toBe(false);
		expect(state).toEqual({ seen: "a", toldAt: null, triedFor: null });
	});

	it("says once that Noodle was updated when the page is another build than last time", () => {
		const first = onOpen({
			loaded: "b",
			state: { seen: "a", toldAt: null, triedFor: "b" },
			now: 5000,
		});
		expect(first.tell).toBe(true);
		// Arrived on the build it refreshed for: that try is over.
		expect(first.state).toEqual({ seen: "b", toldAt: 5000, triedFor: null });
		// Once per version per device.
		expect(onOpen({ loaded: "b", state: first.state, now: 6000 }).tell).toBe(false);
	});

	it("says nothing for an update within an hour of the last one it told of", () => {
		const told = { seen: "a", toldAt: 1000, triedFor: null };
		const soon = onOpen({ loaded: "b", state: told, now: 1000 + QUIET_AFTER_TOLD_MS - 1 });
		expect(soon.tell).toBe(false);
		// Seen all the same, so it isn't told later either.
		expect(soon.state).toEqual({ seen: "b", toldAt: 1000, triedFor: null });
		expect(onOpen({ loaded: "c", state: soon.state, now: 1000 + HOUR }).tell).toBe(true);
	});

	it("says nothing when the refresh brought the same old page, and still remembers the try", () => {
		const state = { seen: "a", toldAt: null, triedFor: "b" };
		expect(onOpen({ loaded: "a", state, now: 1000 })).toEqual({ tell: false, state });
	});
});

describe("what a device remembers", () => {
	it("reads nothing from an empty or broken store", () => {
		expect(readUpdateState(null)).toBeNull();
		expect(readUpdateState(memory())).toBeNull();
		expect(readUpdateState(memory({ [UPDATE_STATE_KEY]: "{nope" }))).toBeNull();
		expect(readUpdateState(memory({ [UPDATE_STATE_KEY]: '{"seen":7}' }))).toBeNull();
	});

	it("remembers the build it refreshed for", () => {
		const store = memory({
			[UPDATE_STATE_KEY]: JSON.stringify({ seen: "a", toldAt: 5, triedFor: null }),
		});
		expect(rememberTried(store, "a", "b")).toBe(true);
		expect(readUpdateState(store)).toEqual({ seen: "a", toldAt: 5, triedFor: "b" });
	});

	it("says when it could not write it down", () => {
		expect(rememberTried(null, "a", "b")).toBe(false);
		const full = {
			...memory(),
			setItem: () => {
				throw new Error("full");
			},
		};
		expect(rememberTried(full, "a", "b")).toBe(false);
	});
});

describe("a change waiting in the outbox", () => {
	const who = { householdId: "house", parentId: "ryan" };
	const waiting: Waiting = {
		id: "w1",
		kind: "change",
		variables: { id: "t1", note: "Milk" },
		tries: 0,
		at: Date.now(),
	};

	it("survives the refresh and is sent by the page that follows", async () => {
		const store = memory({ [outboxKey(who)]: JSON.stringify([waiting]) });

		// The refresh: all it writes is the build it refreshed for.
		expect(rememberTried(store, "a", "b")).toBe(true);
		expect(JSON.parse(store.getItem(outboxKey(who)) ?? "[]")).toEqual([waiting]);

		// The page that follows opens on the new build, then opens its outbox.
		const opened = onOpen({ loaded: "b", state: readUpdateState(store), now: Date.now() });
		expect(opened.tell).toBe(true);
		const sent: unknown[] = [];
		const queryClient = new QueryClient();
		const close = openOutbox({
			queryClient,
			who,
			store,
			resend: () => ({
				mutationFn: async (variables) => {
					sent.push(variables);
				},
			}),
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(sent).toEqual([waiting.variables]);
		// Answered, so no longer written down; what the update remembers is left alone.
		expect(store.getItem(outboxKey(who))).toBeNull();
		close();
	});

	it("is never among what the outbox clears as someone else's", () => {
		// The outbox drops other Parents' keys by its own prefix; the update's key isn't one.
		expect(UPDATE_STATE_KEY.startsWith("noodle.outbox.")).toBe(false);
	});
});

describe("devBuildIn", () => {
	it("reads the build a test names in a cookie", () => {
		expect(devBuildIn("a=1; noodle-dev-build=next-2; b=2")).toBe("next-2");
		expect(devBuildIn("noodle-dev-build=next%203")).toBe("next 3");
	});

	it("is null without one", () => {
		expect(devBuildIn(null)).toBeNull();
		expect(devBuildIn("")).toBeNull();
		expect(devBuildIn("other-noodle-dev-build=x")).toBeNull();
		expect(devBuildIn("noodle-dev-build=")).toBeNull();
	});
});
