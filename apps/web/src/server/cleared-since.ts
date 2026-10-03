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
	const run = step.do as unknown as (...args: unknown[]) => Promise<unknown>;
	const guarded = (name: string, ...rest: unknown[]) => {
		const callback = rest.pop() as (...args: unknown[]) => Promise<unknown>;
		return run.call(step, name, ...rest, async (...args: unknown[]) => {
			if (await cleared()) throw stop(CLEARED_SINCE);
			return callback(...args);
		});
	};
	return new Proxy(step, {
		get(target, prop) {
			if (prop === "do") return guarded;
			const value = Reflect.get(target, prop);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
