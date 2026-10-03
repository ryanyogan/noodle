import type { BrowserContextOptions, Page } from "@playwright/test";

/** Each phone check runs as it comes, and once more dark with reduced motion. */
export const looks: { name: string; options: BrowserContextOptions }[] = [
	{ name: "", options: {} },
	{ name: " (dark, reduced motion)", options: { colorScheme: "dark", reducedMotion: "reduce" } },
];

/** An iPhone's notch (status bar) and home indicator. */
export const notch = { top: 59, bottom: 34 };

/**
 * Runs the page as the installed app on an iPhone with a notch: `display-mode: standalone` and
 * `navigator.standalone`, and the safe areas the app reads through `--safe-*`
 * (packages/ui's globals.css; `env(safe-area-inset-*)` can't be set from a test). Reloads the page.
 *
 * CSS can't be made to see display-mode from a test, so the app's own check (data-standalone, set
 * in __root.tsx from these two) is what styles the installed app.
 */
export async function installed(page: Page) {
	await page.addInitScript(({ top, bottom }) => {
		const realMatchMedia = window.matchMedia.bind(window);
		window.matchMedia = (query: string) => {
			const result = realMatchMedia(query);
			if (!/display-mode:\s*standalone/.test(query)) return result;
			return {
				matches: true,
				media: query,
				onchange: null,
				addEventListener: () => {},
				removeEventListener: () => {},
				addListener: () => {},
				removeListener: () => {},
				dispatchEvent: () => false,
			} as MediaQueryList;
		};
		Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true });
		// A constructed sheet, outside the DOM, so hydrating the page can't take it away.
		const safe = new CSSStyleSheet();
		safe.replaceSync(
			`:root { --safe-top: ${top}px !important; --safe-bottom: ${bottom}px !important; }`,
		);
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, safe];
	}, notch);
	await page.reload();
}
