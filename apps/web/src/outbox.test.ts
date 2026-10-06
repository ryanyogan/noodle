import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
	MAX_AGE_MS,
	MAX_TRIES,
	MAX_WAITING,
	openOutbox,
	outboxKey,
	type Resend,
	type Store,
	waitingIn,
} from "./outbox";
import {
	carryVersions,
	expectedVersionOf,
	forgetVersions,
	noteVersion,
	settleWrite,
} from "./transaction-versions";

const who = { householdId: "house", parentId: "ryan" };
const key = outboxKey(who);
const queue = { id: "one-at-a-time" };

/** `localStorage` as a Map. */
function memory(initial: Record<string, string> = {}): Store & { data: Map<string, string> } {
	const data = new Map(Object.entries(initial));
	return {
		data,
		get length() {
			return data.size;
		},
		key: (i) => [...data.keys()][i] ?? null,
		getItem: (name) => data.get(name) ?? null,
		setItem: (name, value) => void data.set(name, value),
		removeItem: (name) => void data.delete(name),
	};
}

/** Lets the queue's own promises run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A server: every request waits until it is answered by hand. */
function server() {
	const sent: { what: unknown; answer: (how?: unknown) => void }[] = [];
	const send = (what: unknown) =>
		new Promise<void>((resolve, reject) => {
			sent.push({ what, answer: (how) => (how === undefined ? resolve() : reject(how)) });
		});
	return { sent, send, names: () => sent.map((request) => request.what) };
}

/** A page: its own QueryClient, with the outbox open on `store`. */
function page(
	store: Store | null,
	send: (what: unknown) => Promise<void>,
	options: {
		leaving?: () => boolean;
		as?: typeof who;
		resend?: () => Resend | null;
		carry?: (kind: string, variables: unknown) => unknown;
		expired?: (count: number) => void;
		now?: () => number;
	} = {},
) {
	const queryClient = new QueryClient();
	const failed: unknown[] = [];
	const again: Resend = { scope: queue, mutationFn: send, onError: (e) => void failed.push(e) };
	const close = openOutbox({
		queryClient,
		who: options.as ?? who,
		store,
		resend: options.resend ?? (() => again),
		refused: (error) => error === "changed-elsewhere",
		leaving: options.leaving,
		carry: options.carry,
		expired: options.expired,
		now: options.now,
	});
	const make = (what: string, meta: Record<string, unknown> = { outbox: "change" }) =>
		queryClient
			.getMutationCache()
			.build(queryClient, { scope: queue, meta, mutationFn: send })
			.execute(what)
			.then(
				() => "saved",
				() => "failed",
			);
	return { queryClient, make, close, failed };
}

const kept = (store: Store | null) => waitingIn(store, key).map((entry) => entry.variables);

