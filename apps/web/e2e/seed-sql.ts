// Seeding (and reading) the local D1 through the Worker under test (/api/dev/sql, stub builds only)
// instead of `wrangler d1 execute --local`: a second process on the same SQLite file was slow and
// made D1 answer SQLITE_BUSY when several tests ran at once (#81).

// Matches playwright.config.ts.
const port = Number(process.env.PORT ?? 5173);

type Row = Record<string, string | number | null>;

/** Runs the statements in one batch (all or nothing); answers each statement's rows, in order. */
export async function seedSql(statements: string[]): Promise<Row[][]> {
	const response = await fetch(`http://localhost:${port}/api/dev/sql`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ statements }),
	});
	if (!response.ok)
		throw new Error(`Seeding failed (${response.status}): ${await response.text()}`);
	const { results } = (await response.json()) as { results: Row[][] };
	return results;
}
