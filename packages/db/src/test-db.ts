import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import type { Db } from "./index";
import * as schema from "./schema";

/** D1 allows 100 bound parameters a statement. */
const D1_MAX_PARAMETERS = 100;

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
	return sqliteDb(sqlite);
}

/**
 * The same Db over an open SQLite database: in-memory for tests, or the local D1's own file for
 * the seed script (apps/web/scripts/seed.ts).
 */
export function sqliteDb(sqlite: DatabaseSync): Db {
	const run = (query: string, params: unknown[], method: Method) => {
		// D1 refuses a statement with more than 100 bound parameters; plain SQLite takes thousands.
		if (params.length > D1_MAX_PARAMETERS) {
			throw new Error(
				`too many SQL variables: ${params.length} bound parameters, D1 allows ${D1_MAX_PARAMETERS}`,
			);
		}
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
				const results = queries.map(({ sql, params, method }) => {
					refuseSameNamedColumns(sqlite, sql);
					return run(sql, params, method);
				});
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

/**
 * D1 hands a batch its rows keyed by column name, and Drizzle reads them back in that order
 * (`d1ToRawMapping` in drizzle-orm/d1/session.js). Two columns of one name (`transactions.id`
 * beside `commitments.id`, or the same unnamed expression twice) collapse into one there and
 * every column after them shifts, so the Worker reads wrong values where this database, which
 * reads rows as arrays, would read the right ones. A batch like that is refused here instead:
 * select the column under another name (`sql\`...\`.as("name")`), or one that isn't a twin.
 */
function refuseSameNamedColumns(sqlite: DatabaseSync, query: string) {
	const names = sqlite
		.prepare(query)
		.columns()
		.map((column) => column.name);
	const twice = [...new Set(names.filter((name, at) => names.indexOf(name) !== at))];
	if (twice.length > 0)
		throw new Error(
			`A batch can't read two columns named ${twice.map((name) => `"${name}"`).join(", ")}: D1 would collapse them. ${query}`,
		);
}
