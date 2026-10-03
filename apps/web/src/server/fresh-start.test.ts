import {
	countHouseholdRows,
	type Db,
	type HouseholdTableName,
	learnedMerchants,
	linkedBankConnectionIds,
	recordLearnedMerchant,
} from "@noodle/db";
import { buildSeed, type SeedOptions, type SeedRows, writeSeed } from "@noodle/db/seed";
import { testDb } from "@noodle/db/test-db";
import { beforeEach, describe, expect, it } from "vitest";
import type { BankConnectionProvider } from "./bank-connection";
import { vectorId } from "./categorize-model";
import {
	type ClearDeps,
	clearAgentStorage,
	clearHousehold,
	filePrefixes,
} from "./fresh-start-clear";

// A fresh start clears the Household from every store (#63): D1, R2, Vectorize and the Agent's
// storage, with Plaid told to remove each link, and leaves another Household alone.

const options = (suffix: string): SeedOptions =>
	({
		today: "2026-09-30",
		now: Date.parse("2026-09-30T18:00:00Z"),
		timeZone: "America/Los_Angeles",
		parents: [
			{ clerkUserId: `user_alex${suffix}`, name: "Alex", email: `alex${suffix}@example.com` },
			{ clerkUserId: `user_sam${suffix}`, name: "Sam", email: `sam${suffix}@example.com` },
		],
	}) as SeedOptions;

/** The same busy Household under other IDs, so two can live in one database. */
function otherIds(rows: SeedRows): SeedRows {
	const swap = (value: unknown) =>
		typeof value === "string" && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)
			? `Z${value.slice(1)}`
			: value;
	return Object.fromEntries(
		Object.entries(rows).map(([name, list]) => [
			name,
			(list as Record<string, unknown>[]).map((row) =>
				Object.fromEntries(
					Object.entries(row).map(([k, v]) => [
						k,
						k === "receiptAddress" && typeof v === "string" ? `${v}x` : swap(v),
					]),
				),
			),
		]),
	) as unknown as SeedRows;
}

type Storage = { data: Map<string, unknown>; alarm: number | null };

let db: Db;
let a: string;
let b: string;
let files: Map<string, string>;
let vectors: Set<string>;
let storages: Map<string, Storage>;
let removed: string[];

const provider = {
	remove: async (credential: string) => {
		removed.push(credential);
	},
} as unknown as BankConnectionProvider;

const storageFor = (id: string) => {
	const storage = storages.get(id) ?? { data: new Map(), alarm: null };
	storages.set(id, storage);
	return storage;
};

const deps = (): ClearDeps => ({
	db,
	files: {
		list: async (o?: R2ListOptions) => {
			const keys = [...files.keys()].filter((k) => k.startsWith(o?.prefix ?? "")).sort();
			const limit = o?.limit ?? 1000;
			return {
				objects: keys.slice(0, limit).map((key) => ({ key })),
				truncated: keys.length > limit,
				delimitedPrefixes: [],
			} as unknown as R2Objects;
		},
		delete: async (keys: string | string[]) => {
			for (const key of [keys].flat()) files.delete(key);
		},
	},
	merchants: {
		deleteByIds: async (ids: string[]) => {
			for (const id of ids) vectors.delete(id);
		},
	},
	agent: (id) => ({
		clearHousehold: () => {
			const storage = storageFor(id);
			return clearAgentStorage({
				deleteAlarm: async () => {
					storage.alarm = null;
				},
				deleteAll: async () => storage.data.clear(),
			});
		},
	}),
	bank: { providerFor: () => provider, openCredential: async (c) => `opened:${c.id}` },
});

const counts = (householdId: string) => countHouseholdRows(db, householdId);

/** Puts something for the Household in R2, Vectorize and the Agent, as the app would. */
async function fillStores(householdId: string) {
	for (const prefix of filePrefixes(householdId)) {
		// More than a page of statements, so listing goes round.
		for (let i = 0; i < (prefix === `${householdId}/` ? 1005 : 3); i++)
			files.set(`${prefix}${i}.pdf`, "x");
	}
	await recordLearnedMerchant(db, householdId, "corner bakery");
	for (const merchant of await learnedMerchants(db, householdId)) {
		vectors.add(await vectorId(householdId, merchant));
	}
	const storage = storageFor(householdId);
	storage.data.set("nudges:pending", { checkPace: true });
	storage.data.set("ai:held", { householdId });
	storage.alarm = Date.now() + 60_000;
}

const filesOf = (householdId: string) =>
	[...files.keys()].filter((k) => filePrefixes(householdId).some((p) => k.startsWith(p)));
const vectorsOf = (householdId: string) =>
	[...vectors].filter((id) => id.startsWith(`${householdId}:`));

beforeEach(async () => {
	db = testDb();
	files = new Map();
	vectors = new Set();
	storages = new Map();
	removed = [];
	const first = buildSeed("busy", options(""));
	const second = otherIds(buildSeed("busy", options("2")));
	await writeSeed(db, first);
	await writeSeed(db, second);
	a = first.households[0]?.id as string;
	b = second.households[0]?.id as string;
	await fillStores(a);
	await fillStores(b);
});

describe("a fresh start", () => {
	it("clears every store for the Household and keeps it, its Parents and Children", async () => {
		const before = await counts(a);
		const theirs = await counts(b);
		const linked = await linkedBankConnectionIds(db, a);
		expect(before.transactions).toBeGreaterThan(0);
		expect(vectorsOf(a).length).toBeGreaterThan(1);

		await clearHousehold(deps(), a, "fresh-start");

		const after = await counts(a);
		for (const [name, n] of Object.entries(after)) {
			const kept = name === "households" || name === "members" || name === "freshStarts";
			expect(n, name).toBe(kept ? before[name as HouseholdTableName] : 0);
		}
		expect(after.households).toBe(1);
		expect(after.members).toBeGreaterThanOrEqual(2);
		expect(removed).toHaveLength(linked.length);
		expect(filesOf(a)).toEqual([]);
		expect(vectorsOf(a)).toEqual([]);
		expect(storageFor(a)).toEqual({ data: new Map(), alarm: null });

		// The other Household is untouched.
		expect(await counts(b)).toEqual(theirs);
		expect(filesOf(b)).toHaveLength(1011);
		expect(vectorsOf(b).length).toBeGreaterThan(1);
		expect(storageFor(b).data.size).toBe(2);
		expect(storageFor(b).alarm).not.toBeNull();
	});

	it("runs again safely, finding nothing more to clear", async () => {
		await clearHousehold(deps(), a, "fresh-start");
		await clearHousehold(deps(), a, "fresh-start");
		expect((await counts(a)).transactions).toBe(0);
	});
});

describe("Delete Household", () => {
	it("removes the Household and its membership too", async () => {
		const theirs = await counts(b);
		await clearHousehold(deps(), a, "delete");
		for (const [name, n] of Object.entries(await counts(a))) expect(n, name).toBe(0);
		expect(filesOf(a)).toEqual([]);
		expect(vectorsOf(a)).toEqual([]);
		expect(await counts(b)).toEqual(theirs);
	});
});
