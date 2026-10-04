// Review's Sort view (#68): one card at a time. Which cards exist is the server's (the cached
// Review list, changed optimistically by the decisions in review.ts); this is only the stack's own
// state on top of it: what was skipped to the back, what Undo or a failed save put back on top,
// and what was decided this visit, for Undo and the finish screen. Pure, so every transition is
// tested (review-stack.test.ts).

export type StackState<T extends { id: string }> = {
	/** Skipped to the back, in the order they were skipped. */
	skipped: string[];
	/** Put back on top by Undo or a failed save, until it's decided or skipped again. */
	top: string | null;
	/** What was decided this visit, a batch as one entry: what Undo puts back, last first. */
	history: T[][];
	/** How many were decided this visit, less what came back. */
	done: number;
};

export type StackEvent<T extends { id: string }> =
	| { type: "decided"; items: T[] }
	| { type: "skipped"; id: string }
	/** The last decision undone: its cards go back, the first on top. */
	| { type: "undone" }
	/** A save failed: its cards are back in Review, the first on top. */
	| { type: "failed"; items: T[] }
	/** Cards put back by an Undo (the stack's or a toast's), wherever they are in the history. */
	| { type: "returned"; items: T[] };

export const startStack = <T extends { id: string }>(): StackState<T> => ({
	skipped: [],
	top: null,
	history: [],
	done: 0,
});

export function stackReducer<T extends { id: string }>(
	state: StackState<T>,
	event: StackEvent<T>,
): StackState<T> {
	switch (event.type) {
		case "decided": {
			if (event.items.length === 0) return state;
			const ids = new Set(event.items.map((item) => item.id));
			return {
				skipped: state.skipped.filter((id) => !ids.has(id)),
				top: state.top && ids.has(state.top) ? null : state.top,
				history: [...state.history, event.items],
				done: state.done + event.items.length,
			};
		}
		case "skipped":
			return {
				...state,
				skipped: [...state.skipped.filter((id) => id !== event.id), event.id],
				top: state.top === event.id ? null : state.top,
			};
		case "undone": {
			const last = state.history.at(-1);
			if (!last) return state;
			return {
				...state,
				top: last[0]?.id ?? state.top,
				history: state.history.slice(0, -1),
				done: Math.max(0, state.done - last.length),
			};
		}
		case "failed":
		case "returned": {
			const ids = new Set(event.items.map((item) => item.id));
			const history = state.history
				.map((entry) => entry.filter((item) => !ids.has(item.id)))
				.filter((entry) => entry.length > 0);
			const back = state.history.flat().length - history.flat().length;
			return {
				...state,
				top: event.items[0]?.id ?? state.top,
				history,
				done: Math.max(0, state.done - back),
			};
		}
	}
}

/**
 * The stack in order: `items` as given (the server's cards, newest first), the skipped ones moved
 * to the back in the order they were skipped, and what was put back on top first. A card filed
 * elsewhere (by the other Parent) is simply gone; a new one joins in its place in `items`.
 */
export function stackOrder<T extends { id: string }>(items: T[], state: StackState<T>): T[] {
	const skippedAt = new Map(state.skipped.map((id, at) => [id, at]));
	const fresh = items.filter((item) => !skippedAt.has(item.id));
	const skipped = items
		.filter((item) => skippedAt.has(item.id))
		.sort((a, b) => (skippedAt.get(a.id) ?? 0) - (skippedAt.get(b.id) ?? 0));
	const order = [...fresh, ...skipped];
	const top = order.findIndex((item) => item.id === state.top);
	if (top > 0) order.unshift(...order.splice(top, 1));
	return order;
}

/**
 * Where Sort is, "3 of 12": the card on top among everything this visit has seen. `waiting` is
 * how many wait in Review in all (not only the cards loaded), so the second number stays put as
 * cards are decided and the first goes up by one each time (#82).
 */
export function stackProgress<T extends { id: string }>(state: StackState<T>, waiting: number) {
	return { at: state.done + 1, of: state.done + Math.max(waiting, 1) };
}
