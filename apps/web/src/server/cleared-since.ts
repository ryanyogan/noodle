import { clearedSince, type Db } from "@noodle/db";

// Background work that began before a fresh start (#63, ADR-0029): an Import, a month close, Perk
// research, setup or a download checks before each step whether the Household was cleared since
// it began, and stops quietly if so, rather than writing the old Household into the new one.

export const CLEARED_SINCE = "The Household was cleared after this work began";

type Step = { do: (...args: never[]) => Promise<unknown> };

/** Is `error` the stop thrown by a step of `stopIfCleared`? (Workflows rebuild it from its message.) */
export const isClearedSince = (error: unknown) =>
	error instanceof Error && error.message.includes(CLEARED_SINCE);

/** The check for work begun at `startedAt` for this Household. */
export const clearedCheck = (db: Db, householdId: string, startedAt: Date) => () =>
	clearedSince(db, householdId, startedAt.getTime());

/**
 * `step`, with each `do` first checking whether the Household was cleared; if so it throws
 * `stop(CLEARED_SINCE)` (a Workflow's NonRetryableError) instead of writing.
 */
export function stopIfCleared<S extends Step>(
	step: S,
	cleared: () => Promise<boolean>,
	stop: (message: string) => Error = (message) => new Error(message),
): S {
	// In workerd `step` is an RPC stub: every property is a remote method, so `step.do.call(…)` or
	// `.bind(…)` would ask the Workflow engine for a method named "call" or "bind". Always call
	// `step.<method>(…)` as a method instead.
	type Method = (...args: unknown[]) => Promise<unknown>;
	const target = step as unknown as { do: Method } & Record<PropertyKey, Method | undefined>;
	const guarded = (name: string, ...rest: unknown[]) => {
		const callback = rest.pop() as (...args: unknown[]) => Promise<unknown>;
		return target.do(name, ...rest, async (...args: unknown[]) => {
			if (await cleared()) throw stop(CLEARED_SINCE);
			return callback(...args);
		});
	};
	return new Proxy(step, {
		get(_, prop) {
			if (prop === "do") return guarded;
			const value = target[prop];
			return typeof value === "function" ? (...args: unknown[]) => target[prop]?.(...args) : value;
		},
	});
}
