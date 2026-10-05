import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The router's note, and what Safari says when a script import fails (see leaving-page.ts).
const NOTE = "tanstack_router_reload:Importing a module script failed.";
const failedImport = () => new TypeError("Importing a module script failed.");
const HERE = "https://noodle.test/month/2026-10?view=all";

class FakeElement {
	closest(_selector: string): FakeElement | null {
		return null;
	}
}

class FakeLink extends FakeElement {
	readonly origin: string;
	readonly pathname: string;
	readonly search: string;
	readonly protocol: string;
	constructor(
		href: string,
		readonly target = "",
		private readonly download = false,
	) {
		super();
		const url = new URL(href, HERE);
		this.origin = url.origin;
		this.pathname = url.pathname;
		this.search = url.search;
		this.protocol = url.protocol;
	}
	override closest() {
		return this;
	}
	hasAttribute(name: string) {
		return name === "download" && this.download;
	}
}

/** Something inside a link: the tap lands on it, not on the link. */
class FakeInside extends FakeElement {
	constructor(private readonly link: FakeLink) {
		super();
	}
	override closest() {
		return this.link;
	}
}

type Listener = (event: Record<string, unknown>) => void;

function fakeWindow({ storage = true } = {}) {
	const kept = new Map<string, string>();
	const listeners = new Map<string, Listener[]>();
	const here = new URL(HERE);
	const window = {
		get sessionStorage() {
			if (!storage) throw new Error("The operation is insecure.");
			return {
				getItem: (key: string) => kept.get(key) ?? null,
				setItem: (key: string, value: string) => void kept.set(key, value),
				removeItem: (key: string) => void kept.delete(key),
			};
		},
		location: {
			origin: here.origin,
			pathname: here.pathname,
			search: here.search,
			reload: vi.fn(),
		},
		addEventListener: (type: string, listener: Listener) => {
			listeners.set(type, [...(listeners.get(type) ?? []), listener]);
		},
	};
	const fire = (type: string, event: Record<string, unknown> = {}) => {
		for (const listener of listeners.get(type) ?? []) listener(event);
	};
	const click = (target: unknown, event: Record<string, unknown> = {}) =>
		fire("click", { target, button: 0, defaultPrevented: false, ...event });
	return { window, kept, fire, click, listeners };
}

/** The module as a newly loaded page has it, watching `page`. */
async function watching(page: ReturnType<typeof fakeWindow>) {
	vi.stubGlobal("window", page.window);
	const leavingPage = await import("./leaving-page");
	leavingPage.watchLeavingPage();
	return leavingPage;
}

