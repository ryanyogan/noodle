import { onIssuerSite, PERK_SOURCE_CATALOG, sameSite } from "@noodle/domain";
import { MIN_PAGE_CHARS, type Page, pageText } from "./perks-model";

// Getting a benefits page that can be read (#96, ADR-0044). A plain fetch comes first: it's free
// and most pages answer it. When the answer is blocked, empty or only a "turn on JavaScript"
// shell, and the page is on a site Noodle knows (a card issuer's, or a catalog product's), the
// page is rendered once in a real browser (Cloudflare Browser Rendering). Bounds: one page per
// Perk Source per research run, a hard timeout, robots.txt respected, the text capped
// (MAX_PAGE_CHARS), and the text kept with its date so research soon after doesn't fetch or
// render again. Nothing here imports the Workers runtime: the binding, the cache and the clock
// are handed in, so tests run it with fakes.

/** Renders a page in a real browser and gives its HTML; throws when it can't. */
export type PageRenderer = (url: string) => Promise<{ html: string }>;

export type KeptPage = {
	url: string;
	finalUrl: string;
	text: string;
	via: "fetch" | "browser";
	fetchedAt: Date;
};

export type PageCache = {
	load(url: string, since: Date): Promise<{ url: string; text: string } | null>;
	save(page: KeptPage): Promise<void>;
};

/** A real browser gets this long, whatever the page does. */
export const RENDER_TIMEOUT_MS = 25_000;
/** A page read this recently is read from what was kept. The monthly re-check always reads anew. */
export const PAGE_KEPT_DAYS = 7;
/** How many Perk Sources the nightly re-check researches: the rest wait for the next night. */
export const RECHECKS_PER_NIGHT = 20;

/** Answers that mean "not for a script": worth a real browser. A 404 isn't: the page is gone. */
const BLOCKED = new Set([401, 403, 405, 406, 418, 451, 503]);

const WALL =
	/enable javascript|javascript is (required|disabled|not enabled)|requires javascript|access denied|are you a robot|verify (that )?you are (a )?human|unusual traffic|captcha|checking your browser|pardon our interruption|request unsuccessful/i;

/**
 * Whether a plain fetch's answer needs a real browser: refused as a script, next to no text (a
 * page built by script), or a short page that is only a wall asking for JavaScript or a human.
 */
export function needsBrowser(page: Page): boolean {
	if ("failed" in page) return BLOCKED.has(page.failed);
	if (page.text.length < MIN_PAGE_CHARS) return true;
	return page.text.length < 4_000 && WALL.test(page.text);
}

/** Only sites Noodle knows are rendered: never whatever address a Parent pastes. */
export const renderable = (url: string) =>
	onIssuerSite(url) ||
	(url.startsWith("https://") && PERK_SOURCE_CATALOG.some((entry) => sameSite(entry.page, url)));

/**
 * Whether a site's robots.txt lets a path be read: the rules for "noodle" if it names us, else
 * those for everyone; the longest matching rule wins, Allow on a tie. No rules, no objection.
 */
