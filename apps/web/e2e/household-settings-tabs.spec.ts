import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { currentTab, sectionTabs } from "./section";
import { clientRendered, createHousehold, signedInPage } from "./session";

// Household settings has three tabs, each with an address of its own (issue 157): Settings, Logs
// (the Log, which was a group of the settings page) and Changelog (what changed in Noodle,
// release by release, from src/changelog/changelog.md).

const NAV = "Household settings pages";

/** The releases as the file has them, top to bottom: the page must show the same, in that order. */
const written = [
	...readFileSync(new URL("../src/changelog/changelog.md", import.meta.url), "utf8")
		.replace(/<!--[\s\S]*?-->/g, "")
		.matchAll(/^## (\d{4}-\d{2}-\d{2}): (.+)$/gm),
].map((match) => ({ id: match[1] ?? "", title: (match[2] ?? "").trim() }));

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

/** Exactly one tab is the current one, and it is `label`. */
async function expectTab(page: Page, label: string) {
	await expect(sectionTabs(page, NAV)).toBeVisible(clientRendered);
	await expect(currentTab(page, NAV)).toHaveCount(1);
	await expect(currentTab(page, NAV)).toHaveText(label);
}

const releaseHeadings = (page: Page) => page.getByRole("heading", { level: 2 });

test("Household settings has Settings, Logs and Changelog tabs, each at its own address", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1280, height: 900 },
	});
	await createHousehold(page, "The Rinks", "Alex");

	// Settings is where Household settings opens, with what the page held before.
	await page.goto("/household");
	await expectTab(page, "Settings");
	await expect(sectionTabs(page, NAV).getByRole("link")).toHaveText([
		"Settings",
		"Logs",
		"Changelog",
	]);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("The Rinks");
	await expect(page.getByRole("heading", { name: "People", level: 2 })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Danger zone", level: 2 })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Log", level: 2, exact: true })).toHaveCount(0);

	// By the keyboard: the tabs are links, one Tab apart, and Enter opens one.
	await sectionTabs(page, NAV).getByRole("link", { name: "Settings" }).focus();
	await page.keyboard.press("Tab");
	await expect(sectionTabs(page, NAV).getByRole("link", { name: "Logs" })).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/\/household\/logs$/);
	await expectTab(page, "Logs");
	await expect(page.getByRole("heading", { name: "Log", level: 2, exact: true })).toBeVisible();
	await expect(page.getByRole("heading", { name: "People", level: 2 })).toHaveCount(0);
	// The Household's name stays over every tab.
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("The Rinks");

	await sectionTabs(page, NAV).getByRole("link", { name: "Changelog" }).click();
	await expect(page).toHaveURL(/\/household\/changelog$/);
	await expectTab(page, "Changelog");
	await expect(releaseHeadings(page).first()).toHaveText(written[0]?.title ?? "");

	await sectionTabs(page, NAV).getByRole("link", { name: "Settings" }).click();
	await expect(page).toHaveURL(/\/household$/);
	await expectTab(page, "Settings");

	// Each address opens its own tab when a browser lands on it.
	await page.goto("/household/logs");
	await expectTab(page, "Logs");
	await expect(page.getByRole("heading", { name: "Log", level: 2, exact: true })).toBeVisible();
	await page.goto("/household/changelog");
	await expectTab(page, "Changelog");
	await expect(releaseHeadings(page).first()).toBeVisible();
	await page.context().close();
});

