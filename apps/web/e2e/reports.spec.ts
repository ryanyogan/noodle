import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { seedReportHistory } from "./reports-seed";
import { choose, clientRendered, createPlannedHousehold, signedInPage } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const plan = {
	baseline: "8,000",
	buckets: [
		["Groceries", "1,100"],
		["Eating out", "300"],
		["Kids", "450"],
		["Fun", "400"],
	] as [string, string][],
};

const header = (page: Page) => page.locator("[data-slot=page-header]:visible");

// Reports render only in the browser, so the tests arrive the way a Parent does, by the Reports
// link from the running app; the one full load they mean (a reload keeps the options) waits on
// clientRendered.

test("Reports: change the period, then drill from a Bucket to its Transactions", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	seedReportHistory(parent.userId);

	await page.getByRole("link", { name: "Reports" }).click();
	await expect(header(page)).toContainText("Overview");
	await expect(page.getByText("Income and spending")).toBeVisible();
	// Six months of history: the six months before them had nothing, so no "226% more".
	const nothingEarlier = page.getByText(
		/^Nothing earlier to compare with: your history starts in /,
	);
	await expect(nothingEarlier).toBeVisible();

	await choose(page, "Period", "Last 3 months");
	await expect(page).toHaveURL(/period=3m/);
	// The three months before are within the history, so they're compared.
	await expect(nothingEarlier).toHaveCount(0);
	// Every option lives in the URL, so a reload keeps it.
	await page.reload();
	await expect(page.getByRole("combobox", { name: "Period" })).toHaveText(
		"Last 3 months",
		clientRendered,
	);

	await page.getByRole("link", { name: "Buckets", exact: true }).click();
	await expect(header(page)).toContainText("Buckets");
	await page.getByRole("button", { name: /^Groceries: \$/ }).click();
	await expect(page).toHaveURL(/area=bucket/);
	await expect(page.getByText("Pick a month to see its Transactions")).toBeVisible();

	await page.getByRole("link", { name: "Open in Transactions" }).click();
	await expect(page).toHaveURL(/\/transactions\/\d{4}-\d{2}/);
	await expect(page.getByText("Costco").first()).toBeVisible();
});

test("Big expenses are the one-offs over a threshold the Parent picks", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	seedReportHistory(parent.userId);

	await page.getByRole("link", { name: "Reports" }).click();
	await expect(header(page)).toContainText("Overview");
	await page.getByRole("link", { name: "Big expenses" }).click();
	await expect(page).toHaveURL(/view=big/);
	await expect(header(page)).toContainText("Big expenses");
	const largest = page.getByRole("group", { name: "Largest Transactions" });
	await expect(largest.getByText("Flights to Denver")).toBeVisible();
	// Commitments are expected, not big expenses: they have their own card.
	await expect(largest.getByText("Mortgage")).toHaveCount(0);
	await expect(page.getByText("Commitments, by the year")).toBeVisible();

	// The thresholds are a radio group: the arrow keys choose, as on a slider.
	const over = page.getByRole("radiogroup", { name: "What did we spend over…" });
	await over.getByRole("radio", { checked: true }).focus();
	await page.keyboard.press("ArrowRight");
	await expect(page).toHaveURL(/over=500/);
	await page.keyboard.press("ArrowRight");
	await expect(page).toHaveURL(/over=1000/);
	await expect(page.getByText("One-offs over $1,000", { exact: true })).toBeVisible();
	await expect(largest.getByText("Car repair")).toBeVisible();
	await expect(largest.getByText("Dentist")).toHaveCount(0);
});

test("Phones reach Reports from This Month", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email, {
		viewport: { width: 393, height: 852 },
		isMobile: true,
		hasTouch: true,
	});
	await createPlannedHousehold(page, plan);
	await page.getByRole("link", { name: "Reports" }).click();
	await expect(header(page)).toContainText("Overview");
});

test("no Report view is wider than a phone, and a long merchant name stays in its card", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, plan);
	seedReportHistory(parent.userId, 12);
	// A merchant as the bank writes it: one long unbroken line.
	const longName = "SQ *EL CHILITO TACOS & BREAKFAST BAR ON MANOR ROAD AUSTIN TX 78722";
	await page.getByRole("link", { name: "Quick Add" }).click();
	const quickAdd = page.getByRole("dialog", { name: "Quick Add" });
	await expect(quickAdd).toBeVisible();
	await page.keyboard.type("3000");
	await quickAdd.getByLabel("Note").fill(longName);
	await quickAdd.getByRole("button", { name: /^Eating out/ }).click();
	await expect(quickAdd).toBeHidden();

	await page.getByRole("link", { name: "Reports" }).click();
	await expect(header(page)).toContainText("Overview");
	// By keyboard: the Select opens on Enter, the arrows move, Enter chooses, and focus comes back.
	const period = page.getByRole("combobox", { name: "Period" });
	await period.focus();
	await page.keyboard.press("Enter");
	const listbox = page.getByRole("listbox");
	await expect(listbox.getByRole("option", { name: "Last 6 months" })).toBeFocused();
	await page.keyboard.press("ArrowDown");
	await expect(listbox.getByRole("option", { name: "Last 12 months" })).toBeFocused();
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/period=12m/);
	await expect(period).toBeFocused();
	await expect(period).toHaveText("Last 12 months");

	// Merchants on desktop: the amounts stay inside the card beside the long name.
	await page.getByRole("link", { name: "Merchants", exact: true }).click();
	await expect(header(page)).toContainText("Merchants");
	const visits = page.getByRole("group", { name: "By spending" });
	const row = visits.getByRole("button", {
		name: new RegExp(`^${longName.slice(0, 20).replace(/[*]/g, "\\*")}`),
	});
	await expect(row).toBeVisible();
	const [card, button] = await Promise.all([visits.boundingBox(), row.boundingBox()]);
	expect((button?.x ?? 0) + (button?.width ?? 0)).toBeLessThanOrEqual(
		(card?.x ?? 0) + (card?.width ?? 0),
	);

	// On a phone, no view scrolls sideways.
	await page.setViewportSize({ width: 393, height: 852 });
	const views = page.getByRole("navigation", { name: "Report views" }).getByRole("link");
	for (const name of await views.allInnerTexts()) {
		await views.filter({ hasText: name }).first().click();
		await expect(header(page)).toContainText(name);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
			`${name} scrolls sideways`,
		).toBe(true);
	}
});
