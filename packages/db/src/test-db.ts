import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import type { Db } from "./index";
import * as schema from "./schema";

type Method = "run" | "all" | "values" | "get";

/**
 * A fresh in-memory SQLite database with every migration applied, standing in for D1 in unit
 * tests. D1 is SQLite too, so the SQL these tests run is the SQL the Worker runs.
 */
export function testDb(): Db {
	const sqlite = new DatabaseSync(":memory:");
	const migrations = join(import.meta.dirname, "..", "drizzle");
	for (const file of readdirSync(migrations)
		.filter((name) => name.endsWith(".sql"))
		.sort()) {
		sqlite.exec(readFileSync(join(migrations, file), "utf8"));
	}
	const run = (query: string, params: unknown[], method: Method) => {
		const statement = sqlite.prepare(query);
		const values = params as SQLInputValue[];
		if (method === "run") {
			statement.run(...values);
			return { rows: [] };
		}
		statement.setReturnArrays(true);
		// Drizzle expects rows as arrays of values: all of them, or the one row for `get`.
		const rows = method === "get" ? statement.get(...values) : statement.all(...values);
		return { rows: rows as unknown[] };
	};
	const db = drizzle(
		async (query, params, method) => run(query, params, method),
		async (queries) => {
			// D1 runs a batch atomically; so does this.
			sqlite.exec("begin");
			try {
				const results = queries.map(({ sql, params, method }) => run(sql, params, method));
				sqlite.exec("commit");
				return results;
			} catch (error) {
				sqlite.exec("rollback");
				throw error;
			}
		},
		{ schema },
	);
	// Same query builder and dialect as the D1 driver; only the transport differs.
	return db as unknown as Db;
}
