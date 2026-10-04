import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, type Page, test } from "@playwright/test";

// Screenshot regression for sign-in and sign-up (#59), in both appearances, at iPhone and desktop
// sizes, Clerk's card included. Update baselines with
// `PORT=5174 bunx playwright test e2e/auth-shots.spec.ts --update-snapshots`.
const screens = {
	iphone: {
		viewport: { width: 393, height: 852 },
		deviceScaleFactor: 3,
		isMobile: true,
		hasTouch: true,
	},
	desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
} as const;
const schemes = ["light", "dark"] as const;
const pages = { "sign-in": "/sign-in", "sign-up": "/sign-up" } as const;

/** Waits for hydration, fonts, Clerk's card and its provider icons. */
async function settle(page: Page) {
	await expect(page.locator(".cl-formButtonPrimary")).toBeVisible({ timeout: 15_000 });
	await page.evaluate(() => document.fonts.ready);
	await page.waitForFunction(() =>
		Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
	);
}

for (const [screen, device] of Object.entries(screens)) {
	for (const colorScheme of schemes) {
		for (const [name, path] of Object.entries(pages)) {
			test(`${name} on ${screen}, ${colorScheme}`, async ({ browser }) => {
				const context = await browser.newContext({
					...device,
					colorScheme,
					reducedMotion: "reduce",
				});
				const page = await context.newPage();
				await setupClerkTestingToken({ page });
				await page.goto(path);
				await settle(page);
				await expect.soft(page).toHaveScreenshot(`${name}-${screen}-${colorScheme}.png`, {
					fullPage: true,
				});
				await context.close();
			});
		}
	}
}
