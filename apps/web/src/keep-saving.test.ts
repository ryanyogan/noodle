import { afterEach, describe, expect, it, vi } from "vitest";
import { KEPT_UP_TO, outlivesPage, savingFetch } from "./keep-saving";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("a change on its way to the server when the page is left", () => {
	it("is kept going when it is a small change", () => {
		expect(outlivesPage({ method: "POST", body: '{"amountCents":440000}' })).toBe(true);
		expect(outlivesPage({ method: "POST" })).toBe(true);
		expect(outlivesPage({ method: "POST", body: "x".repeat(KEPT_UP_TO) })).toBe(true);
	});

	it("is not kept going when it only reads, is large, or is a file", () => {
		expect(outlivesPage(undefined)).toBe(false);
		expect(outlivesPage({ method: "GET" })).toBe(false);
		expect(outlivesPage({ method: "POST", body: "x".repeat(KEPT_UP_TO + 1) })).toBe(false);
		expect(outlivesPage({ method: "POST", body: new FormData() })).toBe(false);
	});

	it("eight of the largest kept at once fit the browsers' 64 KB", () => {
		expect(KEPT_UP_TO * 8).toBeLessThanOrEqual(64 * 1024);
	});

	it("sends a change marked to outlive the page, and a read as it was", async () => {
		const sent = vi.fn(
			async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok"),
		);
		vi.stubGlobal("fetch", sent);
		const headers = new Headers({ "x-tsr-serverFn": "true" });
		await savingFetch("/_serverFn/a", { method: "POST", headers, body: "{}" });
		expect(sent.mock.calls[0]?.[1]).toEqual({
			method: "POST",
			headers,
			body: "{}",
			keepalive: true,
		});
		const read = { method: "GET" };
		await savingFetch("/_serverFn/b", read);
		expect(sent.mock.calls[1]?.[1]).toBe(read);
	});
});
