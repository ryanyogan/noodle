import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage, switchTo } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const waterfall = (page: Page) =>
	page.getByRole("region", { name: "From take-home pay to Free to Spend" });
const health = (page: Page) => page.getByRole("region", { name: "Plan health" });
const addForm = (page: Page) => page.getByRole("form", { name: "Add a Commitment" });

const monthName = (month: string) =>
	new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-US", {
		month: "long",
		timeZone: "UTC",
	});

function addMonths(month: string, count: number) {
	const [year = 0, m = 0] = month.split("-").map(Number);
	return new Date(Date.UTC(year, m - 1 + count, 1)).toISOString().slice(0, 7);
}

test("the year at a glance, and Plan health pointing at the fix", async ({ browser }) => {
	const page = await signedInPage(browser, parent.email);
	await createPlannedHousehold(page, { baseline: "9,000", buckets: [["Groceries", "1,200"]] });
	await switchTo(page, "Plan");
	await expect(waterfall(page)).toBeVisible();
	const month = /\/plan\/(\d{4}-\d{2})/.exec(page.url())?.[1];
	if (!month) throw new Error(`No month in ${page.url()}`);
	// A healthy Plan has nothing to warn about.
	await expect(health(page)).toHaveCount(0);

	// A yearly Commitment bigger than a month's take-home pay, due two months from now.
	const lumpy = addMonths(month, 2);
	await waterfall(page).getByRole("link", { name: "Commitments", exact: true }).click();
	const form = addForm(page);
	await form.getByLabel("New Commitment").fill("Roof");
	await form.getByLabel("Amount due").fill("12,000");
	await form.getByLabel("How often").selectOption({ label: "Yearly" });
	await form.getByLabel("Due on").fill(`${lumpy}-10`);
	await form.getByRole("button", { name: "Add Commitment" }).click();
	await expect(page.getByRole("button", { name: "Edit Roof" })).toBeVisible();
	await page.getByRole("link", { name: "Back to Plan" }).click();

	// Plan health: Free to Spend goes below zero then, and the warning opens that month's Plan.
	const warning = health(page).getByRole("link", {
		name: `Free to Spend goes below zero in ${monthName(lumpy)}`,
	});
	await expect(warning).toBeVisible();
	await expect(health(page)).toContainText("−$4,200 in the Plan as it stands");
	await warning.click();
	await expect(page).toHaveURL(new RegExp(`/plan/${lumpy}$`));
	await expect(page.getByRole("heading", { level: 1 })).toContainText(monthName(lumpy));

	// The year at a glance, from the Plan overview.
	await page.getByRole("link", { name: `${lumpy.slice(0, 4)} at a glance` }).click();
	await expect(page.getByRole("heading", { level: 1 })).toContainText(lumpy.slice(0, 4));
	const table = page.getByRole("table", { name: "The Plan month by month" });
	const row = table.getByRole("row", { name: new RegExp(`^${monthName(lumpy)}`) });
	await expect(row).toContainText("Lumpy");
	await expect(row).toContainText("$9,000");
	await expect(row).toContainText("$12,000");
	await expect(row).toContainText("−$4,200");
	await expect(page.getByRole("region", { name: "Lumpy months" })).toContainText(
		`Roof $12,000 is due in ${monthName(lumpy)}.`,
	);
	if (lumpy.slice(0, 4) === month.slice(0, 4)) {
		// This month shows what's actually happened so far beneath its Plan.
		const now = table.getByRole("row", { name: new RegExp(`^${monthName(month)}`) });
		await expect(now).toContainText("This month");
		await expect(now).toContainText("Actual so far");
	}

	// On a phone: a readable list, not a squashed grid, and no sideways scrolling.
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(table).toBeHidden();
	const list = page.getByRole("list", { name: "The Plan month by month" });
	await expect(list).toBeVisible();
	await expect(list.getByRole("listitem").filter({ hasText: monthName(lumpy) })).toContainText(
		"−$4,200",
	);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);

	// Each month opens its Plan.
	await list.getByRole("link", { name: monthName(lumpy), exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`/plan/${lumpy}$`));
});
