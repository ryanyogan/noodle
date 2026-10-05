import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	canUndo,
	reviewWrites,
	type StackState,
	stackOrder,
	stackProgress,
	stackReducer,
	startStack,
} from "./review-stack";
import {
	CHANGED_ELSEWHERE,
	ChangedElsewhere,
	expectedVersionOf,
	forgetVersions,
	formSeen,
	leftAsTheyAre,
	noteVersion,
	settleWrite,
	type WriteAnswer,
} from "./transaction-versions";
import { sayChangedElsewhere } from "./transactions";

const said = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@noodle/ui/components/toast", () => ({ toast: said.toast }));

type Card = { id: string };
const a = { id: "a" };
const b = { id: "b" };
const c = { id: "c" };
const cards = [a, b, c];
const ids = (list: Card[]) => list.map((card) => card.id);
const run = (...events: Parameters<typeof stackReducer<Card>>[1][]) =>
	events.reduce<StackState<Card>>(stackReducer, startStack<Card>());

describe("Review's card stack", () => {
	test("starts in the server's order", () => {
		expect(ids(stackOrder(cards, startStack()))).toEqual(["a", "b", "c"]);
	});

	test("a skipped card goes to the back, in the order skipped", () => {
		const state = run({ type: "skipped", id: "a" }, { type: "skipped", id: "b" });
		expect(ids(stackOrder(cards, state))).toEqual(["c", "a", "b"]);
		const again = stackReducer(state, { type: "skipped", id: "a" });
		expect(ids(stackOrder(cards, again))).toEqual(["c", "b", "a"]);
	});

	test("a decision is kept for Undo and counted", () => {
		const state = run({ type: "decided", items: [a] });
		expect(state.history).toEqual([[a]]);
		expect(state.done).toBe(1);
		// The server's list no longer has it.
		expect(ids(stackOrder([b, c], state))).toEqual(["b", "c"]);
	});

	test("deciding a skipped card forgets the skip", () => {
		const state = run({ type: "skipped", id: "a" }, { type: "decided", items: [a] });
		expect(state.skipped).toEqual([]);
	});

	test("Undo puts the last decision back on top, a batch as one", () => {
		const state = run(
			{ type: "decided", items: [a] },
			{ type: "decided", items: [b, c] },
			{ type: "undone" },
		);
		expect(state.history).toEqual([[a]]);
		expect(state.done).toBe(1);
		expect(ids(stackOrder([b, c], state))).toEqual(["b", "c"]);
		const twice = stackReducer(state, { type: "undone" });
		expect(twice.done).toBe(0);
		expect(ids(stackOrder(cards, twice))).toEqual(["a", "b", "c"]);
	});

	test("Undo puts a card back on top even ahead of what was first", () => {
		const state = run({ type: "decided", items: [c] }, { type: "undone" });
		expect(ids(stackOrder(cards, state))).toEqual(["c", "a", "b"]);
	});

	test("Undo with nothing decided does nothing", () => {
		expect(run({ type: "undone" })).toEqual(startStack());
	});

	test("a failed save puts the card back on top and out of the history", () => {
		const state = run(
			{ type: "decided", items: [a] },
			{ type: "decided", items: [b] },
			{ type: "failed", items: [a] },
		);
		expect(state.history).toEqual([[b]]);
		expect(state.done).toBe(1);
		expect(ids(stackOrder([a, c], state))).toEqual(["a", "c"]);
	});

	test("a skip after Undo moves the card on from the top", () => {
		const state = run(
			{ type: "decided", items: [b] },
			{ type: "undone" },
			{ type: "skipped", id: "b" },
		);
		expect(state.top).toBeNull();
		expect(ids(stackOrder(cards, state))).toEqual(["a", "c", "b"]);
	});

	test("a card filed elsewhere leaves without disturbing the rest; a new one joins", () => {
		const state = run({ type: "skipped", id: "a" });
		expect(ids(stackOrder([b, { id: "d" }, a], state))).toEqual(["b", "d", "a"]);
		expect(ids(stackOrder([b], state))).toEqual(["b"]);
	});
});

