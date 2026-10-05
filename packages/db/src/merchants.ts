import { bankMerchantKey } from "@noodle/domain";
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "./index";
import { merchantNames, transactions } from "./schema";
import { editableBy } from "./transactions";

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
	// Never under a Parent's key: the names Parents gave are theirs alone to change.
	const kept = names.filter(({ raw }) => !raw.startsWith(PARENT_NAME));
	// Three bound parameters a row.
	for (let i = 0; i < kept.length; i += 30) {
		const part = kept.slice(i, i + 30);
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

// Names Parents gave (#95, ADR-0043). `merchant_names` has no column for who gave a name, so a
// Parent's is kept under `parent<tab>` + the merchant's bankMerchantKey, where a raw statement line
// (which is what background AI's names are kept under) never is. Background AI never writes these.

/** What a Parent's name for a merchant is kept under, before the merchant's bankMerchantKey. */
export const PARENT_NAME = "parent\t";

/** The names the Household's Parents gave merchants, by bankMerchantKey. */
export async function loadParentNames(db: Db, householdId: string): Promise<Map<string, string>> {
	const rows = await db
		.select({ raw: merchantNames.raw, name: merchantNames.name })
		.from(merchantNames)
		.where(
			and(
				eq(merchantNames.householdId, householdId),
				sql`substr(${merchantNames.raw}, 1, ${PARENT_NAME.length}) = ${PARENT_NAME}`,
			),
		);
	return new Map(rows.map((row) => [row.raw.slice(PARENT_NAME.length), row.name]));
}

/** Remembers a Parent's name for a merchant, over any they gave it before. Idempotent. */
export async function saveParentName(
	db: Db,
	householdId: string,
	key: string,
	name: string,
): Promise<void> {
	await db
		.insert(merchantNames)
		.values({ householdId, raw: PARENT_NAME + key, name })
		.onConflictDoUpdate({ target: [merchantNames.householdId, merchantNames.raw], set: { name } });
}

type SameMerchant = { householdId: string; memberId: string; transactionId: string; name: string };

/**
 * The imported Transaction's merchant (its bankMerchantKey) and every raw line the Household has
 * from it; null when it isn't an imported line with the bank's wording.
 */
async function sameMerchantLines(db: Db, input: SameMerchant) {
	const imported = and(
		eq(transactions.householdId, input.householdId),
		eq(transactions.source, "import"),
		isNotNull(transactions.note),
		ne(transactions.note, ""),
	);
	const [row] = await db
		.select({ note: transactions.note })
		.from(transactions)
		.where(and(imported, eq(transactions.id, input.transactionId)));
	if (!row?.note) return null;
	const key = bankMerchantKey(row.note);
	const notes = await db
		.selectDistinct({ note: transactions.note })
		.from(transactions)
		.where(imported);
	return {
		key,
		notes: notes
			.map((other) => other.note as string)
			.filter((note) => bankMerchantKey(note) === key),
	};
}

/** The other lines from the merchant this Parent may change that don't go by `name` yet. */
const others = (input: SameMerchant, notes: string[]) =>
	and(
		eq(transactions.source, "import"),
		inArray(transactions.note, notes),
		ne(transactions.id, input.transactionId),
		editableBy(input.householdId, input.memberId),
		or(isNull(transactions.merchant), ne(transactions.merchant, input.name)),
	);

/**
 * How many other Transactions from the same merchant as this imported one a Parent could call
 * `name` too: only those theirs to change, so it counts nothing in the other Parent's Personal
 * Allowance (ADR-0003).
 */
export async function countSameMerchant(db: Db, input: SameMerchant): Promise<number> {
	const same = await sameMerchantLines(db, input);
	if (!same) return 0;
	let count = 0;
	for (const part of chunks(same.notes)) {
		const [row] = await db
			.select({ count: sql<number>`count(*)` })
			.from(transactions)
			.where(others(input, part));
		count += row?.count ?? 0;
	}
	return count;
}

/**
 * Calls every other Transaction from the same merchant as this imported one `name`, and remembers
 * the name for the merchant's later Imports. The bank's wording (the note) is untouched, so Rules
 * and what Review learned still match. Idempotent. Says how many it renamed; null when the
 * Transaction isn't an imported line.
 */
export async function nameSameMerchant(db: Db, input: SameMerchant): Promise<number | null> {
	const same = await sameMerchantLines(db, input);
	if (!same) return null;
	const renamed = await countSameMerchant(db, input);
	await saveParentName(db, input.householdId, same.key, input.name);
	for (const part of chunks(same.notes)) {
		await db.update(transactions).set({ merchant: input.name }).where(others(input, part));
	}
	return renamed;
}