describe("changes written down until the server answers (issue 128)", () => {
	it("are written down as they are made, in order, and crossed off as each is answered", async () => {
		const store = memory();
		const { sent, send, names } = server();
		const { make } = page(store, send);
		void make("first");
		void make("second");
		void make("not one of these", {});
		// Written down at once, before anything is sent.
		expect(kept(store)).toEqual(["first", "second"]);
		await tick();
		expect(names()).toEqual(["first"]);

		sent[0]?.answer();
		await tick();
		expect(kept(store)).toEqual(["second"]);
		sent[1]?.answer();
		await tick();
		expect(kept(store)).toEqual([]);
		expect(store.data.has(key)).toBe(false);
	});

	it("are sent again by the next page, one at a time in the order they were made", async () => {
		const store = memory();
		const before = server();
		const old = page(store, before.send);
		void old.make("first");
		void old.make("second");
		void old.make("third");
		await tick();
		// The page goes: the first was on its way, the others had not been sent.
		expect(before.names()).toEqual(["first"]);

		const { sent, send, names } = server();
		const next = page(store, send);
		void next.make("made on the new page");
		await tick();
		expect(names()).toEqual(["first"]);
		// Still written down, in their places, until answered.
		expect(kept(store)).toEqual(["first", "second", "third", "made on the new page"]);
		// The first did land and only its answer was lost: the server says saved to the repeat.
		sent[0]?.answer();
		await tick();
		expect(names()).toEqual(["first", "second"]);
		sent[1]?.answer();
		await tick();
		sent[2]?.answer();
		await tick();
		sent[3]?.answer();
		await tick();
		expect(names()).toEqual(["first", "second", "third", "made on the new page"]);
		expect(kept(store)).toEqual([]);
	});

	it("opening it twice on one page sends nothing twice", async () => {
		const store = memory();
		void page(store, server().send).make("first");
		const { send, names } = server();
		const next = page(store, send);
		openOutbox({ queryClient: next.queryClient, who, store, resend: () => ({ mutationFn: send }) });
		await tick();
		expect(names()).toEqual(["first"]);
	});

	it("are never sent for another Parent or another Household: they are dropped", async () => {
		const store = memory();
		void page(store, server().send).make("ryan's");
		const { send, names } = server();
		const cori = { householdId: "house", parentId: "cori" };
		page(store, send, { as: cori });
		await tick();
		expect(names()).toEqual([]);
		expect(store.data.size).toBe(0);

		void page(store, server().send).make("this household's");
		page(store, send, { as: { householdId: "another", parentId: "ryan" } });
		await tick();
		expect(names()).toEqual([]);
		expect(store.data.size).toBe(0);
	});

	it("one the server refuses as changed elsewhere is dropped, and the next still goes", async () => {
		const store = memory();
		const old = page(store, server().send);
		void old.make("stale");
		void old.make("fine");

		const { sent, send, names } = server();
		const next = page(store, send);
		await tick();
		sent[0]?.answer("changed-elsewhere");
		await tick();
		// Told the usual way, by its own options.
		expect(next.failed).toEqual(["changed-elsewhere"]);
		expect(kept(store)).toEqual(["fine"]);
		expect(names()).toEqual(["stale", "fine"]);
		sent[1]?.answer();
		await tick();
		expect(kept(store)).toEqual([]);

		// Not sent a third time by the page after.
		const later = server();
		page(store, later.send);
		await tick();
		expect(later.names()).toEqual([]);
	});

	it("one that gets no answer when sent again is tried by the next pages, then given up", async () => {
		const store = memory();
		void page(store, server().send).make("first");
		for (let load = 1; load <= MAX_TRIES; load++) {
			expect(waitingIn(store, key).map((entry) => entry.tries)).toEqual([load - 1]);
			const { sent, send } = server();
			page(store, send);
			await tick();
			sent[0]?.answer(new Error("Failed to fetch"));
			await tick();
		}
		expect(kept(store)).toEqual([]);
	});

	it("one that fails on the page it was made on is not sent again: the Parent was told", async () => {
		const store = memory();
		const { sent, send } = server();
		const made = page(store, send).make("first");
		await tick();
		sent[0]?.answer(new Error("Failed to fetch"));
		expect(await made).toBe("failed");
		expect(kept(store)).toEqual([]);
	});

	it("one cut off by the page going stays written down", async () => {
		const store = memory();
		let leaving = false;
		const { sent, send } = server();
		const { make } = page(store, send, { leaving: () => leaving });
		void make("first");
		void make("second");
		await tick();
		leaving = true;
		sent[0]?.answer(new Error("Failed to fetch"));
		await tick();
		sent[1]?.answer(new Error("Failed to fetch"));
		await tick();
		expect(kept(store)).toEqual(["first", "second"]);
		expect(waitingIn(store, key).map((entry) => entry.tries)).toEqual([0, 0]);
	});

	it("a kind this build doesn't know is dropped", async () => {
		const store = memory();
		void page(store, server().send).make("first");
		const { send, names } = server();
		page(store, send, { resend: () => null });
		await tick();
		expect(names()).toEqual([]);
		expect(kept(store)).toEqual([]);
	});

	it("storage that can't be read counts as nothing, and changes are written down again after", async () => {
		for (const broken of ["{not json", '{"an":"object"}', '[1,null,{"id":3}]', "null"]) {
			const store = memory({ [key]: broken });
			const { sent, send, names } = server();
			const { make } = page(store, send);
			await tick();
			expect(names()).toEqual([]);
			const made = make("first");
			expect(kept(store)).toEqual(["first"]);
			await tick();
			sent[0]?.answer();
			expect(await made).toBe("saved");
			expect(kept(store)).toEqual([]);
		}
	});

	it("with no storage, or storage that throws, changes are saved as ever", async () => {
		const throwing: Store = {
			get length(): number {
				throw new Error("blocked");
			},
			key: () => {
				throw new Error("blocked");
			},
			getItem: () => {
				throw new Error("blocked");
			},
			setItem: () => {
				throw new Error("full");
			},
			removeItem: () => {
				throw new Error("blocked");
			},
		};
		for (const store of [null, throwing]) {
			const { sent, send, names } = server();
			const { make } = page(store, send);
			const first = make("first");
			const second = make("second");
			await tick();
			sent[0]?.answer();
			await tick();
			sent[1]?.answer(new Error("Failed to fetch"));
			expect(await first).toBe("saved");
			expect(await second).toBe("failed");
			expect(names()).toEqual(["first", "second"]);
		}
	});

	it("what can't be written as JSON is sent as ever, and not written down", async () => {
		const store = memory();
		const { sent, send } = server();
		const loop: Record<string, unknown> = {};
		loop.self = loop;
		const { queryClient } = page(store, send);
		const made = queryClient
			.getMutationCache()
			.build(queryClient, { scope: queue, meta: { outbox: "change" }, mutationFn: send })
			.execute(loop);
		await tick();
		sent[0]?.answer();
		await made;
		expect(kept(store)).toEqual([]);
	});

	it("a change whose screen draws it first (onMutate) is written down once", async () => {
		const store = memory();
		const { sent, send } = server();
		const { queryClient } = page(store, send);
		const made = queryClient
			.getMutationCache()
			.build(queryClient, {
				scope: queue,
				meta: { outbox: "change" },
				mutationFn: send,
				onMutate: async () => ({ rollback: () => {} }),
			})
			.execute("first");
		await tick();
		expect(kept(store)).toEqual(["first"]);
		sent[0]?.answer();
		await made;
		expect(kept(store)).toEqual([]);
	});
});

