import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_TABLES, tablesToClear } from "./fresh-start";
import * as s from "./schema";

// A fresh start must clear every table a Household's data lives in (#63). This finds them from the
// schema: any table with a household_id, or with a foreign key to one that has.

const tables = Object.values(s).filter((v) => is(v, SQLiteTable)) as SQLiteTable[];
const nameOf = (table: SQLiteTable) => getTableConfig(table).name;

function householdScoped(): Set<string> {
	const scoped = new Set(["households"]);
	for (const table of tables) {
		if (getTableConfig(table).columns.some((c) => c.name === "household_id"))
			scoped.add(nameOf(table));
	}
	// Reachable through one: a table pointing at a household-scoped table holds its data too.
	for (let grew = true; grew; ) {
		grew = false;
		for (const table of tables) {
			const name = nameOf(table);
			if (scoped.has(name)) continue;
			const refs = getTableConfig(table).foreignKeys.map((fk) =>
				nameOf(fk.reference().foreignTable as SQLiteTable),
			);
			if (refs.some((ref) => scoped.has(ref))) {
				scoped.add(name);
				grew = true;
			}
		}
	}
	return scoped;
}

describe("the fresh start's tables", () => {
	const listed = Object.values(HOUSEHOLD_TABLES).map(nameOf);

	it("lists every household-scoped table in the schema", () => {
		expect([...householdScoped()].filter((name) => !listed.includes(name))).toEqual([]);
	});

	it("can find each listed table's rows by household", () => {
		for (const table of Object.values(HOUSEHOLD_TABLES)) {
			const name = nameOf(table);
			const columns = getTableConfig(table).columns.map((c) => c.name);
			expect(columns, name).toContain(name === "households" ? "id" : "household_id");
		}
	});

	it("clears a table only after every table pointing at it", () => {
		const order = tablesToClear("delete").map((key) => nameOf(HOUSEHOLD_TABLES[key]));
		for (const table of Object.values(HOUSEHOLD_TABLES)) {
			for (const fk of getTableConfig(table).foreignKeys) {
				const target = nameOf(fk.reference().foreignTable as SQLiteTable);
				// The Household's emergency Goal is set to null first.
				if (target === nameOf(table) || (nameOf(table) === "households" && target === "goals"))
					continue;
				expect(order.indexOf(nameOf(table)), `${nameOf(table)} → ${target}`).toBeLessThan(
					order.indexOf(target),
				);
			}
		}
	});

	it("keeps the Household, its Parents and Children on a fresh start, and removes them on delete", () => {
		expect(tablesToClear("fresh-start")).not.toContain("members");
		expect(tablesToClear("fresh-start")).not.toContain("households");
		expect(tablesToClear("delete").at(-1)).toBe("households");
	});
});
