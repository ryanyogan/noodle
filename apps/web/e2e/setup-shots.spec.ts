import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createHousehold, savedBy, signedInPage } from "./session";

// Screenshot regression for the get-started wizard (#53): Hello and Buckets, in both appearances,
// at iPhone and desktop sizes, on the by-hand path (nothing in the background changes the screen).
// Update baselines with `PORT=5174 AI_MODEL=stub bunx playwright test setup-shots --update-snapshots --workers=1`.
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

test.describe.configure({ mode: "serial" });

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeAll(async ({ browser }) => {
	parent = await createTestParent();
	const page = await signedInPage(browser, parent.email);
	await createHousehold(page, "The Rinks", "Alex", { viaUi: true });
	await page.context().close();
});

test.afterAll(async () => {
	await parent?.remove();
});

const step = (page: Page, n: number) => expect(page.getByText(`Step ${n} of 7`)).toBeVisible();

/** Opens the wizard at Buckets, going there by hand the first time (the Household is shared). */
async function toBuckets(page: Page) {
	await page.goto("/setup");
	await expect(page.getByText(/Step \d of 7/)).toBeVisible();
	if (await page.getByText("Step 4 of 7").isVisible()) return;
	const proceed = page.getByRole("button", { name: "Continue", exact: true });
	// The choice only counts once the page is hydrated.
	await expect(async () => {
		await page.getByRole("radio", { name: /by hand/ }).click();
		await expect(proceed).toBeEnabled({ timeout: 1000 });
	}).toPass();
	let saved = savedBy(page, "saveSetup");
	await proceed.click();
	await saved;
	await step(page, 2);
	await page.getByRole("textbox", { name: /What lands in your account/ }).fill("6,000");
	saved = savedBy(page, "saveSetup");
	await proceed.click();
	await saved;
	await step(page, 3);
	saved = savedBy(page, "saveSetup");
	await page.getByRole("button", { name: "Skip" }).click();
	await saved;
	await step(page, 4);
}

for (const name of ["hello", "buckets"] as const) {
	for (const [screen, device] of Object.entries(screens)) {
		for (const colorScheme of schemes) {
			test(`${name} on ${screen}, ${colorScheme}`, async ({ browser }) => {
				const page = await signedInPage(browser, parent.email, { ...device, colorScheme });
				if (name === "hello") {
					await page.goto("/setup");
					await step(page, 1);
				} else {
					await toBuckets(page);
				}
				await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
				await page.evaluate(() => document.fonts.ready);
				// Nothing still loading or moving: the step's own data is in, and no transition is mid-way.
				await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
				await page.waitForLoadState("networkidle");
				await expect(page.locator("[aria-busy=true], [data-slot=skeleton]")).toHaveCount(0);
				// The sticky bar of buttons sits wherever the page is scrolled to, in a full-page shot too.
				// Walking the wizard by hand could leave it scrolled a little (or not, by timing), which
				// moved the bar by a few dozen pixels: always shoot from the top.
				await expect
					.poll(() =>
						page.evaluate(() => {
							window.scrollTo(0, 0);
							return window.scrollY;
						}),
					)
					.toBe(0);
				// The primary button stays on screen, whatever the step's length.
				await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeInViewport();
				await expect(page).toHaveScreenshot(`setup-${name}-${screen}-${colorScheme}.png`, {
					fullPage: true,
				});
				await page.context().close();
			});
		}
	}
}
