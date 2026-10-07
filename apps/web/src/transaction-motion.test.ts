import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { animateTransactionClose, cancelTransactionClose } from "./transaction-motion";

// The open Transaction's pane shutting (issue 147): the close must finish, and the address leave
// the Transaction, even when the pane is taken out of the page while it shuts and its animation
// never reports its end.

type Settle = { resolve: () => void; reject: (reason?: unknown) => void };

function pane() {
	const settle = {} as Settle;
	const finished = new Promise<void>((resolve, reject) =>
		Object.assign(settle, { resolve, reject }),
	);
	const animation = { finished, cancel: vi.fn(() => settle.reject(new Error("cancelled"))) };
	const region = {
		dataset: {} as Record<string, string>,
		inert: false,
		offsetHeight: 300,
		isConnected: true,
		animate: vi.fn(() => animation),
	};
	return { region, animation, settle };
}

let location: { pathname: string };

beforeEach(() => {
	vi.useFakeTimers();
	location = { pathname: "/transactions/2026-10/abc" };
	vi.stubGlobal("window", { matchMedia: () => ({ matches: true }), location });
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test("a pane that leaves the page mid-close still closes: the address doesn't stay on it", async () => {
	const { region } = pane();
	vi.stubGlobal("document", { querySelector: () => region });
	const done = vi.fn();
	animateTransactionClose(done);
	// Its row left the list: the pane is gone, and its animation never says it ended.
	region.isConnected = false;
	await vi.advanceTimersByTimeAsync(170);
	expect(done).not.toHaveBeenCalled();
	await vi.advanceTimersByTimeAsync(200);
	expect(done).toHaveBeenCalledTimes(1);
});

test("the close finishes once, when the animation ends", async () => {
	const { region, settle } = pane();
	vi.stubGlobal("document", { querySelector: () => region });
	const done = vi.fn();
	animateTransactionClose(done);
	settle.resolve();
	await vi.advanceTimersByTimeAsync(1000);
	expect(done).toHaveBeenCalledTimes(1);
});

test("a close that was cancelled, or overtaken by going elsewhere, never finishes later", async () => {
	const first = pane();
	vi.stubGlobal("document", { querySelector: () => first.region });
	const done = vi.fn();
	animateTransactionClose(done);
	expect(cancelTransactionClose()).toBe(true);
	await vi.advanceTimersByTimeAsync(1000);
	expect(done).not.toHaveBeenCalled();
	expect(first.region.inert).toBe(false);

	const second = pane();
	vi.stubGlobal("document", { querySelector: () => second.region });
	animateTransactionClose(done);
	location.pathname = "/review";
	second.region.isConnected = false;
	await vi.advanceTimersByTimeAsync(1000);
	expect(done).not.toHaveBeenCalled();
});
