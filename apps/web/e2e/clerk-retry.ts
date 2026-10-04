const MAX_TRIES = 5;
const MAX_WAIT_MS = 30_000;

/** True when Clerk said "slow down" (429) or failed on its side (5xx): worth asking again. */
function busy(error: unknown) {
	const status = Number((error as { status?: unknown })?.status);
	if (status === 429 || (status >= 500 && status < 600)) return true;
	return /too many requests/i.test(error instanceof Error ? error.message : String(error));
}

/**
 * Runs a call to Clerk's Backend API, again when Clerk answers 429 or 5xx: several CI runs share
 * one development instance and its rate limit (#81). Waits as long as `Retry-After` says, else
 * 0.5 s doubling, at most five tries and 30 s in all; any other error is thrown at once.
 */
export async function clerkRetry<T>(call: () => Promise<T>): Promise<T> {
	const started = Date.now();
	for (let attempt = 1; ; attempt++) {
		try {
			return await call();
		} catch (error) {
			const retryAfter = Number((error as { retryAfter?: unknown })?.retryAfter);
			const wait =
				Math.min(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1), 10_000) +
				Math.random() * 250;
			if (!busy(error) || attempt >= MAX_TRIES || Date.now() - started + wait > MAX_WAIT_MS)
				throw error;
			if (process.env.CI) process.stdout.write(`CLERK-RETRY ${attempt}\n`);
			await new Promise((resolve) => setTimeout(resolve, wait));
		}
	}
}

/** Deletes a Clerk user, retrying like `clerkRetry`; one already gone (404) counts as deleted. */
export async function deleteClerkUser(
	clerk: { users: { deleteUser(id: string): Promise<unknown> } },
	userId: string,
) {
	await clerkRetry(() =>
		clerk.users.deleteUser(userId).catch((error: unknown) => {
			if (Number((error as { status?: unknown })?.status) !== 404) throw error;
		}),
	);
}