describe("one Undo history: a toast's Undo and the stack's", () => {
	test("a toast's Undo of an earlier decision takes it out of the history, so the stack's Undo can't return it again", () => {
		const state = run(
			{ type: "decided", items: [a] },
			{ type: "decided", items: [b] },
			// The toast for a, still showing, is undone.
			{ type: "returned", items: [a] },
		);
		expect(state.history).toEqual([[b]]);
		expect(state.done).toBe(1);
		expect(state.top).toBe("a");
		// The stack's Undo now returns b, not a again.
		const after = stackReducer(state, { type: "undone" });
		expect(after.top).toBe("b");
		expect(after.history).toEqual([]);
		expect(after.done).toBe(0);
		expect(ids(stackOrder(cards, after))).toEqual(["b", "a", "c"]);
	});

	test("a batch's toast Undo returns the whole batch as one", () => {
		const state = run(
			{ type: "decided", items: [c] },
			{ type: "decided", items: [a, b] },
			{ type: "returned", items: [a, b] },
		);
		expect(state.history).toEqual([[c]]);
		expect(state.done).toBe(1);
		expect(state.top).toBe("a");
	});

	test("returning a card that was already returned changes nothing but the top", () => {
		const once = run({ type: "decided", items: [a] }, { type: "undone" });
		const twice = stackReducer(once, { type: "returned", items: [a] });
		expect(twice.history).toEqual([]);
		expect(twice.done).toBe(0);
		expect(twice.top).toBe("a");
	});
});

describe("Sort's count (#82)", () => {
	test("goes up by one with each decision while the whole stays put", () => {
		// 3 waiting; each decision takes one from what waits.
		expect(stackProgress(startStack<Card>(), 3)).toEqual({ at: 1, of: 3 });
		const one = run({ type: "decided", items: [a] });
		expect(stackProgress(one, 2)).toEqual({ at: 2, of: 3 });
		const two = stackReducer(one, { type: "decided", items: [b] });
		expect(stackProgress(two, 1)).toEqual({ at: 3, of: 3 });
	});

	test("counts everything waiting, not only the cards loaded", () => {
		// 250 wait, 100 are loaded: deciding one leaves 249, never "2 of 101".
		const one = run({ type: "decided", items: [a] });
		expect(stackProgress(one, 249)).toEqual({ at: 2, of: 250 });
	});

	test("a skip changes nothing, and an Undo takes it back", () => {
		const skipped = run({ type: "skipped", id: "a" });
		expect(stackProgress(skipped, 3)).toEqual({ at: 1, of: 3 });
		const undone = run({ type: "decided", items: [a] }, { type: "returned", items: [a] });
		expect(stackProgress(undone, 3)).toEqual({ at: 1, of: 3 });
	});

	test("a batch counts each of its cards", () => {
		const batch = run({ type: "decided", items: [a, b] });
		expect(stackProgress(batch, 1)).toEqual({ at: 3, of: 3 });
	});
});

