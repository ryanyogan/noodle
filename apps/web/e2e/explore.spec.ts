import { expect, type Page, test } from "@playwright/test";
import { createTestParent } from "./parents";
import { createPlannedHousehold, signedInPage } from "./session";

let parent: Awaited<ReturnType<typeof createTestParent>>;

test.beforeEach(async () => {
	parent = await createTestParent();
});

test.afterEach(async () => {
	await parent?.remove();
});

const freeToSpend = (page: Page) => page.getByRole("region", { name: "Free to Spend" });
/** The Plan and Scenario cells of a row of the totals. */
const totals = (page: Page, row: string | RegExp) => {
	const cells = page.getByRole("row", { name: row }).getByRole("cell");
	return { plan: cells.nth(0), scenario: cells.nth(1) };
};
/** The first month of the Free to Spend chart's table view: month, Plan, Scenario, difference. */
const firstMonth = (page: Page) =>
	page.getByRole("table", { name: "Free to Spend each month" }).getByRole("row").nth(1);

test("moving a Change changes the projection, and applying the Scenario changes the Plan", async ({
	browser,
}) => {
	const page = await signedInPage(browser, parent.email);
	// $5,000 − $1,200 − $400: $3,400 Free to Spend a month.
	await createPlannedHousehold(page, {
		baseline: "5,000",
		buckets: [
			["Groceries", "1,200"],
			["Hockey", "400"],
		],
	});
	await expect(freeToSpend(page).getByText("$3,400", { exact: true })).toBeVisible();

	await page.getByRole("link", { name: "Explore", exact: true }).click();
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Explore");

	// A new Scenario starts as the Plan: two years of $3,400 a month either way.
	const overTwoYears = totals(page, /^Over 2 years/);
	await expect(overTwoYears.plan).toHaveText("$81,600");
	await expect(overTwoYears.scenario).toHaveText("$81,600");
	await expect(page.locator("p:visible", { hasText: "Same as the Plan" })).toBeVisible();
	await page.getByRole("button", { name: "Show Free to Spend each month as a table" }).click();
	await expect(firstMonth(page)).toContainText(/\$3,400\s*\$3,400\s*\$0$/);

	// Hockey down to nothing frees $400 a month.
	await page.getByRole("button", { name: "Edit Hockey" }).click();
	const hockey = page.getByRole("slider", { name: "Hockey allowance" });
	await hockey.focus();
	await hockey.press("Home");
	await expect(hockey).toHaveAttribute("aria-valuetext", "$0");
	await expect(overTwoYears.scenario).toHaveText("$91,200");
	await expect(overTwoYears.plan).toHaveText("$81,600");
	await expect(page.locator("p:visible", { hasText: "Frees $9,600" }).first()).toBeVisible();
	await expect(page.getByRole("listitem", { name: "Hockey $400 → $0 a month" })).toContainText(
		"Frees $9,600 over 2 years",
	);
	await expect(firstMonth(page)).toContainText(/\$3,400\s*\$3,800\s*\$400$/);

	// Looking five years ahead.
	await page.getByText("5 years", { exact: true }).click();
	await expect(totals(page, /^Over 5 years/).scenario).toHaveText("$228,000");

	// Saved, it's there to come back to.
	await page.getByLabel("Name", { exact: true }).fill("No hockey");
	await page.getByRole("button", { name: "Save Scenario" }).click();
	// Saved, it is the Scenario chosen.
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue("No hockey");
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();

	// Applied, it becomes the Plan from this month on.
	await page.getByRole("button", { name: "Apply to Plan" }).click();
	const confirm = page.getByRole("alertdialog", { name: "Apply to the Plan" });
	await expect(confirm).toContainText("Hockey $400 → $0 a month");
	await confirm.getByRole("button", { name: "Apply to Plan" }).click();
	await expect(page.getByRole("status").filter({ hasText: "No hockey" })).toContainText(
		"is now the Plan",
	);
	// The Plan has caught up with the Scenario.
	await expect(totals(page, /^Over 5 years/).plan).toHaveText("$228,000");

	await page.getByRole("link", { name: "This Month", exact: true }).click();
	await expect(freeToSpend(page).getByText("$3,800", { exact: true })).toBeVisible();
});
