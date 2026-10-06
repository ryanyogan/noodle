import { setupClerkTestingToken } from "@clerk/testing/playwright";
import {
	type Browser,
	type BrowserContextOptions,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { settledAxe } from "./axe";
import { measure } from "./overflow";
import { createTestParent } from "./parents";
import { createPlannedHousehold, openMore, signedInPage } from "./session";

// The Docs (issue 126): public pages at /docs, one address an article, with a search, a list of
// articles beside the one being read on a computer and behind "All docs" on a phone, and a small
// link from the account menu and from the phone's More.

const phone = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true };

async function signedOut(browser: Browser, options: BrowserContextOptions) {
	const context = await browser.newContext({ reducedMotion: "reduce", ...options });
	const page = await context.newPage();
	await setupClerkTestingToken({ page });
	return page;
}

const shot = async (page: Page, name: string) => {
	if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` });
};

async function expectNoOverflow(page: Page) {
	const { scrollWidth, width, sticking } = await measure(page);
	expect(sticking).toEqual([]);
	expect(scrollWidth).toBeLessThanOrEqual(width);
}

async function expectAccessible(page: Page) {
	for (const colorScheme of ["light", "dark"] as const) {
		await page.emulateMedia({ colorScheme });
		const results = await (await settledAxe(page)).analyze();
		expect(results.violations, colorScheme).toEqual([]);
	}
	await page.emulateMedia({ colorScheme: "light" });
}

test("signed out, a Parent reads the Docs and finds an article by a word in its text", async ({
	browser,
}) => {
	const page = await signedOut(browser, { viewport: { width: 1440, height: 900 } });
	await page.goto("/docs");
	await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
	await shot(page, "home-1440-light");

	// The list beside the page opens an article at its own address.
	await page
		.getByRole("navigation", { name: "All docs" })
		.getByRole("link", { name: "Getting started in five minutes" })
		.click();
	await expect(page).toHaveURL(/\/docs\/getting-started$/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Getting started in five minutes",
	);
	await expect(page.getByRole("link", { name: /^Next/ })).toContainText("What budgeting is");

	// "Lumpy" is only in the text of one article. Typed again until the page has hydrated.
	const search = page.getByRole("combobox", { name: "Search the Docs" });
	const matches = page.getByRole("listbox", { name: "Matching articles" });
	await expect(search).toHaveAttribute("enterkeyhint", "search");
	await expect(async () => {
		// Emptied first: typing the same word again after hydration would not count as a change.
		await search.fill("");
		await search.fill("lumpy");
		await expect(matches).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 20_000 });
	await expect(matches.getByRole("option")).toHaveCount(1);
	await expect(matches.getByRole("option")).toContainText(/How to budget with Noodle.*Lumpy month/);
	await shot(page, "search-1440-light");
	// Esc clears it; the arrows mark a match and Enter opens it.
	await page.keyboard.press("Escape");
	await expect(matches).toBeHidden();
	await search.fill("month");
	await expect(matches.getByRole("option").first()).toHaveAttribute("aria-selected", "true");
	await page.keyboard.press("ArrowDown");
	await expect(matches.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
	await search.fill("lumpy");
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/\/docs\/how-to-budget$/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("How to budget with Noodle");
	await expect(page.getByRole("navigation", { name: "On this page" })).toBeVisible();

	await expectNoOverflow(page);
	await expectAccessible(page);
	await shot(page, "article-1440-light");
	await page.emulateMedia({ colorScheme: "dark" });
	await shot(page, "article-1440-dark");
	await page.context().close();
});

test("on a phone, the article comes first and All docs lists the rest", { tag: "@phone" }, async ({
	browser,
}) => {
	const page = await signedOut(browser, phone);
	await page.goto("/docs/this-month");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("This Month");
	await expect(page.getByRole("navigation", { name: "All docs" })).toBeHidden();
	await expectNoOverflow(page);
	await expectAccessible(page);
	await shot(page, "article-393-light");
	await page.emulateMedia({ colorScheme: "dark" });
	await shot(page, "article-393-dark");
	await page.emulateMedia({ colorScheme: "light" });

	const sheet = page.getByRole("dialog", { name: "All docs" });
	await expect(async () => {
		if (!(await sheet.isVisible())) {
			await page.getByRole("button", { name: "All docs" }).click({ timeout: 2_000 });
		}
		await expect(sheet).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout: 20_000 });
	await expect(sheet.getByRole("link", { name: "This Month" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await shot(page, "all-docs-393-light");
	await sheet.getByRole("link", { name: "What budgeting is" }).click();
	await expect(sheet).toBeHidden();
	await expect(page).toHaveURL(/\/docs\/what-budgeting-is$/);

	// The narrowest phone: the front page, an article and the search's matches all fit.
	await page.setViewportSize({ width: 320, height: 568 });
	await expectNoOverflow(page);
	await page.getByRole("combobox", { name: "Search the Docs" }).fill("free to spend");
	await expect(page.getByRole("listbox", { name: "Matching articles" })).toBeVisible();
	await expectNoOverflow(page);
	await shot(page, "search-320-light");
	await page.keyboard.press("Escape");
	await shot(page, "article-320-light");
	await page.goto("/docs");
	await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
	await expectNoOverflow(page);
	await shot(page, "home-320-light");
	await page.context().close();
});

test.describe("from the app", () => {
	let parent: Awaited<ReturnType<typeof createTestParent>>;

	test.beforeAll(async ({ browser }) => {
		parent = await createTestParent();
		const page = await signedInPage(browser, parent.email);
		await createPlannedHousehold(page, { baseline: "5,000", buckets: [["Groceries", "600"]] });
		await page.context().close();
	});

	test.afterAll(async () => {
		await parent?.remove();
	});

	test("the account menu has a Docs link", async ({ browser }) => {
		const page = await signedInPage(browser, parent.email, {
			viewport: { width: 1440, height: 900 },
		});
		await page.goto("/month");
		await page.locator("[data-parent-menu][data-ready=true]").waitFor({ state: "attached" });
		await page.getByRole("button", { name: /Account menu/ }).click();
		await shot(page, "menu-1440-light");
		await page.getByRole("menu").getByRole("menuitem", { name: "Docs" }).click();
		await expect(page).toHaveURL(/\/docs$/);
		await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
		await page.context().close();
	});

	test("on a phone, More has a Docs link beside the account", { tag: "@phone" }, async ({
		browser,
	}) => {
		for (const width of [393, 320]) {
			const page = await signedInPage(browser, parent.email, {
				...phone,
				viewport: { width, height: 852 },
			});
			await page.goto("/month");
			const sheet = await openMore(page);
			const link = sheet
				.getByRole("region", { name: "Your account" })
				.getByRole("link", { name: "Docs" });
			await expect(link).toBeInViewport({ ratio: 0.99 });
			await expectNoOverflow(page);
			await shot(page, `more-${width}-light`);
			if (width === 393) {
				await link.click();
				await expect(page).toHaveURL(/\/docs$/);
				await expect(page.getByRole("heading", { level: 1, name: "Docs" })).toBeVisible();
			}
			await page.context().close();
		}
	});
});