describe("a decision made while an Undo is still saving (#84)", () => {
	const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

	/**
	 * A server where the last write to land wins, as two requests in flight at once do. The
	 * return lands only when the test lets it; the filing lands as soon as it's sent.
	 */
	function household(scope: typeof reviewWrites | undefined) {
		const queryClient = new QueryClient();
		const server = { filedIn: "gas" as string | null, sent: [] as string[], landReturn: () => {} };
		const returnCard = new MutationObserver(queryClient, {
			mutationKey: ["month-change"],
			scope,
			mutationFn: () => {
				server.sent.push("return");
				return new Promise<void>((resolve) => {
					server.landReturn = () => {
						server.filedIn = null;
						resolve();
					};
				});
			},
		});
		const decide = new MutationObserver(queryClient, {
			mutationKey: ["month-change"],
			scope,
			mutationFn: async () => {
				server.sent.push("file");
				server.filedIn = "groceries";
			},
		});
		return { queryClient, server, returnCard, decide };
	}

	test("the stack: Undo, then the card decided again, leaves Undo available whatever the list says", () => {
		const state = run(
			{ type: "decided", items: [a] },
			{ type: "returned", items: [a] },
			{ type: "decided", items: [a] },
		);
		expect(state.history).toEqual([[a]]);
		expect(state.done).toBe(1);
		expect(canUndo(state)).toBe(true);
		// A list read while the return was landing may still hold the card, or not: the history
		// is the stack's own, so neither read takes Undo away.
		expect(ids(stackOrder([a, b, c], state))).toEqual(["a", "b", "c"]);
		expect(ids(stackOrder([b, c], state))).toEqual(["b", "c"]);
		expect(canUndo(state)).toBe(true);
		expect(canUndo(startStack<Card>())).toBe(false);
		expect(canUndo(run({ type: "decided", items: [a] }, { type: "returned", items: [a] }))).toBe(
			false,
		);
	});

	test("the decision is sent only after the return has answered, so it stands", async () => {
		const { queryClient, server, returnCard, decide } = household(reviewWrites);
		const returned = returnCard.mutate();
		const filed = decide.mutate();
		await tick();
		// The decision waits its turn, and counts as saving while it does.
		expect(server.sent).toEqual(["return"]);
		expect(decide.getCurrentResult().isPending).toBe(true);
		expect(queryClient.isMutating({ mutationKey: ["month-change"] })).toBe(2);
		server.landReturn();
		await Promise.all([returned, filed]);
		expect(server.sent).toEqual(["return", "file"]);
		expect(server.filedIn).toBe("groceries");
		// Both settled: nothing is left saving.
		expect(returnCard.getCurrentResult().isPending).toBe(false);
		expect(decide.getCurrentResult().isPending).toBe(false);
		expect(queryClient.isMutating()).toBe(0);
	});

	test("a failed return doesn't hold the decision back", async () => {
		const queryClient = new QueryClient();
		const sent: string[] = [];
		const returnCard = new MutationObserver(queryClient, {
			scope: reviewWrites,
			mutationFn: async () => {
				sent.push("return");
				throw new Error("offline");
			},
		});
		const decide = new MutationObserver(queryClient, {
			scope: reviewWrites,
			mutationFn: async () => {
				sent.push("file");
			},
		});
		const returned = returnCard.mutate().catch(() => "failed");
		const filed = decide.mutate();
		expect(await returned).toBe("failed");
		await filed;
		expect(sent).toEqual(["return", "file"]);
		expect(queryClient.isMutating()).toBe(0);
	});

	test("what the scope prevents: sent at once, a slow return lands last and the decision is lost", async () => {
		const { server, returnCard, decide } = household(undefined);
		const returned = returnCard.mutate();
		const filed = decide.mutate();
		await tick();
		expect(server.sent).toEqual(["return", "file"]);
		server.landReturn();
		await Promise.all([returned, filed]);
		expect(server.filedIn).toBeNull();
	});
});

describe("an edit from the Transactions sheet while a Review decision waits its turn (#85)", () => {
	const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

	/**
	 * A server where the last write to land wins. An earlier Review write (another card's) answers
	 * only when the test lets it; this Transaction's decision and its edit land as soon as sent.
	 */
	function household(editScope: typeof reviewWrites | undefined) {
		const queryClient = new QueryClient();
		const server = { filedIn: null as string | null, sent: [] as string[], landEarlier: () => {} };
		const earlier = new MutationObserver(queryClient, {
			mutationKey: ["month-change"],
			scope: reviewWrites,
			mutationFn: () => {
				server.sent.push("earlier");
				return new Promise<void>((resolve) => {
					server.landEarlier = resolve;
				});
			},
		});
		const decide = new MutationObserver(queryClient, {
			mutationKey: ["month-change"],
			scope: reviewWrites,
			mutationFn: async () => {
				server.sent.push("decision");
				server.filedIn = "groceries";
			},
		});
		const edit = new MutationObserver(queryClient, {
			mutationKey: ["month-change"],
			scope: editScope,
			mutationFn: async () => {
				server.sent.push("edit");
				server.filedIn = "hockey";
			},
		});
		return { queryClient, server, earlier, decide, edit };
	}

	test("in Review's queue the edit is sent after the decision made before it, so it stands", async () => {
		const { queryClient, server, earlier, decide, edit } = household(reviewWrites);
		const first = earlier.mutate();
		const decided = decide.mutate();
		const edited = edit.mutate();
		await tick();
		// Both wait behind the slow write, and count as saving while they do.
		expect(server.sent).toEqual(["earlier"]);
		expect(edit.getCurrentResult().isPending).toBe(true);
		expect(queryClient.isMutating({ mutationKey: ["month-change"] })).toBe(3);
		server.landEarlier();
		await Promise.all([first, decided, edited]);
		expect(server.sent).toEqual(["earlier", "decision", "edit"]);
		expect(server.filedIn).toBe("hockey");
		expect(queryClient.isMutating()).toBe(0);
	});

	test("two edits to one Transaction are sent in the order they were made", async () => {
		const queryClient = new QueryClient();
		const server = { note: "", sent: [] as string[], landFirst: () => {} };
		const edit = (note: string, slow: boolean) =>
			new MutationObserver(queryClient, {
				scope: reviewWrites,
				mutationFn: async () => {
					server.sent.push(note);
					if (slow) await new Promise<void>((resolve) => (server.landFirst = resolve));
					server.note = note;
				},
			});
		const first = edit("first", true).mutate();
		const second = edit("second", false).mutate();
		await tick();
		expect(server.sent).toEqual(["first"]);
		server.landFirst();
		await Promise.all([first, second]);
		expect(server.note).toBe("second");
	});

	test("what the queue prevents: sent at once, the edit lands first and the decision overwrites it", async () => {
		const { server, earlier, decide, edit } = household(undefined);
		const first = earlier.mutate();
		const decided = decide.mutate();
		const edited = edit.mutate();
		await edited;
		expect(server.sent).toEqual(["earlier", "edit"]);
		server.landEarlier();
		await Promise.all([first, decided]);
		expect(server.sent).toEqual(["earlier", "edit", "decision"]);
		expect(server.filedIn).toBe("groceries");
	});
});

