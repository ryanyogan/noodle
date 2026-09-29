import { useSyncExternalStore } from "react";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

/**
 * Whether the Parent asked for less motion. Assumed so on the server and until hydration, so
 * nothing moves (or offers a gesture) before the browser has said.
 */
export function useReducedMotion() {
	return useSyncExternalStore(
		(onChange) => {
			const query = window.matchMedia(reducedMotionQuery);
			query.addEventListener("change", onChange);
			return () => query.removeEventListener("change", onChange);
		},
		() => window.matchMedia(reducedMotionQuery).matches,
		() => true,
	);
}
