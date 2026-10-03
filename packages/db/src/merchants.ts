import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import type { Db } from "./index";
import { merchantNames, transactions } from "./schema";

// Merchant names (ADR-0027): imported lines get a clean `merchant` from their note, in background
// AI's first step (merchant-run.ts). Quick Adds keep their note as the Parent typed it.

/** D1 allows 100 bound parameters a statement. */
const CHUNK = 90;

const chunks = <T>(items: T[]): T[][] =>
	Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) =>
		items.slice(i * CHUNK, (i + 1) * CHUNK),
	);

const unnamed = (householdId: string) =>
	and(
		eq(transactions.householdId, householdId),
		eq(transactions.source, "import"),
		isNull(transactions.merchant),
		isNotNull(transactions.note),
		ne(transactions.note, ""),
	);

/** Up to `limit` distinct raw notes of the Household's imported lines not named yet, newest first. */
export async function loadUnnamedNotes(
	db: Db,
	householdId: string,
	limit: number,
): Promise<string[]> {
	const rows = await db
		.select({ note: transactions.note, last: sql<string>`max(${transactions.date})` })
		.from(transactions)
		.where(unnamed(householdId))
		.groupBy(transactions.note)
		.orderBy(sql`max(${transactions.date}) desc`)
		.limit(limit);
	return rows.map((row) => row.note as string);
}

/** Whether the Household has imported lines not named yet: what the backfill is for. */
export async function hasUnnamedMerchants(db: Db, householdId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: transactions.id })
		.from(transactions)
		.where(unnamed(householdId))
		.limit(1);
	return row !== undefined;
}

/** The names the model settled before for these raw notes, by raw note. */
export async function loadMerchantNames(
	db: Db,
	householdId: string,
	raws: string[],
): Promise<Map<string, string>> {
	const found = new Map<string, string>();
	for (const part of chunks(raws)) {
		const rows = await db
			.select({ raw: merchantNames.raw, name: merchantNames.name })
			.from(merchantNames)
			.where(and(eq(merchantNames.householdId, householdId), inArray(merchantNames.raw, part)));
		for (const row of rows) found.set(row.raw, row.name);
	}
	return found;
}

/** Keeps the model's names for raw notes; a name already kept stays. */
export async function saveMerchantNames(
	db: Db,
	householdId: string,
	names: { raw: string; name: string }[],
): Promise<void> {
	// Three bound parameters a row.
	for (let i = 0; i < names.length; i += 30) {
		const part = names.slice(i, i + 30);
		await db
			.insert(merchantNames)
			.values(part.map(({ raw, name }) => ({ householdId, raw, name })))
			.onConflictDoNothing();
	}
}

/**
 * Names the Household's imported lines with these raw notes, where not named yet: one statement per
 * name. Idempotent: a named line is never renamed here.
 */
export async function nameTransactions(
	db: Db,
	householdId: string,
	names: Map<string, string>,
): Promise<void> {
	const byName = new Map<string, string[]>();
	for (const [raw, name] of names) byName.set(name, [...(byName.get(name) ?? []), raw]);
	for (const [name, raws] of byName) {
		for (const part of chunks(raws)) {
			await db
				.update(transactions)
				.set({ merchant: name })
				.where(and(unnamed(householdId), inArray(transactions.note, part)));
		}
	}
}