describe("the version carried across writes waiting their turn (#85, ADR-0041)", () => {
	const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
	type Row = { id: string; version: number; filedIn: string | null };

	beforeEach(() => {
		forgetVersions();
		said.toast.mockClear();
	});

	/**
	 * A server that guards like the real one: a write lands only on the version it names, moves it
	 * on by one, and answers the new one; otherwise it answers the row as it is. The first write
	 * answers only when the test lets it, so the others wait their turn behind it.
	 */
	function household() {
		const queryClient = new QueryClient();
		const row: Row = { id: "t1", version: 0, filedIn: null };
		const server = { row, sent: [] as [string, number][], held: true, land: () => {} };
		const write = async (filedIn: string, expected: number): Promise<WriteAnswer<Row>> => {
			server.sent.push([filedIn, expected]);
			if (server.held) await new Promise<void>((resolve) => (server.land = resolve));
			server.held = false;
			if (row.version !== expected) return { status: "changed-elsewhere", current: { ...row } };
			row.version += 1;
			row.filedIn = filedIn;
			return { status: "saved", version: row.version };
		};
		/** A change made from `seen`: the row as the screen had it when the Parent made the change. */
		const change = (filedIn: string, seen: Pick<Row, "id" | "version">, atSendTime = true) =>
			new MutationObserver(queryClient, {
				mutationKey: ["month-change"],
				scope: reviewWrites,
				mutationFn: async () =>
					settleWrite(
						seen.id,
						await write(filedIn, atSendTime ? expectedVersionOf(seen) : seen.version),
					),
			});
		return { server, change };
	}

	test("each queued change to one Transaction goes with the version the one before it left", async () => {
		const { server, change } = household();
		// All three made from the same row on screen, at version 0, before any has answered.
		const seen = { id: "t1", version: 0 };
		const writes = ["groceries", "fun", "hockey"].map((place) => change(place, seen).mutate());
		await tick();
		expect(server.sent).toEqual([["groceries", 0]]);
		server.land();
		await Promise.all(writes);
		expect(server.sent).toEqual([
			["groceries", 0],
			["fun", 1],
			["hockey", 2],
		]);
		expect(server.row).toEqual({ id: "t1", version: 3, filedIn: "hockey" });
	});

	test("what that prevents: with the version it saw when queued, this screen refuses its own second change", async () => {
		const { server, change } = household();
		const seen = { id: "t1", version: 0 };
		const first = change("groceries", seen, false).mutate();
		const second = change("hockey", seen, false).mutate();
		await tick();
		server.land();
		await first;
		await expect(second).rejects.toBeInstanceOf(ChangedElsewhere);
		expect(server.row.filedIn).toBe("groceries");
	});

	test("an Undo goes with the version its decision left, not the card's", async () => {
		const { server, change } = household();
		const card = { id: "t1", version: 0 };
		const decided = change("groceries", card).mutate();
		const undone = change("review", card).mutate();
		await tick();
		server.land();
		await Promise.all([decided, undone]);
		expect(server.sent).toEqual([
			["groceries", 0],
			["review", 1],
		]);
	});

	test("changed on another screen first: every change waiting for it is refused, none written over it", async () => {
		const { server, change } = household();
		const seen = { id: "t1", version: 0 };
		const first = change("groceries", seen).mutate();
		const second = change("fun", seen).mutate();
		await tick();
		// The other Parent's change lands while this screen's first is on its way.
		server.row.version = 1;
		server.row.filedIn = "hockey";
		server.land();
		const refused = await first.catch((error: unknown) => error);
		expect(refused).toBeInstanceOf(ChangedElsewhere);
		expect((refused as ChangedElsewhere<Row>).current).toEqual({
			id: "t1",
			version: 1,
			filedIn: "hockey",
		});
		expect((refused as Error).message).toBe(CHANGED_ELSEWHERE);
		// The second doesn't catch up to the server's version and overwrite what it never saw.
		await expect(second).rejects.toBeInstanceOf(ChangedElsewhere);
		expect(server.sent).toEqual([
			["groceries", 0],
			["fun", 0],
		]);
		expect(server.row).toEqual({ id: "t1", version: 1, filedIn: "hockey" });
		// Once the screen shows the row as it is now, a change made on it lands.
		await change("fun", { id: "t1", version: 1 }).mutate();
		expect(server.row).toEqual({ id: "t1", version: 2, filedIn: "fun" });
	});

	test("the newer of the row's version and this screen's last write is sent", () => {
		expect(expectedVersionOf({ id: "t1", version: 2 })).toBe(2);
		noteVersion("t1", 4);
		expect(expectedVersionOf({ id: "t1", version: 2 })).toBe(4);
		// Refetched after the other Parent's change: the row is ahead of this screen's last write.
		expect(expectedVersionOf({ id: "t1", version: 6 })).toBe(6);
		expect(expectedVersionOf({ id: "t2", version: 0 })).toBe(0);
		// Deleted: nothing is remembered for it.
		settleWrite("t1", { status: "saved", version: null });
		expect(expectedVersionOf({ id: "t1", version: 2 })).toBe(2);
	});

	test("an open form starts again when another screen changes its Transaction, not for this screen's own save", () => {
		const opened = { id: "t1", version: 2, elsewhere: 0 };
		expect(formSeen(opened, { id: "t1", version: 2 })).toBe(opened);
		// The other Parent's change arrives while the form is open.
		expect(formSeen(opened, { id: "t1", version: 3 })).toEqual({
			id: "t1",
			version: 3,
			elsewhere: 1,
		});
		// This screen's own save answered 3: the refetched row at 3 is no news.
		noteVersion("t1", 3);
		expect(formSeen(opened, { id: "t1", version: 3 }).elsewhere).toBe(0);
		// Its own save and then the other Parent's: 4 is news.
		expect(formSeen(opened, { id: "t1", version: 4 }).elsewhere).toBe(1);
		// Another Transaction opened in the same pane starts from nothing.
		expect(formSeen({ ...opened, elsewhere: 2 }, { id: "t2", version: 0 })).toEqual({
			id: "t2",
			version: 0,
			elsewhere: 0,
		});
	});

	test("says it once for changes refused one after another, and counts what a batch left alone", () => {
		sayChangedElsewhere(100_000);
		sayChangedElsewhere(101_000);
		sayChangedElsewhere(104_999);
		expect(said.toast.mock.calls).toEqual([[CHANGED_ELSEWHERE]]);
		sayChangedElsewhere(105_000);
		expect(said.toast).toHaveBeenCalledTimes(2);
		expect(CHANGED_ELSEWHERE).toBe(
			"This Transaction was changed on another screen. Here’s how it looks now.",
		);
		expect(leftAsTheyAre(0)).toBe("");
		expect(leftAsTheyAre(1)).toBe("1 was changed elsewhere and left as it is.");
		expect(leftAsTheyAre(3)).toBe("3 were changed elsewhere and left as they are.");
	});
});

describe("a batch with cards another screen changed first (#85, ADR-0041)", () => {
	test("what was left as it is isn't counted as done, and Undo puts back only what was filed", () => {
		const c = { id: "c" };
		const filed = stackReducer(startStack<Card>(), { type: "decided", items: [a, b, c] });
		expect(filed.done).toBe(3);
		const left = stackReducer(filed, { type: "returned", items: [b] });
		expect(left.done).toBe(2);
		expect(left.history).toEqual([[a, c]]);
		// One decided on the other screen is no longer waiting: the stack is just what still waits.
		expect(stackOrder([{ id: "d" }], left).map((card) => card.id)).toEqual(["d"]);
		// A batch left out whole leaves nothing of this visit's to undo.
		const none = stackReducer(filed, { type: "returned", items: [a, b, c] });
		expect(none.done).toBe(0);
		expect(canUndo(none)).toBe(false);
	});
});
