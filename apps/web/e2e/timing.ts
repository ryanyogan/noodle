/**
 * Times a step every test pays for (signing in, making the Household) and writes
 * `TIMING <label> <ms>` to the test's output. CI adds these up per label under "Slowest 20 tests",
 * so the cost of the shared steps can be read from a run's log.
 */
export async function timed<T>(label: string, step: () => Promise<T>): Promise<T> {
	const started = Date.now();
	try {
		return await step();
	} finally {
		if (process.env.CI) process.stdout.write(`TIMING ${label} ${Date.now() - started}\n`);
	}
}