describe("what is written down does not wait for ever", () => {
	it("one made more than a week ago is dropped unsent and said, and a newer one still goes", async () => {
		const store = memory();
		let clock = 1_000_000;
		const old = page(store, server().send, { now: () => clock });
		void old.make("a week old");
		clock += MAX_AGE_MS - 60_000;
		void old.make("yesterday's");

		clock += 120_000;
		const { sent, send, names } = server();
		const dropped: number[] = [];
		page(store, send, { now: () => clock, expired: (count) => void dropped.push(count) });
		await tick();
		expect(dropped).toEqual([1]);
		expect(names()).toEqual(["yesterday's"]);
		expect(kept(store)).toEqual(["yesterday's"]);
		sent[0]?.answer();
		await tick();
		expect(kept(store)).toEqual([]);
	});

	it("one dated far in the future (a clock that was wrong) is dropped too, and nothing is said when none is old", async () => {
		const store = memory();
		void page(store, server().send, { now: () => 10 * MAX_AGE_MS }).make("from the future");
		const { send, names } = server();
		const dropped: number[] = [];
		page(store, send, { now: () => 1_000, expired: (count) => void dropped.push(count) });
		await tick();
		expect(names()).toEqual([]);
		expect(dropped).toEqual([1]);
		expect(store.data.size).toBe(0);

		void page(store, server().send, { now: () => 1_000 }).make("fresh");
		const quiet: number[] = [];
		page(store, server().send, { now: () => 2_000, expired: (count) => void quiet.push(count) });
		await tick();
		expect(quiet).toEqual([]);
	});

	it("no more than the limit are written down; one past it is still sent", async () => {
		const store = memory();
		const { send, names } = server();
		const { make } = page(store, send);
		for (let n = 0; n <= MAX_WAITING; n++) void make(`change ${n}`);
		await tick();
		expect(kept(store)).toHaveLength(MAX_WAITING);
		expect(names()).toEqual(["change 0"]);
	});
});

