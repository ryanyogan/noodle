import { expect, type Page, test } from "@playwright/test";
import { settledAxe } from "./axe";
import { createTestParent } from "./parents";
import { createHousehold, openFromMore, serverFn, signedInPage } from "./session";

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

// In order and in one worker (the tests share a Household), but a failure doesn't skip the rest:
// one run reports every stale picture.
test.describe.configure({ mode: "default" });

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeAll(async ({ browser }) => {
	// A Parent of this file's own, signed in by each test: one test signs out, which would end the
	// session the worker keeps for a pooled Parent.
	parent = await createTestParent({ fresh: true });
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
	// The sidebar's Parent menu is ready once Clerk is; the Household page has Clerk's own button too.
	await page.locator("[data-parent-menu][data-ready=true]").waitFor({ state: "attached" });
	if (new URL(page.url()).pathname.startsWith("/household")) {
		await page.locator(".cl-userButtonTrigger").first().waitFor({ state: "attached" });
	}
}

// The month name changes every month and Clerk's avatar differs per test user.
const dynamic = (page: Page) => [
	page.getByRole("heading", { level: 1 }).filter({
		hasText:
			/^(January|February|March|April|May|June|July|August|September|October|November|December)$/,
	}),
	page.locator(".cl-userButtonTrigger"),
	page.locator("[data-parent-menu] [data-slot=avatar]"),
	// Each run's test Parent has a new email, shown on the Household page.
	page.getByText(/@example\.com/),
];

for (const [screen, device] of Object.entries(screens)) {
	for (const colorScheme of schemes) {
		test(`shell on ${screen}, ${colorScheme}`, async ({ browser }) => {
			const page = await signedInPage(browser, parent.email, { ...device, colorScheme });
			const nav = page.getByRole("navigation", { name: "Main" });

			await page.goto("/month");
			await expect(page.locator("[data-slot=page-header]:visible")).toContainText("This Month");
			await expect(nav).toBeVisible();
			await settle(page);
			await expect.soft(page).toHaveScreenshot(`month-${screen}-${colorScheme}.png`, {
				fullPage: true,
				mask: dynamic(page),
			});

			// A phone's tab bar ends in More, which has Household settings; the Sidebar links to it.
			if (await nav.getByRole("link", { name: "More", exact: true }).isVisible()) {
				await openFromMore(page, "Household settings");
			} else {
				await nav.getByRole("link", { name: "Household" }).click();
			}
			await expect(page.getByRole("heading", { name: "Parents" })).toBeVisible();
			await settle(page);
			await expect.soft(page).toHaveScreenshot(`household-${screen}-${colorScheme}.png`, {
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
	// In plain words, never the error's own text.
	await expect(page.getByRole("alert")).toContainText("Something went wrong loading it");
	await expect(page.getByRole("alert")).not.toContainText("Invariant");

	await page.unroute(parents);
	await page.getByRole("button", { name: "Try again" }).click();
	await expect(page.getByRole("heading", { name: "Parents" })).toBeVisible();
	await page.context().close();
});

test("the sidebar marks the section you're in, collapses to a rail, and holds the Parent menu", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email, screens.desktop);
	await page.goto("/month");
	await settle(page);
	const nav = page.getByRole("navigation", { name: "Main" });
	const current = nav.locator("[aria-current=page]");

	// Groups are named, and the current destination comes from the route, sub-pages included.
	await expect(nav.getByRole("group", { name: "Day to day" }).getByRole("link")).toHaveText([
		"This Month",
		"Transactions",
		"Accounts",
	]);
	await expect(nav.getByRole("group").filter({ hasText: "Check-in" })).toHaveAccessibleName(
		"Household",
	);
	// Ask and the Glossary aren't in the Sidebar (#100): Ask is a small button on every page but its own.
	await expect(nav.getByRole("link", { name: "Ask" })).toHaveCount(0);
	await expect(nav.getByRole("button", { name: "Glossary" })).toHaveCount(0);
	const askButton = page.getByRole("link", { name: "Ask Noodle" });
	await expect(askButton).toBeVisible();
	const askBox = await askButton.boundingBox();
	expect(askBox?.width).toBeGreaterThanOrEqual(40);
	expect(askBox?.height).toBeGreaterThanOrEqual(40);
	await expect(current).toHaveText("This Month");
	const axe = async () =>
		(await (await settledAxe(page)).include("[data-slot=sidebar]").analyze()).violations;
	expect(await axe()).toEqual([]);
	for (const [path, label] of [
		["/month/2020-01", "This Month"],
		["/review", "Transactions"],
		["/review/rules", "Transactions"],
		["/explore/afford", "Explore"],
		["/insights", "Insights"],
		["/insights/perks", "Perks & Benefits"],
	] as const) {
		await page.goto(path);
		await expect(current).toHaveText(label);
		await expect(current).toHaveCount(1);
	}

	// Ctrl+B collapses it to the rail: links keep their names and gain a tooltip.
	await settle(page);
	const width = () =>
		page.getByRole("complementary").evaluate((el) => el.getBoundingClientRect().width);
	expect(await width()).toBe(248);
	await page.keyboard.press("Control+b");
	await expect.poll(width).toBe(60);
	await nav.getByRole("link", { name: "Goals" }).hover();
	await expect(page.getByRole("tooltip", { name: "Goals" })).toBeVisible();
	expect(await axe()).toEqual([]);

	// Remembered on this device, with no expanded flash to wait out.
	await page.reload();
	expect(await width()).toBe(60);
	await settle(page);
	await page.getByRole("button", { name: "Toggle sidebar" }).click();
	await expect.poll(width).toBe(248);

	// The Parent menu: Household settings, the account, and signing out.
	await page.getByRole("button", { name: /Account menu/ }).click();
	const menu = page.getByRole("menu");
	await expect(menu.getByRole("menuitem")).toHaveText([
		"Household settings",
		"Manage account…",
		"Sign out",
	]);
	await menu.getByRole("menuitem", { name: "Sign out" }).click();
	await expect(nav).toHaveCount(0);
	await page.context().close();
});

test("Ctrl/⌘+B leaves a text field alone, reads ⌘ on a Mac, and the rail looks right", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email, screens.desktop);
	// A Mac, as far as the page can tell (the shortcut's label reads navigator.platform).
	await page.addInitScript(() => {
		Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel" });
	});
	const width = () =>
		page.getByRole("complementary").evaluate((el) => el.getBoundingClientRect().width);

	// While typing, Ctrl+B and ⌘+B belong to the field.
	await page.goto("/transactions");
	await settle(page);
	const search = page.locator("input[type=search]:visible").first();
	await search.fill("coffee");
	await page.keyboard.press("Control+b");
	await page.keyboard.press("Meta+b");
	await expect(search).toBeFocused();
	expect(await width()).toBe(248);

	// The toggle's tooltip names the shortcut as a Mac does, and ⌘+B works outside a field.
	await page.getByRole("button", { name: "Toggle sidebar" }).hover();
	await expect(page.getByRole("tooltip")).toHaveText(/Collapse the sidebar\s*⌘ B/);
	await search.blur();
	await page.mouse.move(800, 600);
	await page.keyboard.press("Meta+b");
	await expect.poll(width).toBe(60);

	// The collapsed rail, by eye.
	await page.goto("/month");
	await settle(page);
	await expect(page.getByRole("tooltip")).toHaveCount(0);
	await expect(page.locator("[data-slot=sidebar]")).toHaveScreenshot("sidebar-rail-desktop.png", {
		mask: dynamic(page),
	});
	await page.context().close();
});

for (const [screen, device] of Object.entries(screens)) {
	test(`Reports on ${screen}`, async ({ browser }) => {
		const page = await signedInPage(browser, parent.email, { ...device, colorScheme: "light" });
		await page.goto("/reports");
		// The first visit compiles Reports in dev, so it may take longer than 5s.
		await expect(page.locator("[data-slot=page-header]:visible")).toContainText("Reports", {
			timeout: 20_000,
		});
		await settle(page);
		await page.evaluate(() => window.scrollTo(0, 0));
		await expect.soft(page).toHaveScreenshot(`reports-${screen}-light.png`, {
			fullPage: true,
			mask: dynamic(page),
		});
		await page.context().close();
	});
}
