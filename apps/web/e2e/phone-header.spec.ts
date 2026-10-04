import { expect, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	createPlannedHousehold,
	moreItem,
	moreItems,
	openFromMore,
	openMore,
	signedInPage,
} from "./session";

// The one phone header (#74, COMPONENTS.md "The phone header"): row 1 is the eyebrow and title with
// the page's action, the same height on every page; a page's tabs or switch come under it, never
// above. Nothing in the page opens a menu of other pages: those are in More, the tab bar's last item.

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

const PAGES = [
	"/month",
	"/plan",
	"/transactions",
	"/review",
	"/accounts",
	"/goals",
	"/explore",
	"/reports",
	"/insights",
	"/insights/perks",
	"/ask",
	"/check-in",
	"/household",
	"/glossary",
];

/** Row 1's height: the eyebrow's line and the title's. */
const HEADER_HEIGHT = 52;
const GUTTER = 16;

test("every page has the same header: eyebrow and title first, tabs under it, no menu of pages", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	for (const path of PAGES) {
		await page.goto(path);
		const header = page.locator("[data-slot=page-header]:visible").first();
		await expect(header, path).toBeVisible();
		await expect(page.locator("[data-slot=skeleton]:visible"), path).toHaveCount(0);
		await expect(header.getByRole("heading", { level: 1 }), path).toBeVisible();
		await expect(header.locator("[data-slot=page-eyebrow]"), path).toHaveCount(1);

		const box = await header.boundingBox();
		const title = await header.getByRole("heading", { level: 1 }).boundingBox();
		if (!box || !title) throw new Error(`${path}: no header`);
		expect(Math.round(box.x), `${path}: header starts at the gutter`).toBe(GUTTER);
		expect(Math.round(title.x), `${path}: title starts at the gutter`).toBe(GUTTER);
		expect(Math.round(box.height), `${path}: header height`).toBe(HEADER_HEIGHT);
		// Nothing but the top padding is above it.
		expect(Math.round(box.y), `${path}: header is the first thing`).toBe(GUTTER);

		// Tabs and switches, wherever they are in the page, start under the title row.
		const strips = page
			.getByRole("main")
			.locator("[data-slot=link-tabs]:visible, [role=tablist]:visible");
		for (const strip of await strips.all()) {
			const top = (await strip.boundingBox())?.y ?? 0;
			expect(top, `${path}: a tab strip above the title`).toBeGreaterThanOrEqual(
				box.y + box.height,
			);
		}

		// The old top-row menu (⋯) is gone, and so are the header links to pages More has.
		const main = page.getByRole("main");
		await expect(main.getByRole("button", { name: "More", exact: true }), path).toHaveCount(0);
		await expect(header.getByRole("link", { name: /^(Accounts|Explore)$/ }), path).toHaveCount(0);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth),
			`${path}: sideways scroll`,
		).toBeLessThanOrEqual(page.viewportSize()?.width ?? 393);
	}
	await page.context().close();
});

const DESTINATIONS: Record<Exclude<(typeof moreItems)[number], "Glossary">, RegExp> = {
	Review: /\/review$/,
	Accounts: /\/accounts$/,
	Plan: /\/plan\/\d{4}-\d{2}$/,
	Explore: /\/explore/,
	Reports: /\/reports/,
	Insights: /\/insights$/,
	"Credit card perks": /\/insights\/perks$/,
	Ask: /\/ask$/,
	"Check-in": /\/check-in$/,
	"Household settings": /\/household$/,
};

test("More in the tab bar reaches every page that isn't a tab, and Back closes it", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	await page.goto("/month");
	const tabs = page.getByRole("navigation", { name: "Main" });
	await expect(tabs.getByRole("link")).toHaveText([
		"Month",
		"Transactions",
		"Quick Add",
		"Goals",
		"More",
	]);
	const more = tabs.getByRole("link", { name: "More", exact: true });
	await expect(more).not.toHaveAttribute("aria-current");

	// Everything, in the Sidebar's groups, then the Parent: their account and Sign out.
	const sheet = await openMore(page);
	for (const group of ["Day to day", "Planning", "Understand", "Household"]) {
		await expect(sheet.getByText(group, { exact: true })).toBeVisible();
	}
	for (const item of moreItems) await expect(moreItem(sheet, item)).toBeVisible();
	const account = sheet.getByRole("region", { name: "Your account" });
	await expect(account.getByRole("button", { name: "Manage account" })).toBeVisible();
	await expect(account.getByRole("button", { name: "Sign out" })).toBeVisible();
	// The sheet ends at the bottom of the window and fits its width.
	const box = await sheet.boundingBox();
	const viewport = page.viewportSize();
	expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(viewport?.height);
	expect(Math.round(box?.width ?? 0)).toBe(viewport?.width);

	// Back closes it and stays on the page.
	await page.goBack();
	await expect(sheet).toBeHidden();
	await expect(page).toHaveURL(/\/month\/\d{4}-\d{2}$/);

	for (const [item, url] of Object.entries(DESTINATIONS)) {
		await openFromMore(page, item as keyof typeof DESTINATIONS);
		await expect(page, item).toHaveURL(url);
		await expect(page.getByRole("heading", { level: 1 }).first(), item).toBeVisible();
		if (item !== "Review") {
			// More is marked on its own pages, and the sheet marks the page.
			await expect(more, item).toHaveAttribute("aria-current", "true");
		}
		const again = await openMore(page);
		await expect(moreItem(again, item as keyof typeof DESTINATIONS), item).toHaveAttribute(
			"aria-current",
			"page",
		);
		await again.getByRole("button", { name: "Close" }).click();
		await expect(again).toBeHidden();
		await expect(page, item).toHaveURL(url);
	}

	// Picking a page replaced the sheet's entry: one Back leaves the page for the one before it.
	await page.goBack();
	await expect(page).toHaveURL(DESTINATIONS["Check-in"]);

	// The Glossary opens over the page.
	await openFromMore(page, "Glossary");
	await expect(page.getByRole("dialog", { name: "Glossary" })).toBeVisible();
	await page.context().close();
});
