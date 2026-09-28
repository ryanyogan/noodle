import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createHousehold, serverFn, signedInPage } from "./session";

// Screenshot regression for the app shell and its components, in both appearances,
// at iPhone and desktop sizes. Update baselines with `bun run e2e --update-snapshots`.
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
	await createHousehold(page, "The Rinks", "Alex");
	await page.context().close();
});

test.afterAll(async () => {
	await parent?.remove();
});

/** Waits until the page is hydrated and settled: fonts loaded and Clerk's (client-only) avatar rendered. */
async function settle(page: Page) {
	await page.evaluate(() => document.fonts.ready);
	await page.locator(".cl-userButtonTrigger").first().waitFor({ state: "attached" });
}

// The month name changes every month and Clerk's avatar differs per test user.
const dynamic = (page: Page) => [
	page
		.getByRole("heading", { level: 1 })
		.getByText(
			/^(January|February|March|April|May|June|July|August|September|October|November|December)$/,
		),
	page.locator(".cl-userButtonTrigger"),
];

for (const [screen, device] of Object.entries(screens)) {
	for (const colorScheme of schemes) {
		test(`shell on ${screen}, ${colorScheme}`, async ({ browser }) => {
			const page = await signedInPage(browser, parent.email, { ...device, colorScheme });
			const nav = page.getByRole("navigation", { name: "Main" });

			await page.goto("/month");
			await expect(page.getByRole("heading", { level: 1 })).toContainText("This Month");
			await expect(nav).toBeVisible();
			await settle(page);
			await expect(page).toHaveScreenshot(`month-${screen}-${colorScheme}.png`, {
				fullPage: true,
				mask: dynamic(page),
			});

			await nav.getByRole("link", { name: "Household" }).click();
			await expect(page.getByRole("heading", { name: "Parents" })).toBeVisible();
			await settle(page);
			await expect(page).toHaveScreenshot(`household-${screen}-${colorScheme}.png`, {
				fullPage: true,
				mask: dynamic(page),
			});
			await page.context().close();
		});
	}
}

test("keyboard focus is visible on the shell's navigation", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, screens.desktop);
	await page.goto("/month");
	await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	const link = page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Household" });
	await link.focus();
	await page.keyboard.press("Shift+Tab");
	await page.keyboard.press("Tab");
	await expect(link).toBeFocused();
	const outline = await link.evaluate((el) => getComputedStyle(el).outlineStyle);
	expect(outline).not.toBe("none");
	await page.context().close();
});

test("a slow page shows a skeleton, then its content", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, screens.desktop);
	await page.goto("/month");
	await settle(page); // hydrated, so the click is a client-side navigation
	await page.route(serverFn("getHouseholdParents"), async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 1500));
		await route.continue();
	});
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Household" })
		.click();
	await expect(page.getByRole("status", { name: "Loading" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Parents" })).toBeVisible();
	await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);
	await page.context().close();
});

test("a page that fails to load explains it and retries", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, screens.desktop);
	await page.goto("/month");
	await settle(page); // hydrated, so the click is a client-side navigation
	const parents = serverFn("getHouseholdParents");
	await page.route(parents, (route) =>
		route.fulfill({ status: 500, body: "Internal Server Error" }),
	);
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Household" })
		.click();
	await expect(page.getByRole("alert")).toContainText("This page didn’t load");

	await page.unroute(parents);
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(page.getByRole("heading", { name: "Parents" })).toBeVisible();
	await page.context().close();
});