test("the Log's old addresses open the Logs tab, filters kept", async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1280, height: 900 },
	});
	await createHousehold(page, "The Rinks", "Alex");

	// A bookmark of where the Log was.
	await page.goto("/household#log");
	await expect(page).toHaveURL(/\/household\/logs$/, clientRendered);
	await expectTab(page, "Logs");
	await expect(page.getByRole("heading", { name: "Log", level: 2, exact: true })).toBeVisible();

	// "See what changed" as it was linked: narrowed to a month. (The server sends the browser on,
	// and a browser keeps the part after the # through that: the Log is still what it names.)
	await page.goto("/household?month=2026-09#log");
	await expect(page).toHaveURL(/\/household\/logs\?month=2026-09(#log)?$/, clientRendered);
	await expectTab(page, "Logs");
	await expect(
		page.getByRole("button", { name: "Takes effect in September: show every month" }),
	).toBeVisible();

	await page.goto("/household?kind=rule#log");
	await expect(page).toHaveURL(/\/household\/logs\?kind=rule(#log)?$/, clientRendered);
	await expectTab(page, "Logs");
	await page.context().close();
});

test("the Changelog lists releases newest first, and a link to a release lands on it", async ({
	browser,
}) => {
	test.slow();
	expect(written.length, "releases in changelog.md").toBeGreaterThan(3);
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 1280, height: 700 },
	});
	await createHousehold(page, "The Rinks", "Alex");

	await page.goto("/household/changelog");
	await expectTab(page, "Changelog");
	// Every release in the file, in its order, each with its day and at least one change.
	await expect(releaseHeadings(page)).toHaveText(written.map((release) => release.title));
	const days = await page
		.locator("section[id] time")
		.evaluateAll((times) => times.map((time) => time.getAttribute("datetime") ?? ""));
	expect(days).toEqual(written.map((release) => release.id));
	expect(days, "newest first").toEqual([...days].sort().reverse());
	const newest = page.locator(`[id="${written[0]?.id}"]`);
	await expect(newest.locator("time")).toHaveText(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
	expect(await newest.getByRole("listitem").count()).toBeGreaterThan(0);
	// No ticket numbers in what a Parent reads.
	await expect(page.locator("section[id]").filter({ hasText: /#\d+/ })).toHaveCount(0);

	// The oldest release is far down the page: a link to its address opens the page there.
	const oldest = written.at(-1);
	const oldestSection = page.locator(`[id="${oldest?.id}"]`);
	await expect(oldestSection).not.toBeInViewport();
	await page.goto(`/household/changelog#${oldest?.id}`);
	await expectTab(page, "Changelog");
	await expect(oldestSection.getByRole("heading", { level: 2 })).toBeInViewport();

	// A release's title is the link to it.
	const third = written[2];
	await page.goto("/household/changelog");
	await expectTab(page, "Changelog");
	await page.getByRole("link", { name: third?.title ?? "", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/household/changelog#${third?.id}$`));
	await expect(
		page.locator(`[id="${third?.id}"]`).getByRole("heading", { level: 2 }),
	).toBeInViewport();
	await page.context().close();
});

test("each tab fits a 320 px phone without scrolling sideways", async ({ browser }) => {
	test.slow();
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 320, height: 640 },
		hasTouch: true,
		isMobile: true,
	});
	await createHousehold(page, "The Rinks", "Alex");
	for (const [path, label] of [
		["/household", "Settings"],
		["/household/logs", "Logs"],
		["/household/changelog", "Changelog"],
	] as const) {
		await page.goto(path);
		await expectTab(page, label);
		await page.evaluate(() => document.fonts.ready);
		const size = await page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			width: document.documentElement.clientWidth,
		}));
		expect(size.scrollWidth, `${path}: page scrolls sideways`).toBeLessThanOrEqual(size.width);
		// All three tabs are on the screen: none runs off the side.
		for (const tab of await sectionTabs(page, NAV).getByRole("link").all()) {
			const box = await tab.boundingBox();
			expect(box, `${path}: a tab's box`).not.toBeNull();
			expect((box?.x ?? 0) + (box?.width ?? 0), `${path}: a tab's right edge`).toBeLessThanOrEqual(
				320,
			);
			expect(box?.x ?? -1, `${path}: a tab's left edge`).toBeGreaterThanOrEqual(0);
		}
	}
	await page.context().close();
});
