import { request } from "@playwright/test";

// Seeding (and reading) the local D1 through the Worker under test (/api/dev/sql, stub builds only)
// instead of `wrangler d1 execute --local`: a second process on the same SQLite file was slow and
// made D1 answer SQLITE_BUSY when several tests ran at once (#81).

// Matches playwright.config.ts.
const port = Number(process.env.PORT ?? 5173);

type Row = Record<string, string | number | null>;

/** Runs the statements in one batch (all or nothing); answers each statement's rows, in order. */
export async function seedSql(statements: string[]): Promise<Row[][]> {
	// Playwright's client, not Node's fetch: in CI's container the server listens on ::1 only, and
	// Node's fetch tried 127.0.0.1 for "localhost" and was refused.
	const api = await request.newContext({ baseURL: `http://localhost:${port}` });
	try {
		const response = await api.post("/api/dev/sql", { data: { statements } });
		if (!response.ok()) {
			throw new Error(`Seeding failed (${response.status()}): ${await response.text()}`);
		}
		const { results } = (await response.json()) as { results: Row[][] };
		return results;
	} finally {
		await api.dispose();
	}
}
