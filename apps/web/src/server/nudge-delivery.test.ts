import { describe, expect, it, vi } from "vitest";
import { testNudge } from "./nudge-content";
import { type DeliveryDeps, deliverNudge } from "./nudge-delivery";
import type { PushTarget } from "./web-push";

const phone: PushTarget = { endpoint: "https://push.test/phone", p256dh: "p", auth: "a" };
const laptop: PushTarget = { endpoint: "https://push.test/laptop", p256dh: "p", auth: "a" };

/** Fake devices: each endpoint's push service answers with the given status, or is unreachable. */
function devices(answers: Record<string, number | "unreachable">) {
	const sent: { endpoint: string; payload: string }[] = [];
	const forgotten: string[] = [];
	const deps: DeliveryDeps = {
		subscriptions: async () => [phone, laptop].filter((target) => target.endpoint in answers),
		send: async (target, payload) => {
			const answer = answers[target.endpoint];
			if (answer === "unreachable") throw new TypeError("fetch failed");
			sent.push({ endpoint: target.endpoint, payload });
			return new Response(null, { status: answer });
		},
		forget: async (endpoint) => {
			forgotten.push(endpoint);
		},
	};
	return { deps, sent, forgotten };
}

describe("deliverNudge", () => {
	it("sends the Nudge to each of the Parent's devices", async () => {
		const { deps, sent } = devices({ [phone.endpoint]: 201, [laptop.endpoint]: 201 });
		expect(await deliverNudge(testNudge(), deps)).toBe("delivered");
		expect(sent.map(({ endpoint }) => endpoint)).toEqual([phone.endpoint, laptop.endpoint]);
		expect(JSON.parse(sent[0]?.payload ?? "")).toEqual(testNudge());
	});

	it("is done when the Parent has no devices", async () => {
		const { deps, sent } = devices({});
		expect(await deliverNudge(testNudge(), deps)).toBe("delivered");
		expect(sent).toEqual([]);
	});

	it("forgets a device whose subscription is gone", async () => {
		const { deps, forgotten } = devices({ [phone.endpoint]: 410, [laptop.endpoint]: 404 });
		expect(await deliverNudge(testNudge(), deps)).toBe("delivered");
		expect(forgotten).toEqual([phone.endpoint, laptop.endpoint]);
	});

	it("tries again later when a push service is busy, failing, or unreachable", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		for (const answer of [429, 503, "unreachable"] as const) {
			const { deps, forgotten } = devices({ [phone.endpoint]: 201, [laptop.endpoint]: answer });
			expect(await deliverNudge(testNudge(), deps)).toBe("retry");
			expect(forgotten).toEqual([]);
		}
		error.mockRestore();
	});

	it("doesn't retry what a push service refused for good", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const { deps, forgotten } = devices({ [phone.endpoint]: 400 });
		expect(await deliverNudge(testNudge(), deps)).toBe("delivered");
		expect(forgotten).toEqual([]);
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});
});
