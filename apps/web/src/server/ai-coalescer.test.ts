import { describe, expect, it } from "vitest";
import {
	type AiBatch,
	AiCoalescer,
	type CoalesceConfig,
	type CoalescerStorage,
} from "./ai-coalescer";

const config: CoalesceConfig = {
	windowMs: 60_000,
	busyWindowMs: 180_000,
	maxWaitMs: 600_000,
	attempts: 3,
	retryMs: 60_000,
	bigBatch: 5,
};

/** A Durable Object's storage and clock, faked: a Map for kv, and the one alarm. */
function fakeAgent() {
	const kv = new Map<string, unknown>();
	let time = 1_000_000;
	const state = { alarm: null as number | null };
	const storage: CoalescerStorage = {
		kv: {
			get: <T>(key: string) => structuredClone(kv.get(key)) as T | undefined,
			put: (key, value) => void kv.set(key, structuredClone(value)),
			delete: (key) => kv.delete(key),
		},
		getAlarm: async () => state.alarm,
		setAlarm: async (at) => {
			state.alarm = at;
		},
	};
	const coalescer = new AiCoalescer(storage, config, () => time);
	return {
		coalescer,
		state,
		advance: (ms: number) => {
			time += ms;
		},
		now: () => time,
	};
}

const householdId = "household";

describe("coalescing background AI events", () => {
	it("runs once for a burst of 50 events, covering all of them", async () => {
		const agent = fakeAgent();
		const runs: AiBatch[] = [];
		for (let i = 0; i < 50; i++) {
			await agent.coalescer.queue({
				householdId,
				memberId: i % 2 ? "alex" : "sam",
				kind: i % 10 === 0 ? "buckets-changed" : "imported",
				ids: i % 10 === 0 ? [] : [`import-${i}`],
			});
			agent.advance(1_000);
			// The alarm fires early (for a Nudge, say): nothing runs while the burst goes on.
			expect(await agent.coalescer.run(async (batch) => void runs.push(batch))).toBe("waiting");
		}
		expect(runs).toHaveLength(0);

		agent.advance(config.maxWaitMs);
		expect(await agent.coalescer.run(async (batch) => void runs.push(batch))).toBe("ran");
		expect(await agent.coalescer.run(async (batch) => void runs.push(batch))).toBe("idle");

		expect(runs).toHaveLength(1);
		expect(runs[0]?.imports).toHaveLength(45);
		expect(runs[0]?.lookAgain).toBe(true);
		expect(runs[0]?.events).toEqual({ imported: 45, "buckets-changed": 5 });
	});

	it("waits the window after the latest event, longer for a big batch, never past the cap", async () => {
		const agent = fakeAgent();
		const start = agent.now();
		await agent.coalescer.queue({ householdId, memberId: "alex", kind: "imported", ids: ["a"] });
		expect(agent.state.alarm).toBe(start + config.windowMs);
		expect(agent.coalescer.nextDue()).toBe(start + config.windowMs);

		agent.advance(30_000);
		await agent.coalescer.queue({ householdId, kind: "rule-added" });
		expect(agent.coalescer.nextDue()).toBe(start + 30_000 + config.windowMs);

		for (const id of ["b", "c", "d", "e"]) {
			await agent.coalescer.queue({ householdId, memberId: "alex", kind: "captured", ids: [id] });
		}
		expect(agent.coalescer.nextDue()).toBe(start + 30_000 + config.busyWindowMs);

		agent.advance(500_000);
		await agent.coalescer.queue({ householdId, memberId: "sam", kind: "imported", ids: ["f"] });
		expect(agent.coalescer.nextDue()).toBe(start + config.maxWaitMs);
	});

	it("folds events that arrive during a run into the next run", async () => {
		const agent = fakeAgent();
		await agent.coalescer.queue({ householdId, memberId: "alex", kind: "imported", ids: ["a"] });
		agent.advance(config.windowMs);
		const runs: AiBatch[] = [];
		await agent.coalescer.run(async (batch) => {
			runs.push(batch);
			// One run at a time: an early alarm while this runs does nothing.
			expect(await agent.coalescer.run(async () => {})).toBe("busy");
			await agent.coalescer.queue({ householdId, memberId: "sam", kind: "imported", ids: ["b"] });
		});
		expect(agent.state.alarm).toBe(agent.now() + config.windowMs);

		agent.advance(config.windowMs);
		await agent.coalescer.run(async (batch) => void runs.push(batch));
		expect(runs.map((batch) => batch.imports)).toEqual([
			[{ memberId: "alex", id: "a" }],
			[{ memberId: "sam", id: "b" }],
		]);
	});

	it("retries a failed run a few times, then gives up quietly", async () => {
		const agent = fakeAgent();
		await agent.coalescer.queue({ householdId, memberId: "alex", kind: "imported", ids: ["a"] });
		const failing = async () => {
			throw new Error("D1 is down");
		};
		agent.advance(config.windowMs);
		expect(await agent.coalescer.run(failing)).toBe("retrying");
		expect(agent.state.alarm).toBe(agent.now() + config.retryMs);
		agent.advance(config.retryMs);
		expect(await agent.coalescer.run(failing)).toBe("retrying");
		agent.advance(config.retryMs * 2);
		expect(await agent.coalescer.run(failing)).toBe("gave-up");
		expect(agent.coalescer.nextDue()).toBeNull();
	});

	it("takes each month's start once", async () => {
		const agent = fakeAgent();
		await agent.coalescer.queue({ householdId, kind: "month-started", ids: ["2026-09"] });
		agent.advance(config.windowMs);
		expect(await agent.coalescer.run(async () => {})).toBe("ran");
		// The cron runs hourly for the first days of a month.
		await agent.coalescer.queue({ householdId, kind: "month-started", ids: ["2026-09"] });
		expect(agent.coalescer.nextDue()).toBeNull();
	});
});