beforeEach(() => {
	vi.resetModules();
	vi.useFakeTimers();
	vi.stubGlobal("Element", FakeElement);
	vi.stubGlobal("HTMLAnchorElement", FakeLink);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("leaving a page whose scripts are still loading", () => {
	it("writes the router's note, so the router doesn't answer with a reload", async () => {
		const page = fakeWindow();
		const { leftMidLoad } = await watching(page);
		expect(page.kept.has(NOTE)).toBe(false);
		expect(leftMidLoad(failedImport())).toBe(false);

		page.fire("beforeunload");
		expect(page.kept.get(NOTE)).toBe("leaving");
		expect(leftMidLoad(failedImport())).toBe(true);
	});

	it("counts pagehide too, which is all Mobile Safari promises", async () => {
		const page = fakeWindow();
		const { leftMidLoad } = await watching(page);
		page.fire("pagehide");
		expect(page.kept.get(NOTE)).toBe("leaving");
		expect(leftMidLoad(failedImport())).toBe(true);
	});

	it("hides only the failed import, never another error", async () => {
		const page = fakeWindow();
		const { leftMidLoad } = await watching(page);
		page.fire("beforeunload");
		expect(leftMidLoad(new Error("Couldn’t load the month"))).toBe(false);
		expect(leftMidLoad("Importing a module script failed.")).toBe(false);
		expect(leftMidLoad(undefined)).toBe(false);
	});

	it("leaves a reload the router really made alone", async () => {
		const page = fakeWindow();
		page.kept.set(NOTE, "1");
		const { leftMidLoad } = await watching(page);
		expect(page.kept.get(NOTE)).toBe("1");
		page.fire("beforeunload");
		expect(page.kept.get(NOTE)).toBe("1");
		expect(leftMidLoad(failedImport())).toBe(false);
		vi.advanceTimersByTime(60_000);
		expect(page.kept.get(NOTE)).toBe("1");
	});

	it("is cleared by the page that comes next", async () => {
		const page = fakeWindow();
		page.kept.set(NOTE, "leaving");
		const { leftMidLoad } = await watching(page);
		expect(page.kept.has(NOTE)).toBe(false);
		expect(leftMidLoad(failedImport())).toBe(false);
	});

	it("is forgotten after ten seconds when the page was not left after all", async () => {
		const page = fakeWindow();
		const { leftMidLoad } = await watching(page);
		page.fire("beforeunload");
		vi.advanceTimersByTime(9_999);
		expect(page.kept.get(NOTE)).toBe("leaving");
		// Asked for again: the ten seconds start over.
		page.fire("beforeunload");
		vi.advanceTimersByTime(9_999);
		expect(page.kept.get(NOTE)).toBe("leaving");
		vi.advanceTimersByTime(1);
		expect(page.kept.has(NOTE)).toBe(false);
		expect(leftMidLoad(failedImport())).toBe(false);
	});

	it("does nothing, and breaks nothing, where storage is blocked", async () => {
		const page = fakeWindow({ storage: false });
		const { leftMidLoad } = await watching(page);
		expect(() => page.fire("beforeunload")).not.toThrow();
		expect(leftMidLoad(failedImport())).toBe(false);
	});

	it("does nothing on the server", async () => {
		const { watchLeavingPage, leftMidLoad } = await import("./leaving-page");
		expect(() => watchLeavingPage()).not.toThrow();
		expect(leftMidLoad(failedImport())).toBe(false);
	});
});

describe("a tap on a link before the page's scripts have taken over", () => {
	it("counts as leaving when the link loads another whole page", async () => {
		for (const href of ["/transactions/2026-10", "/month/2026-10", "https://bank.example/login"]) {
			vi.resetModules();
			const page = fakeWindow();
			const { leftMidLoad } = await watching(page);
			page.click(new FakeInside(new FakeLink(href)));
			expect(page.kept.get(NOTE), href).toBe("leaving");
			expect(leftMidLoad(failedImport()), href).toBe(true);
		}
	});

	it("doesn't count when the tap goes nowhere else", async () => {
		const elsewhere = () => new FakeLink("/transactions/2026-10");
		const taps: [string, unknown, Record<string, unknown>?][] = [
			["the router took it", elsewhere(), { defaultPrevented: true }],
			["not the main button", elsewhere(), { button: 1 }],
			["a new tab by Cmd", elsewhere(), { metaKey: true }],
			["a new tab by Ctrl", elsewhere(), { ctrlKey: true }],
			["a new window by Shift", elsewhere(), { shiftKey: true }],
			["a download by Alt", elsewhere(), { altKey: true }],
			["not on a link", new FakeElement()],
			["not on an element", null],
			["a file to download", new FakeLink("/export.csv", "", true)],
			["opens in a new tab", new FakeLink("/transactions/2026-10", "_blank")],
			["an email address", new FakeLink("mailto:help@noodle.test")],
			["this very page", new FakeLink(HERE)],
			["a place on this page", new FakeLink(`${HERE}#more`)],
		];
		for (const [what, target, event] of taps) {
			vi.resetModules();
			const page = fakeWindow();
			const { leftMidLoad } = await watching(page);
			page.click(target, event);
			expect(page.kept.has(NOTE), what).toBe(false);
			expect(leftMidLoad(failedImport()), what).toBe(false);
		}
	});

	it("counts a link that names this frame", async () => {
		const page = fakeWindow();
		await watching(page);
		page.click(new FakeLink("/transactions/2026-10", "_self"));
		expect(page.kept.get(NOTE)).toBe("leaving");
	});
});

describe("coming back to the page as Safari kept it", () => {
	it("reloads a page that was left with a part of it failed", async () => {
		const page = fakeWindow();
		const { leftMidLoad } = await watching(page);
		page.fire("beforeunload");
		expect(leftMidLoad(failedImport())).toBe(true);
		page.fire("pageshow", { persisted: true });
		expect(page.window.location.reload).toHaveBeenCalledTimes(1);
	});

	it("carries on, with the mark gone, when nothing failed", async () => {
		const page = fakeWindow();
		const { leftMidLoad } = await watching(page);
		page.fire("beforeunload");
		page.fire("pageshow", { persisted: true });
		expect(page.window.location.reload).not.toHaveBeenCalled();
		expect(page.kept.has(NOTE)).toBe(false);
		expect(leftMidLoad(failedImport())).toBe(false);
	});

	it("does nothing on an ordinary first showing", async () => {
		const page = fakeWindow();
		await watching(page);
		page.fire("beforeunload");
		page.fire("pageshow", { persisted: false });
		expect(page.window.location.reload).not.toHaveBeenCalled();
		expect(page.kept.get(NOTE)).toBe("leaving");
	});
});
