import { describe, expect, test } from "vitest";
import { type StackState, stackOrder, stackReducer, startStack } from "./review-stack";

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
