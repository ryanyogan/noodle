import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A Rule stated from a Review card and left waiting by an earlier page is sent again (issue 129,
// ADR-0056): marked as sent again, with the ID the card made for it, which the server takes once.
// The server function and the toast are the only things stood in for.

const server = vi.hoisted(() => ({ saveRule: vi.fn() }));
vi.mock("./server/review", () => server);
const said = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@noodle/ui/components/toast", () => said);

import { MAX_AGE_MS, openOutbox, outboxKey, type Store, type Waiting } from "./outbox";
import { RuleMadeSince } from "./review";
import { leftAlone, resendWith, tooOldToSave } from "./waiting-writes";

const rule = {
	ruleId: "01JRULE0000000000000000000",
	pattern: "Lego Store",
	bucketId: "fun",
	bucketName: "Fun",
	forMemberIds: [],
};
const who = { householdId: "household", parentId: "alex" };
const sent = {
	data: {
		ruleId: rule.ruleId,
		pattern: "Lego Store",
		bucketId: "fun",
		commitmentId: null,
		forMemberIds: [],
		apply: true,
		again: true,
	},
};

/** A device's storage holding what an earlier page wrote down. */
function deviceWith(waiting: Waiting[]): Store & { list: () => Waiting[] } {
	const kept = new Map<string, string>([[outboxKey(who), JSON.stringify(waiting)]]);
	return {
		getItem: (key) => kept.get(key) ?? null,
		setItem: (key, value) => void kept.set(key, value),
		removeItem: (key) => void kept.delete(key),
		key: (index) => [...kept.keys()][index] ?? null,
		get length() {
			return kept.size;
		},
		list: () => JSON.parse(kept.get(outboxKey(who)) ?? "[]"),
	};
}

const left = (at: number): Waiting => ({ id: "w1", kind: "rule", variables: rule, tries: 0, at });

/** Opens the app on that device, as the layout does, and waits for what it sends to be answered. */
async function open(store: Store, now: number) {
	const queryClient = new QueryClient();
	const expired = vi.fn();
	openOutbox({
		queryClient,
		who,
		store,
		resend: resendWith(queryClient),
		refused: leftAlone,
		expired,
		now: () => now,
	});
	await vi.waitFor(() => expect(queryClient.isMutating()).toBe(0));
	return { expired };
}

beforeEach(() => {
	server.saveRule.mockReset();
	said.toast.mockReset();
});

describe("a Rule stated from a card and left waiting when the page was left", () => {
	it("is sent again with the ID its card made, marked as sent again, and crossed off", async () => {
		server.saveRule.mockResolvedValue({ filed: 2, snapshot: true });
		const store = deviceWith([left(1_000)]);
		await open(store, 2_000);
		expect(server.saveRule).toHaveBeenCalledTimes(1);
		expect(server.saveRule).toHaveBeenCalledWith(sent);
		expect(store.list()).toEqual([]);
		expect(said.toast).toHaveBeenCalledWith(
			"Saved what was still waiting when you left.",
			expect.objectContaining({ tone: "success" }),
		);
	});

	it("that had landed (only its answer was lost) is answered the same and crossed off", async () => {
		// The server's answer to a repeat: what the first one did, nothing done again.
		server.saveRule.mockResolvedValue({ filed: 0, snapshot: false });
		const store = deviceWith([left(1_000)]);
		await open(store, 2_000);
		expect(store.list()).toEqual([]);
	});

	it("is dropped and said when the merchant has had a Rule made since, and not tried again", async () => {
		server.saveRule.mockResolvedValue({ filed: 0, snapshot: false, madeSince: true });
		const store = deviceWith([left(1_000)]);
		await open(store, 2_000);
		expect(store.list()).toEqual([]);
		expect(said.toast).toHaveBeenCalledWith(new RuleMadeSince("Lego Store").message);
		expect(said.toast).toHaveBeenCalledTimes(1);
	});

	it("that gets no answer stays for the next time the app opens", async () => {
		server.saveRule.mockRejectedValue(new TypeError("Failed to fetch"));
		const store = deviceWith([left(1_000)]);
		await open(store, 2_000);
		expect(store.list()).toMatchObject([{ id: "w1", kind: "rule", tries: 1 }]);
	});

	it("made more than a week ago is dropped unsent, and said", async () => {
		const store = deviceWith([left(1_000)]);
		const { expired } = await open(store, 1_000 + MAX_AGE_MS + 1);
		expect(server.saveRule).not.toHaveBeenCalled();
		expect(store.list()).toEqual([]);
		expect(expired).toHaveBeenCalledWith(1);
		expect(tooOldToSave(1)).toBe(
			"A change you made over a week ago was never saved, so it has been left out.",
		);
	});
});
