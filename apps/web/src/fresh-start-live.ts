import { useSyncExternalStore } from "react";
import type { FreshStartProgress } from "./server/fresh-start-workflow";

export type { FreshStartProgress };

// A fresh start's progress as the Household Agent reports it (#63, ADR-0029), held outside React
// Query: clearing the Household refetches every query, and this has to outlive that.

let current: FreshStartProgress | null = null;
const listeners = new Set<() => void>();

export function setFreshStartProgress(progress: FreshStartProgress | null) {
	// A later step never goes back to an earlier one (messages can arrive out of order).
	if (progress && current && progress.id === current.id) {
		const rank = { running: 0, cleared: 1, done: 2 } as const;
		if (rank[progress.state] < rank[current.state]) return;
		if (progress.state === current.state && progress.step < current.step) return;
	}
	current = progress;
	for (const listener of listeners) listener();
}

export function useFreshStartProgress(): FreshStartProgress | null {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => current,
		() => null,
	);
}