export function robotsAllows(robotsTxt: string, path: string, agent = "noodle"): boolean {
	const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
	let current: (typeof groups)[number] | null = null;
	let namingAgents = false;
	for (const raw of robotsTxt.split(/\r?\n/)) {
		const line = raw.replace(/#.*$/, "").trim();
		const colon = line.indexOf(":");
		if (colon < 0) continue;
		const field = line.slice(0, colon).trim().toLowerCase();
		const value = line.slice(colon + 1).trim();
		if (field === "user-agent") {
			if (!current || !namingAgents) {
				current = { agents: [], rules: [] };
				groups.push(current);
			}
			current.agents.push(value.toLowerCase());
			namingAgents = true;
		} else if ((field === "allow" || field === "disallow") && current) {
			namingAgents = false;
			if (value) current.rules.push({ allow: field === "allow", path: value });
		} else {
			namingAgents = false;
		}
	}
	const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
	const rules = (mine.length > 0 ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap(
		(g) => g.rules,
	);
	const matches = (rule: string) => {
		const pattern = rule
			.replace(/[.+?^{}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, ".*")
			.replace(/\\?\$$/, "$");
		return new RegExp(`^${pattern}`).test(path);
	};
	const best = rules
		.filter((rule) => matches(rule.path))
		.sort((a, b) => b.path.length - a.path.length || Number(b.allow) - Number(a.allow))[0];
	return best ? best.allow : true;
}

/** Asks a site's robots.txt whether a page may be read; a site without one doesn't object. */
export const robotsCheck =
	(fetcher: typeof fetch) =>
	async (url: string): Promise<boolean> => {
		try {
			const at = new URL(url);
			const response = await fetcher(`${at.origin}/robots.txt`, {
				signal: AbortSignal.timeout(5_000),
			});
			if (!response.ok) return true;
			return robotsAllows((await response.text()).slice(0, 200_000), at.pathname + at.search);
		} catch {
			return true;
		}
	};

/** The Browser Rendering binding's quick actions, as much of it as this uses. */
export type BrowserBinding = {
	quickAction(action: string, options: Record<string, unknown>): Promise<Response>;
};

/** A quick action's HTML: the page itself, or JSON carrying it as `result`. */
export function htmlOf(body: string): string {
	if (!body.trimStart().startsWith("{")) return body;
	try {
		const parsed = JSON.parse(body) as { result?: unknown };
		return typeof parsed.result === "string" ? parsed.result : body;
	} catch {
		return body;
	}
}

/**
 * Renders with Cloudflare Browser Rendering's "content" quick action on the Worker's browser
 * binding (no API token). Null when the Worker has no such binding: research is then as before.
 */
export function browserRenderer(browser: BrowserBinding | undefined): PageRenderer | null {
	if (!browser || typeof browser.quickAction !== "function") return null;
	return async (url) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const late = new Promise<never>((_, reject) => {
			timer = setTimeout(
				() => reject(new Error(`${url} took too long to render`)),
				RENDER_TIMEOUT_MS,
			);
		});
		try {
			const response = await Promise.race([
				browser.quickAction("content", {
					url,
					gotoOptions: { waitUntil: "networkidle2", timeout: RENDER_TIMEOUT_MS - 5_000 },
					rejectResourceTypes: ["image", "media", "font"],
				}),
				late,
			]);
			if (!response.ok) throw new Error(`Rendering ${url} answered ${response.status}`);
			return { html: htmlOf(await response.text()) };
		} finally {
			clearTimeout(timer);
		}
	};
}

/**
 * A page fetcher for research: what was kept if it's recent, else a plain fetch, else (when that
 * needs a browser, the site is one Noodle knows and its robots.txt doesn't object) one render.
 * A page that redirects to another site isn't the page asked for, and isn't read.
 */
export function readablePageFetcher(deps: {
	fetchPage: (url: string) => Promise<Page>;
	render: PageRenderer | null;
	cache: PageCache | null;
	robots: (url: string) => Promise<boolean>;
	now: () => Date;
}): (url: string) => Promise<Page> {
	return async (url) => {
		const since = new Date(deps.now().getTime() - PAGE_KEPT_DAYS * 86_400_000);
		const kept = await deps.cache?.load(url, since).catch(() => null);
		if (kept) return kept;
		const keep = async (page: { url: string; text: string }, via: KeptPage["via"]) => {
			await deps.cache
				?.save({ url, finalUrl: page.url, text: page.text, via, fetchedAt: deps.now() })
				.catch((error) => console.error(`Couldn’t keep ${url}`, error));
			return page;
		};
		let plain: Page | null = null;
		let failure: unknown = null;
		try {
			plain = await deps.fetchPage(url);
		} catch (error) {
			failure = error;
		}
		if (plain && "text" in plain && !sameSite(url, plain.url)) return { url: plain.url, failed: 0 };
		if (plain && !needsBrowser(plain)) return "text" in plain ? keep(plain, "fetch") : plain;
		if (deps.render && renderable(url) && (await deps.robots(url))) {
			try {
				const text = pageText((await deps.render(url)).html);
				if (text.length >= MIN_PAGE_CHARS && !needsBrowser({ url, text })) {
					return keep({ url, text }, "browser");
				}
			} catch (error) {
				console.error(`Couldn’t render ${url}`, error);
			}
		}
		if (plain) return plain;
		throw failure;
	};
}
