import { describe, expect, it } from "vitest";
import {
	browserRenderer,
	htmlOf,
	type KeptPage,
	needsBrowser,
	type PageCache,
	readablePageFetcher,
	renderable,
	robotsAllows,
} from "./perk-page";
import type { Page } from "./perks-model";

const CHASE = "https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred";
const body = "Earn 3x points on dining at restaurants. ".repeat(20);
const html = `<html><body><h1>Benefits</h1><p>${body}</p></body></html>`;
const now = () => new Date("2026-10-05T12:00:00Z");

function fakes(plain: Page | Error, options: { robots?: boolean; kept?: KeptPage } = {}) {
	const calls = { fetch: 0, render: 0, saved: [] as KeptPage[] };
	const cache: PageCache = {
		async load(url, since) {
			const kept = options.kept;
			return kept && kept.url === url && kept.fetchedAt > since
				? { url: kept.finalUrl, text: kept.text }
				: null;
		},
		async save(page) {
			calls.saved.push(page);
		},
	};
	const fetcher = readablePageFetcher({
		async fetchPage() {
			calls.fetch += 1;
			if (plain instanceof Error) throw plain;
			return plain;
		},
		async render() {
			calls.render += 1;
			return { html };
		},
		cache,
		robots: async () => options.robots ?? true,
		now,
	});
	return { calls, fetcher };
}

describe("needsBrowser", () => {
	it("is for pages refused, empty or walled, not for ones gone or readable", () => {
		expect(needsBrowser({ url: CHASE, failed: 403 })).toBe(true);
		expect(needsBrowser({ url: CHASE, failed: 404 })).toBe(false);
		expect(needsBrowser({ url: CHASE, text: "Loading…" })).toBe(true);
		expect(
			needsBrowser({
				url: CHASE,
				text: `Please enable JavaScript to view this page. ${"x ".repeat(300)}`,
			}),
		).toBe(true);
		expect(needsBrowser({ url: CHASE, text: body })).toBe(false);
		// A long page that mentions a captcha somewhere is still a page.
		expect(needsBrowser({ url: CHASE, text: `${body.repeat(6)} captcha` })).toBe(false);
	});
});

describe("readablePageFetcher", () => {
	it("keeps a page a plain fetch can read, and never opens a browser for it", async () => {
		const { calls, fetcher } = fakes({ url: CHASE, text: body });
		expect(await fetcher(CHASE)).toEqual({ url: CHASE, text: body });
		expect(calls.render).toBe(0);
		expect(calls.saved.map((p) => p.via)).toEqual(["fetch"]);
	});

	it("renders an issuer's page a plain fetch was refused, and keeps the text with its date", async () => {
		const { calls, fetcher } = fakes({ url: CHASE, failed: 403 });
		const page = await fetcher(CHASE);
		expect("text" in page && page.text).toContain("Earn 3x points on dining");
		expect(calls.render).toBe(1);
		expect(calls.saved).toMatchObject([{ url: CHASE, via: "browser", fetchedAt: now() }]);
	});

	it("renders when the plain fetch throws, and throws on when nothing can", async () => {
		const down = fakes(new Error("503"));
		expect("text" in (await down.fetcher(CHASE))).toBe(true);
		const elsewhere = fakes(new Error("503"));
		await expect(elsewhere.fetcher("https://example.com/benefits")).rejects.toThrow("503");
		expect(elsewhere.calls.render).toBe(0);
	});

	it("never renders a page off the sites it knows, or one robots.txt keeps out", async () => {
		const pasted = fakes({ url: "https://example.com/benefits", failed: 403 });
		expect(await pasted.fetcher("https://example.com/benefits")).toEqual({
			url: "https://example.com/benefits",
			failed: 403,
		});
		expect(pasted.calls.render).toBe(0);
		const kept = fakes({ url: CHASE, failed: 403 }, { robots: false });
		expect(await kept.fetcher(CHASE)).toEqual({ url: CHASE, failed: 403 });
		expect(kept.calls.render).toBe(0);
		expect(renderable("https://www.t-mobile.com/cell-phone-plans")).toBe(true);
		expect(renderable("https://example.com/x")).toBe(false);
	});

	it("doesn't read a page that redirected to another site", async () => {
		const { fetcher } = fakes({ url: "https://example.com/landing", text: body });
		expect(await fetcher(CHASE)).toEqual({ url: "https://example.com/landing", failed: 0 });
	});

	it("reads what was kept this week without fetching, and fetches again after", async () => {
		const page = { url: CHASE, finalUrl: CHASE, text: body, via: "browser" as const };
		const fresh = fakes(
			{ url: CHASE, failed: 403 },
			{ kept: { ...page, fetchedAt: new Date("2026-10-01") } },
		);
		expect(await fresh.fetcher(CHASE)).toEqual({ url: CHASE, text: body });
		expect(fresh.calls).toMatchObject({ fetch: 0, render: 0 });
		const old = fakes(
			{ url: CHASE, failed: 403 },
			{ kept: { ...page, fetchedAt: new Date("2026-09-01") } },
		);
		await old.fetcher(CHASE);
		expect(old.calls).toMatchObject({ fetch: 1, render: 1 });
	});
});

describe("robotsAllows", () => {
	const robots = `# hello
User-agent: *
Disallow: /account/
Disallow: /*.pdf$
Allow: /account/help

User-agent: badbot
Disallow: /`;
	it("follows the rules for everyone, longest first", () => {
		expect(robotsAllows(robots, "/credit-cards/venture-x/")).toBe(true);
		expect(robotsAllows(robots, "/account/settings")).toBe(false);
		expect(robotsAllows(robots, "/account/help")).toBe(true);
		expect(robotsAllows(robots, "/terms.pdf")).toBe(false);
		expect(robotsAllows("", "/anything")).toBe(true);
		expect(robotsAllows("User-agent: noodle\nDisallow: /", "/x")).toBe(false);
	});
});

describe("browserRenderer", () => {
	it("is absent without the binding, and reads a quick action's HTML either way it comes", async () => {
		expect(browserRenderer(undefined)).toBeNull();
		expect(htmlOf(JSON.stringify({ success: true, result: "<p>hi</p>" }))).toBe("<p>hi</p>");
		expect(htmlOf("<html>hi</html>")).toBe("<html>hi</html>");
		const asked: unknown[] = [];
		const render = browserRenderer({
			async quickAction(action, options) {
				asked.push([action, options.url]);
				return new Response(html);
			},
		});
		expect((await render?.(CHASE))?.html).toBe(html);
		expect(asked).toEqual([["content", CHASE]]);
		const refused = browserRenderer({
			quickAction: async () => new Response("no", { status: 429 }),
		});
		await expect(refused?.(CHASE)).rejects.toThrow("429");
	});
});
