import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import {
	accountKindLabel,
	choose,
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

/**
 * An item's page (`DetailHeader`) keeps the same rule, in place of its section's header: one row at least
 * as tall as the page's, on the gutter, with Back (its arrow on the gutter), the title and
 * previous/next; at most one action; anything to switch comes under it.
 */
async function expectDetailHeader(page: Page, what: string) {
	const width = page.viewportSize()?.width ?? 393;
	const header = page.locator("[data-slot=detail-header]:visible");
	await expect(header, what).toHaveCount(1);
	await expect(page.locator("[data-slot=skeleton]:visible"), what).toHaveCount(0);
	const back = header.locator("[data-slot=detail-back]").getByRole("link");
	await expect(back, what).toHaveAccessibleName(/^Back to /);
	const box = await header.boundingBox();
	const title = await header.locator("[data-slot=detail-title]").boundingBox();
	const arrow = await back.boundingBox();
	if (!box || !title || !arrow) throw new Error(`${what}: no header`);
	expect(Math.round(box.x), `${what}: header starts at the gutter`).toBe(GUTTER);
	expect(Math.round(box.height), `${what}: header height`).toBeGreaterThanOrEqual(HEADER_HEIGHT);
	// It is the page's only header: the section's (its title, its action, its tabs) isn't drawn over
	// an open item, though its h1 is still there to be read out.
	expect(Math.round(box.y), `${what}: the item's header is the first thing`).toBe(GUTTER);
	const section = page.locator("[data-slot=page-header]");
	await expect(page.getByRole("heading", { level: 1 }), what).toHaveCount(1);
	// What is read out only is a 1px box: the header itself, or the header and tabs' wrapper.
	const readOut = page
		.locator("[data-slot=section-layout-header], [data-slot=page-header]")
		.first();
	const readOutBox = await readOut.boundingBox();
	expect(
		readOutBox?.height ?? 0,
		`${what}: the section's header takes no room`,
	).toBeLessThanOrEqual(1);
	await expect(section.locator("a:visible, button:visible"), what).toHaveCount(0);
	await expect(
		page.locator("[data-slot=section-layout-header] [data-slot=link-tabs]:visible"),
		what,
	).toHaveCount(0);
	// The arrow's 20px glyph, in the middle of its 44px link, starts on the gutter.
	expect(
		Math.abs(arrow.x + arrow.width / 2 - 10 - GUTTER),
		`${what}: Back's arrow is on the gutter`,
	).toBeLessThanOrEqual(1);
	// Back and the title share the first row, and so do previous and next.
	const beside = (other: { y: number; height: number }) =>
		other.y < title.y + title.height && other.y + other.height > title.y - 20;
	expect(title.x, `${what}: the title is after Back`).toBeGreaterThanOrEqual(
		arrow.x + arrow.width - 1,
	);
	expect(beside(arrow), `${what}: Back is on the title's row`).toBe(true);
	const pager = header.locator("[data-slot=detail-pager]:visible");
	if ((await pager.count()) > 0) {
		const arrows = await pager.boundingBox();
		if (!arrows) throw new Error(`${what}: no previous and next`);
		expect(beside(arrows), `${what}: previous and next are on the title's row`).toBe(true);
		expect(arrows.x, `${what}: previous and next are right of the title`).toBeGreaterThanOrEqual(
			title.x,
		);
	}
	expect(
		await header.locator("[data-slot=detail-actions]").locator("a:visible, button:visible").count(),
		`${what}: at most one action`,
	).toBeLessThanOrEqual(1);
	const strips = page
		.locator("[data-slot=master-detail-detail]")
		.locator("[data-slot=link-tabs]:visible, [role=tablist]:visible");
	for (const strip of await strips.all()) {
		const top = (await strip.boundingBox())?.y ?? 0;
		expect(top, `${what}: tabs above the item's title`).toBeGreaterThanOrEqual(box.y + box.height);
	}
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth),
		`${what}: sideways scroll`,
	).toBeLessThanOrEqual(width);
}

