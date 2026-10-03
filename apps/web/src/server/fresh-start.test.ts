import {
	clearedSince,
	countHouseholdRows,
	type Db,
	finishFreshStart,
	freshStartRunAt,
	GRACE_PERIOD_MS,
	type HouseholdTableName,
	learnedMerchants,
	linkedBankConnectionIds,
	recordLearnedMerchant,
	scheduleFreshStart,
	startFreshStartRun,
} from "@noodle/db";
import { buildSeed, type SeedOptions, type SeedRows, writeSeed } from "@noodle/db/seed";
import { testDb } from "@noodle/db/test-db";
import { beforeEach, describe, expect, it } from "vitest";
import type { BankConnectionProvider } from "./bank-connection";
import { vectorId } from "./categorize-model";
import { CLEARED_SINCE, clearedCheck, isClearedSince, stopIfCleared } from "./cleared-since";
import {
	type ClearDeps,
	clearAgentStorage,
	clearHousehold,
	filePrefixes,
	runClearStep,
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
const uploads = new Map<string, Date>();

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
			// The cursor is the last key listed, as R2's moves past keys (deleting doesn't shift it).
			const keys = [...files.keys()]
				.filter((k) => k.startsWith(o?.prefix ?? "") && (!o?.cursor || k > o.cursor))
				.sort();
			const limit = o?.limit ?? 1000;
			const page = keys.slice(0, limit);
			return {
				objects: page.map((key) => ({ key, uploaded: uploads.get(key) ?? new Date(0) })),
				truncated: keys.length > limit,
				cursor: page.at(-1),
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

describe("the sweep after a clear", () => {
	it("removes files uploaded before the clear finished and keeps those uploaded after", async () => {
		const clearedAt = new Date("2026-10-01T12:00:00Z");
		files.set(`${a}/old.pdf`, "old");
		uploads.set(`${a}/old.pdf`, new Date("2026-10-01T11:59:00Z"));
		files.set(`${a}/new.pdf`, "new");
		uploads.set(`${a}/new.pdf`, new Date("2026-10-01T12:01:00Z"));
		await runClearStep(deps(), "files", a, "fresh-start", clearedAt);
		expect(filesOf(a)).toEqual([`${a}/new.pdf`]);
		expect(filesOf(b)).toHaveLength(1011);
	});
});

describe("work begun before a fresh start", () => {
	const fresh = (id: string, now: number) =>
		scheduleFreshStart(db, {
			id,
			householdId: a,
			level: "fresh-start",
			requestedBy: "x",
			runAt: now,
			now,
		});

	it("is cleared while the clear runs, and after it finished, but not by one finished before", async () => {
		const began = Date.parse("2026-10-01T12:00:00Z");
		expect(await clearedSince(db, a, began)).toBe(false);
		await fresh("FS1", began - 60_000);
		await startFreshStartRun(db, "FS1");
		expect(await clearedSince(db, a, began)).toBe(true);
		expect(await clearedSince(db, b, began)).toBe(false);
		await finishFreshStart(db, "FS1", began - 1000);
		expect(await clearedSince(db, a, began)).toBe(false);
		expect(await clearedSince(db, a, began - 5000)).toBe(true);
	});

	it("stops a Workflow before its next write once the Household was cleared", async () => {
		const began = new Date(Date.now() - 60_000);
		const writes: string[] = [];
		const step = { do: async (_name: string, callback: () => Promise<void>) => callback() };
		const guarded = stopIfCleared(step, clearedCheck(db, a, began));
		await guarded.do("first", async () => {
			writes.push("first");
		});
		await fresh("FS2", began.getTime());
		await startFreshStartRun(db, "FS2");
		await finishFreshStart(db, "FS2", Date.now());
		const second = guarded.do("second", async () => {
			writes.push("second");
		});
		await expect(second).rejects.toThrow(CLEARED_SINCE);
		await second.catch((error) => expect(isClearedSince(error)).toBe(true));
		expect(writes).toEqual(["first"]);
	});

	it("runs every step for a Household never cleared, on a step that is an RPC stub", async () => {
		// workerd hands a Workflow its step as an RPC stub: each property is a remote method, so
		// `step.do.call(…)` or `.bind(…)` asks the engine for a method named "call" or "bind".
		const calls: unknown[][] = [];
		const methods: Record<string, (...args: unknown[]) => Promise<unknown>> = {
			do: async (...args) => {
				calls.push(["do", ...args.slice(0, -1)]);
				return (args.at(-1) as () => Promise<unknown>)();
			},
			sleep: async (...args) => {
				calls.push(["sleep", ...args]);
			},
		};
		const remote = (name: string) =>
			new Proxy((...args: unknown[]) => methods[name]?.(...args), {
				get: (_, prop) => () => {
					throw new TypeError(`The RPC receiver does not implement the method "${String(prop)}".`);
				},
			});
		const step = new Proxy({} as { do: (...args: never[]) => Promise<unknown> }, {
			get: (_, prop) => remote(String(prop)),
		});
		const began = new Date();
		expect(await clearedCheck(db, a, began)()).toBe(false);
		const guarded = stopIfCleared(step, clearedCheck(db, a, began)) as unknown as Record<
			string,
			(...args: unknown[]) => Promise<unknown>
		>;
		expect(await guarded.do?.("build", { retries: { limit: 2 } }, async () => "zip")).toBe("zip");
		expect(await guarded.do?.("tell", async () => "told")).toBe("told");
		await guarded.sleep?.("wait", "1 second");
		expect(calls).toEqual([
			["do", "build", { retries: { limit: 2 } }],
			["do", "tell"],
			["sleep", "wait", "1 second"],
		]);
	});
});

describe("when a fresh start runs", () => {
	it("runs at once with one Parent and a day later with two", () => {
		const now = Date.parse("2026-10-01T12:00:00Z");
		expect(freshStartRunAt(now, 0)).toBe(now);
		expect(freshStartRunAt(now, 1)).toBe(now + GRACE_PERIOD_MS);
		expect(GRACE_PERIOD_MS).toBe(24 * 60 * 60 * 1000);
	});
});
