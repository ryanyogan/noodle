import * as React from "react";

const subscribe = () => () => {};

/**
 * False while server-rendered HTML is showing and React hasn't taken over yet, then true. A
 * control that only works through React (a Radix trigger) is disabled until then, so an early
 * click waits rather than being lost.
 */
export function useHydrated() {
	return React.useSyncExternalStore(
		subscribe,
		() => true,
		() => false,
	);
}