test("an item's page has the same header: Back, title and arrows on one row, one action", async ({
	browser,
}) => {
	test.slow();
	const page = await signedInPage(browser, parent.email);
	const items: [what: string, path: string][] = [];
	const keep = (what: string) => items.push([what, new URL(page.url()).pathname]);

	// A Bucket (the Household's own).
	await page.goto("/plan");
	await expect(page).toHaveURL(/\/plan\/\d{4}-\d{2}$/);
	const month = new URL(page.url()).pathname.split("/").pop();
	await page.goto(`/plan/${month}/buckets`);
	const list = page.locator("[data-slot=master-detail-list]");
	await list.getByRole("link", { name: "Groceries", exact: true }).click();
	await expect(page).toHaveURL(/\/buckets\/[0-9A-Z]{26}$/);
	keep("a Bucket");

	// A Commitment.
	await page.goto(`/plan/${month}/commitments`);
	const form = page.getByRole("form", { name: "Add a Commitment" });
	await form.getByLabel("New Commitment").fill("Phones");
	await form.getByLabel("Amount due").fill("120");
	await form.getByRole("button", { name: "Add Commitment" }).click();
	await expect(page.getByRole("button", { name: "Edit Phones" })).toBeVisible();
	await list.getByRole("link", { name: "Phones", exact: true }).click();
	await expect(page).toHaveURL(/\/commitments\/[0-9A-Z]{26}$/);
	keep("a Commitment");

	// An Account.
	await page.goto("/accounts");
	await page.getByLabel("Name").fill("Joint Savings");
	await choose(page, "Kind", accountKindLabel("savings"));
	await page.getByLabel("Balance now").fill("8,000");
	await page.getByRole("button", { name: "Add Account" }).click();
	await list.getByRole("link", { name: /^Joint Savings, / }).click();
	await expect(page).toHaveURL(/\/accounts\/[0-9A-Z]{26}$/);
	keep("an Account");

	// Two Goals, so the second has previous and next.
	await page.goto("/goals");
	for (const name of ["Trip", "Car"]) {
		await page.getByRole("button", { name: "Add Goal" }).click();
		const add = page.getByRole("dialog", { name: "Add a Goal" });
		await add.getByLabel("Name").fill(name);
		await add.getByLabel("Target", { exact: true }).fill("3,000");
		await add.getByRole("button", { name: "Add Goal" }).click();
		await expect(add).toBeHidden();
		await expect(list.getByRole("link", { name: new RegExp(`^${name}, `) })).toBeVisible();
	}
	await list.getByRole("link", { name: /^Car, / }).click();
	await expect(page).toHaveURL(/\/goals\/[0-9A-Z]{26}$/);
	await expect(page.locator("[data-slot=detail-pager]:visible")).toHaveCount(1);
	keep("a Goal");

	// A Scenario: a raise.
	await page.goto("/explore?lever=baseline:600000");
	await expect(page.getByRole("region", { name: "Your changes" })).toContainText("Income", {
		timeout: 30_000,
	});
	await page.getByLabel("Name", { exact: true }).fill("Raise");
	await page.getByRole("button", { name: "Save Scenario" }).click();
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Raise");
	await page.goto("/explore/scenarios");
	await page.getByRole("link", { name: "Raise", exact: true }).first().click();
	await expect(page).toHaveURL(/\/explore\/scenarios\/[^/]+$/);
	// The header's one action; Rename and Delete come after the Scenario.
	const header = page.locator("[data-slot=detail-header]:visible");
	await expect(header.getByRole("link", { name: "Open in Explore" })).toBeVisible();
	await expect(header.getByRole("button", { name: "Rename" })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Rename" })).toBeVisible();
	await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
	keep("a Scenario");

	const height = page.viewportSize()?.height ?? 852;
	for (const width of [393, 320]) {
		await page.setViewportSize({ width, height });
		for (const [what, path] of items) {
			await page.goto(path);
			await expectDetailHeader(page, `${what} at ${width}`);
		}
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