describe("a change left behind one that was answered carries what the answer said", () => {
	it("is written down again with what this page has learned, each time one of its own is answered", async () => {
		const store = memory();
		let learned = 0;
		const carry = (_kind: string, variables: unknown) =>
			`${String(variables).split("@")[0]}@${learned}`;
		const { sent, send } = server();
		const { make } = page(store, send, { carry });
		void make("first");
		void make("second");
		await tick();
		expect(kept(store)).toEqual(["first@0", "second@0"]);
		learned = 1;
		sent[0]?.answer();
		await tick();
		expect(kept(store)).toEqual(["second@1"]);
	});

	it("never touches what another page of theirs wrote down", async () => {
		const store = memory();
		const { sent, send } = server();
		const mine = page(store, send, { carry: (_kind, variables) => `${String(variables)}!` });
		// Their other tab, opened after: its change is in the same list, and is not this page's.
		void page(store, server().send).make("the other tab's");
		void mine.make("mine");
		void mine.make("mine too");
		await tick();
		expect(kept(store)).toEqual(["the other tab's", "mine!", "mine too!"]);
		sent[0]?.answer();
		await tick();
		expect(kept(store)).toEqual(["the other tab's", "mine too!!"]);
	});

	it("an Undo behind its decision that WAS answered goes with the version that answer left", () => {
		forgetVersions();
		const card = { id: "t1", version: 4, merchant: "Costco" };
		// Written down when made, both on the card as the screen had it.
		expect(carryVersions("decision", { item: card, next: {} })).toEqual({ item: card, next: {} });
		// The decision is answered: the Transaction is one version on.
		settleWrite("t1", { status: "saved", version: 5 });
		const undo = carryVersions("return-to-review", card) as typeof card;
		expect(undo).toEqual({ ...card, version: 5 });
		// A new page remembers nothing: what was written down is what is sent.
		forgetVersions();
		expect(expectedVersionOf(undo)).toBe(5);
		expect(expectedVersionOf(card)).toBe(4);
	});

	it("carries each kind's Transaction and leaves the others as they are", () => {
		forgetVersions();
		noteVersion("t1", 7);
		const row = { id: "t1", version: 2 };
		const other = { id: "t2", version: 3 };
		expect(carryVersions("change", { transaction: row, next: null, label: "Costco" })).toEqual({
			transaction: { id: "t1", version: 7 },
			next: null,
			label: "Costco",
		});
		expect(carryVersions("decisions", [{ item: row }, { item: other }])).toEqual([
			{ item: { id: "t1", version: 7 } },
			{ item: other },
		]);
		const filing = { items: [row] };
		expect(carryVersions("file-without-bucket", filing)).toBe(filing);
		forgetVersions();
	});

	it("never raises a version after a refusal: what waits behind it is refused too", () => {
		forgetVersions();
		const row = { id: "t1", version: 2 };
		noteVersion("t1", 3);
		expect(() => settleWrite("t1", { status: "changed-elsewhere", current: null })).toThrow();
		expect(carryVersions("change", { transaction: row })).toEqual({ transaction: row });
	});

	it("what isn't shaped as expected is written down as it was, not lost", async () => {
		const store = memory();
		const { send } = server();
		const { make } = page(store, send, { carry: carryVersions });
		void make("not a change at all");
		await tick();
		expect(kept(store)).toEqual(["not a change at all"]);
	});
});
